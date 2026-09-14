/**
 * Operator-triggered robot jobs — the pick-and-place removal a batch runs after
 * a part finishes, and a return-to-origin drive, both fired by hand for bench
 * testing or to recover from a failed run. Unlike batch removals these advance
 * no counters: the job runs, the outcome is recorded, and that's it.
 *
 * The gateway's log tail is mirrored here as it polls, and the finished job is
 * kept until the next one starts — the log of the run that just failed is
 * exactly what an operator wants to read.
 */
import { adapterFor } from '../printers';
import type { Printer } from '../printers/repo';
import type { PrinterState } from '../printers/adapter';
import { getActiveBatch, type BatchPhase } from '../batches';
import { recordEvent } from '../events';
import { getGeminiApiKeys } from '../settings';
import {
	cancelRemoval,
	checkRobotHealth,
	DEFAULT_REMOVAL_TASK,
	getRemovalJob,
	startRemoval,
	startReturnToOrigin,
	type RobotHealth,
	type RobotJobKind
} from '../robot';

const POLL_MS = 3_000;
/**
 * Just past the longest gateway job timeout (20 min for a removal). Without a
 * cap an unreachable gateway would leave the entry — and so the buttons —
 * wedged.
 */
const MAX_JOB_MS = 25 * 60_000;
/** The gateway keeps 200 lines; no reason to hold more than it sends. */
const MAX_LOG_LINES = 200;

const KIND_LABEL: Record<RobotJobKind, string> = {
	pick_place: 'robot removal',
	return_to_origin: 'return-to-origin'
};

export type ManualJobStatus = 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface ManualJob {
	jobId: string;
	kind: RobotJobKind;
	status: ManualJobStatus;
	startedAt: number;
	finishedAt?: number;
	/** Mirrored from the gateway on every poll. */
	logTail: string[];
}

interface Tracked extends ManualJob {
	timer?: ReturnType<typeof setInterval>;
}

// Per printer id, on globalThis so HMR doesn't duplicate the pollers.
const g = globalThis as unknown as { __autoprintManualRobotJobs?: Map<number, Tracked> };
if (!(g.__autoprintManualRobotJobs instanceof Map)) g.__autoprintManualRobotJobs = new Map();
const manualJobs = g.__autoprintManualRobotJobs;

/** States where the bed is occupied and the head is in the way. */
const BUSY_PRINTER_STATES: PrinterState[] = ['PRINTING', 'PAUSED', 'ATTENTION'];

/**
 * The whole "may the robot move right now" policy, as a pure function.
 * Returns the reason to show the operator, or null when the trigger is allowed.
 */
export function robotJobBlockReason(input: {
	kind: RobotJobKind;
	gatewayUrl: string;
	/** null when the printer could not be read — treated as "not printing". */
	printerState: PrinterState | null;
	batchPhase: BatchPhase | null;
	batchRobotJobId: string | null;
	manualInFlight: boolean;
	gatewayBusy: boolean;
}): string | null {
	if (!input.gatewayUrl) return 'No robot gateway configured — set one in printer settings';
	// Only the arm reaches into the printer; a return-to-origin drive is a
	// floor move and stays legal mid-print.
	if (
		input.kind === 'pick_place' &&
		input.printerState &&
		BUSY_PRINTER_STATES.includes(input.printerState)
	) {
		return 'The printer is mid-print — stop the print first';
	}
	if (input.batchPhase === 'removing' && input.batchRobotJobId) {
		return 'The batch is already running a robot removal';
	}
	if (input.manualInFlight) return 'A manual robot job is already running';
	if (input.gatewayBusy) return 'The robot arm is busy with another job';
	return null;
}

/** The current or most recently finished manual job, for the UI. */
export function getManualJob(printerId: number): ManualJob | null {
	const tracked = manualJobs.get(printerId);
	if (!tracked) return null;
	const { timer: _timer, ...job } = tracked;
	return job;
}

function isRunning(printerId: number): boolean {
	return manualJobs.get(printerId)?.status === 'running';
}

