import fs from 'node:fs/promises';
import { adapterFor } from '../printers';
import { getPrinter, type Printer } from '../printers/repo';
import {
	closeBatch,
	createBatch,
	getActiveBatch,
	getBatch,
	updateBatch,
	type BatchRun
} from '../batches';
import { sql } from '../db';
import { recordEvent } from '../events';
import { getGeminiApiKeys } from '../settings';
import { cancelRemoval, getRemovalJob, startRemoval } from '../robot';
import { storage } from '../storage';
import type { JobLifecycleListener } from './watcher';

const ROBOT_POLL_MS = 3_000;

// Robot pollers per batch id, on globalThis so HMR doesn't duplicate them.
const g = globalThis as unknown as { __autoprintRobotPollers?: Map<number, ReturnType<typeof setInterval>> };
if (!(g.__autoprintRobotPollers instanceof Map)) g.__autoprintRobotPollers = new Map();
const robotPollers = g.__autoprintRobotPollers;

/** User entry point: start a batch of `total` parts of `fileName` on a printer. */
export async function startBatch(
	printerId: number,
	fileName: string,
	total: number,
	failureDetection: boolean
): Promise<number> {
	const printer = await getPrinter(printerId);
	if (!printer) throw new Error(`Unknown printer ${printerId}`);
	if (await getActiveBatch(printerId)) throw new Error('A batch is already running on this printer');

	const batchId = await createBatch({
		printer_id: printerId,
		file_name: fileName,
		total_count: total,
		failure_detection: failureDetection
	});
	await recordEvent({
		type: 'batch_started',
		printerId,
		batchRunId: batchId,
		message: `${printer.name}: batch started — ${total}× ${fileName}`
	});
	const batch = (await getBatch(batchId))!;
	await startPart(printer, batch);
	return batchId;
}

/** Sends the file (uploading if needed) and starts the next part. */
async function startPart(printer: Printer, batch: BatchRun): Promise<void> {
	const adapter = adapterFor(printer);
	try {
		await updateBatch(batch.id, { phase: 'uploading', current_job_id: null, robot_job_id: null });
		if (!(await adapter.fileExists(batch.file_name))) {
			const local = storage.gcodePath(batch.file_name);
			const data = await fs.readFile(local).catch(() => null);
			if (!data) {
				throw new Error(`${batch.file_name} is not on the printer's USB and not in the upload cache`);
			}
			await adapter.uploadFile(batch.file_name, data);
		}
		await updateBatch(batch.id, { phase: 'starting' });
		await adapter.startPrint(batch.file_name);
		// The printer watcher picks the new job up and batchLifecycleListener links it.
	} catch (err) {
		await pauseBatch(batch.id, printer, `could not start part ${batch.completed_count + 1}: ${errMsg(err)}`);
	}
}

/** Pause the batch and wait for a human (failure, robot error, or start trouble). */
export async function pauseBatch(batchId: number, printer: Printer, reason: string): Promise<void> {
	stopRobotPoller(batchId);
	await updateBatch(batchId, { status: 'paused_failure', phase: 'idle' });
	await recordEvent(
		{
			type: 'batch_paused',
			printerId: printer.id,
			batchRunId: batchId,
			message: `${printer.name}: batch paused — ${reason}. Clear the bed, then resume or cancel from the printer page.`
		},
		{ alert: true }
	);
}

/** Called by the failure-alert flow after a print was stopped for a failure. */
export async function onBatchPrintFailure(printerId: number): Promise<void> {
	const batch = await getActiveBatch(printerId);
	if (!batch || batch.status !== 'active') return;
	const printer = await getPrinter(printerId);
	if (!printer) return;
	await pauseBatch(batch.id, printer, 'a print failure was detected');
}

/** Returns whether an active batch wants failure detection acted on. */
export async function batchWantsFailureStop(printerId: number): Promise<boolean | null> {
	const batch = await getActiveBatch(printerId);
	if (!batch || batch.status !== 'active') return null;
	return batch.failure_detection;
}

export async function resumeBatch(batchId: number, mode: 'retry' | 'skip'): Promise<void> {
	const batch = await getBatch(batchId);
	if (!batch || (batch.status !== 'paused_failure' && batch.status !== 'paused_user')) {
		throw new Error('Batch is not paused');
	}
	const printer = await getPrinter(batch.printer_id);
	if (!printer) throw new Error('Printer no longer exists');

	await recordEvent({
		type: 'batch_resumed',
		printerId: printer.id,
		batchRunId: batch.id,
		message: `${printer.name}: batch resumed (${mode === 'skip' ? 'part counted as spent' : 'retrying the part'})`
	});

	if (mode === 'skip') {
		const done = batch.completed_count + 1;
		await updateBatch(batch.id, { completed_count: done });
		if (done >= batch.total_count) {
			await updateBatch(batch.id, { status: 'active' });
			await finishBatch(printer, (await getBatch(batch.id))!);
			return;
		}
		batch.completed_count = done;
	}
	await updateBatch(batch.id, { status: 'active' });
	await startPart(printer, (await getBatch(batch.id))!);
}

export async function cancelBatch(batchId: number): Promise<void> {
	const batch = await getBatch(batchId);
	if (!batch) return;
	stopRobotPoller(batchId);
	const printer = await getPrinter(batch.printer_id);
	if (batch.robot_job_id && printer?.robot_gateway_url) {
		await cancelRemoval(printer.robot_gateway_url, batch.robot_job_id).catch(() => {});
	}
	await closeBatch(batchId, 'cancelled');
	await recordEvent({
		type: 'batch_cancelled',
		printerId: batch.printer_id,
		batchRunId: batchId,
		message: `${printer?.name ?? 'printer'}: batch cancelled at ${batch.completed_count}/${batch.total_count} parts`
	});
}

async function finishBatch(printer: Printer, batch: BatchRun): Promise<void> {
	await closeBatch(batch.id, 'completed');
	await recordEvent(
		{
			type: 'batch_finished',
			printerId: printer.id,
			batchRunId: batch.id,
			message: `${printer.name}: batch finished — ${batch.completed_count}/${batch.total_count}× ${batch.file_name}`
		},
		{ alert: true }
	);
}

/** After a part prints successfully, hand it to the robot arm. */
async function startPartRemoval(printer: Printer, batch: BatchRun): Promise<void> {
	if (!printer.robot_gateway_url) {
		await pauseBatch(
			batch.id,
			printer,
			'the part finished but no robot gateway is configured — remove it manually, then resume with "skip"'
		);
		return;
	}
	try {
		const robotJobId = await startRemoval(printer.robot_gateway_url, {
			task: printer.robot_task || 'pick the printed part off the print bed and place it in the bin',
			params: printer.robot_params_json,
			geminiApiKeys: await getGeminiApiKeys()
		});
		await updateBatch(batch.id, { phase: 'removing', robot_job_id: robotJobId });
		await recordEvent({
			type: 'robot_started',
			printerId: printer.id,
			batchRunId: batch.id,
			message: `${printer.name}: robot removal started`
		});
		pollRobot(printer.id, batch.id, robotJobId);
	} catch (err) {
		await pauseBatch(batch.id, printer, `robot removal could not start: ${errMsg(err)}`);
	}
}

function stopRobotPoller(batchId: number): void {
	const t = robotPollers.get(batchId);
	if (t) clearInterval(t);
	robotPollers.delete(batchId);
}

function pollRobot(printerId: number, batchId: number, robotJobId: string): void {
	stopRobotPoller(batchId);
	const timer = setInterval(async () => {
		try {
			const printer = await getPrinter(printerId);
			const batch = await getBatch(batchId);
			if (!printer || !batch || batch.status !== 'active' || batch.phase !== 'removing') {
				stopRobotPoller(batchId);
				return;
			}
			const job = await getRemovalJob(printer.robot_gateway_url, robotJobId);
			if (job.status === 'running' || job.status === 'queued') return;

			stopRobotPoller(batchId);
			if (job.status === 'succeeded') {
				const done = batch.completed_count + 1;
				await updateBatch(batchId, { completed_count: done, robot_job_id: null });
				await recordEvent({
					type: 'robot_finished',
					printerId,
					batchRunId: batchId,
					message: `${printer.name}: part ${done}/${batch.total_count} removed by the robot`
				});
				const updated = (await getBatch(batchId))!;
				if (done >= batch.total_count) {
					await finishBatch(printer, updated);
				} else {
					await startPart(printer, updated);
				}
			} else {
				await recordEvent(
					{
						type: 'robot_error',
						printerId,
						batchRunId: batchId,
						message: `${printer.name}: robot removal ${job.status}${job.logTail?.length ? ` — ${job.logTail.at(-1)}` : ''}`
					},
					{ alert: true }
				);
				await pauseBatch(batchId, printer, `robot removal ${job.status}`);
			}
		} catch (err) {
			// gateway unreachable mid-poll: keep trying; a stuck job eventually pauses via user
			console.error(`[batch ${batchId}] robot poll failed:`, err);
		}
	}, ROBOT_POLL_MS);
	robotPollers.set(batchId, timer);
}

/** Watcher hook: links new job rows to the running batch and reacts when they close. */
export const batchLifecycleListener: JobLifecycleListener = {
	async onJobStarted(printer, jobRowId) {
		const batch = await getActiveBatch(printer.id);
		if (!batch || batch.status !== 'active' || !['starting', 'uploading'].includes(batch.phase)) return;
		await sql`UPDATE print_jobs SET batch_run_id = ${batch.id} WHERE id = ${jobRowId}`;
		await updateBatch(batch.id, { phase: 'printing', current_job_id: jobRowId });
	},
	async onJobClosed(printer, jobRowId, finalStatus) {
		const batch = await getActiveBatch(printer.id);
		if (!batch || batch.status !== 'active' || batch.current_job_id !== jobRowId) return;
		if (finalStatus === 'finished') {
			await startPartRemoval(printer, batch);
		} else if (finalStatus === 'failed') {
			// failure alert flow already paused the batch (or is about to); nothing to do here
		} else {
			await pauseBatch(batch.id, printer, `the print ended as "${finalStatus}"`);
		}
	}
};

/** Boot recovery: re-attach robot pollers; anything ambiguous flips to paused for the user. */
export async function recoverBatches(): Promise<void> {
	const rows = await sql`SELECT id, printer_id, phase, robot_job_id FROM batch_runs WHERE status = 'active'`;
	for (const row of rows) {
		const printer = await getPrinter(row.printer_id as number);
		if (!printer) continue;
		if (row.phase === 'removing' && row.robot_job_id) {
			pollRobot(printer.id, row.id as number, row.robot_job_id as string);
		} else if (row.phase === 'printing') {
			// The watcher recovers the job row; onJobClosed will continue the batch.
		} else {
			await pauseBatch(row.id as number, printer, 'Autoprint restarted mid-step');
		}
	}
}

function errMsg(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