/** Fires a robot job by hand. Throws the block reason if the guards say no. */
export async function startManualJob(printer: Printer, kind: RobotJobKind): Promise<string> {
	let printerState: PrinterState | null = null;
	// Only the removal cares about printer state, and only once there is an arm.
	if (printer.robot_gateway_url && kind === 'pick_place') {
		printerState = await adapterFor(printer)
			.getStatus()
			.then((s) => s.state)
			.catch(() => null);
	}
	const batch = await getActiveBatch(printer.id);
	const health: RobotHealth = printer.robot_gateway_url
		? await checkRobotHealth(printer.robot_gateway_url)
		: { ok: false };

	// Policy first: "stop the print first" is more actionable than a transport
	// error when both are true.
	const blocked = robotJobBlockReason({
		kind,
		gatewayUrl: printer.robot_gateway_url,
		printerState,
		batchPhase: batch?.phase ?? null,
		batchRobotJobId: batch?.robot_job_id ?? null,
		manualInFlight: isRunning(printer.id),
		gatewayBusy: !!health.busy
	});
	if (blocked) throw new Error(blocked);
	if (!health.ok) throw new Error(health.error ?? 'Robot gateway unreachable');

	const jobId =
		kind === 'return_to_origin'
			? await startReturnToOrigin(printer.robot_gateway_url)
			: await startRemoval(printer.robot_gateway_url, {
					task: printer.robot_task || DEFAULT_REMOVAL_TASK,
					params: printer.robot_params_json,
					geminiApiKeys: await getGeminiApiKeys()
				});
	track(printer, jobId, kind);
	await recordEvent({
		type: 'robot_started',
		printerId: printer.id,
		message: `${printer.name}: manual ${KIND_LABEL[kind]} started`
	});
	return jobId;
}

/** Asks the gateway to abort the running manual job. */
export async function cancelManualJob(printer: Printer): Promise<void> {
	const tracked = manualJobs.get(printer.id);
	if (!tracked || tracked.status !== 'running') throw new Error('No manual robot job is running');
	settle(printer.id, 'cancelled');
	await cancelRemoval(printer.robot_gateway_url, tracked.jobId).catch(() => {});
	await recordEvent({
		type: 'robot_error',
		printerId: printer.id,
		message: `${printer.name}: manual ${KIND_LABEL[tracked.kind]} cancelled`
	});
}

/** Stops polling and marks the tracked job finished, keeping it for the UI. */
function settle(printerId: number, status: Exclude<ManualJobStatus, 'running'>): void {
	const tracked = manualJobs.get(printerId);
	if (!tracked) return;
	if (tracked.timer) clearInterval(tracked.timer);
	tracked.timer = undefined;
	tracked.status = status;
	tracked.finishedAt = Date.now();
}

function track(printer: Printer, jobId: string, kind: RobotJobKind): void {
	const previous = manualJobs.get(printer.id);
	if (previous?.timer) clearInterval(previous.timer);

	const entry: Tracked = { jobId, kind, status: 'running', startedAt: Date.now(), logTail: [] };
	entry.timer = setInterval(async () => {
		try {
			if (Date.now() - entry.startedAt > MAX_JOB_MS) {
				entry.logTail = [...entry.logTail, '[autoprint] gave up waiting after 25 minutes'];
				settle(printer.id, 'failed');
				await recordEvent(
					{
						type: 'robot_error',
						printerId: printer.id,
						message: `${printer.name}: manual ${KIND_LABEL[kind]} gave no result in 25 minutes — check the robot`
					},
					{ alert: true }
				);
				return;
			}
			const job = await getRemovalJob(printer.robot_gateway_url, jobId);
			if (job.logTail?.length) entry.logTail = job.logTail.slice(-MAX_LOG_LINES);
			if (job.status === 'running' || job.status === 'queued') return;

			settle(printer.id, job.status);
			if (job.status === 'succeeded') {
				await recordEvent({
					type: 'robot_finished',
					printerId: printer.id,
					message: `${printer.name}: manual ${KIND_LABEL[kind]} finished`
				});
			} else {
				await recordEvent(
					{
						type: 'robot_error',
						printerId: printer.id,
						message: `${printer.name}: manual ${KIND_LABEL[kind]} ${job.status}${job.logTail?.length ? ` — ${job.logTail.at(-1)}` : ''}`
					},
					{ alert: true }
				);
			}
		} catch (err) {
			// Gateway unreachable mid-poll: keep trying until MAX_JOB_MS gives up.
			console.error(`[printer ${printer.id}] manual robot poll failed:`, err);
		}
	}, POLL_MS);
	manualJobs.set(printer.id, entry);
}
