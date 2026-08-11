import fs from 'node:fs/promises';
import { sql } from '../db';
import { getPrinter, listPrinters, type Printer } from '../printers/repo';
import { adapterFor } from '../printers';
import { getActiveJob, markFailureDetected, finishJob, setFailureImage } from '../jobs';
import { recordEvent } from '../events';
import { storage } from '../storage';
import { PrinterWatcher, type JobLifecycleListener } from './watcher';
import { batchWantsFailureStop, onBatchPrintFailure } from './batch';
import type { VisionAlertPayload } from './types';

const ACTIVE_POLL_MS = 3_000;
const IDLE_POLL_MS = 15_000;

interface PrinterRuntime {
	printer: Printer;
	watcher: PrinterWatcher;
	timer: ReturnType<typeof setTimeout> | null;
	stopped: boolean;
}

// Kept on globalThis so dev-server HMR reloads don't leak duplicate pollers.
interface OrchestratorState {
	runtimes: Map<number, PrinterRuntime>;
	lifecycleListeners: Map<string, JobLifecycleListener>;
	started: boolean;
}
const g = globalThis as unknown as { __autoprintOrchestrator?: OrchestratorState };
if (!(g.__autoprintOrchestrator?.lifecycleListeners instanceof Map)) {
	g.__autoprintOrchestrator = { runtimes: new Map(), lifecycleListeners: new Map(), started: false };
}
const state = g.__autoprintOrchestrator;
const { runtimes, lifecycleListeners } = state;

/** Higher-level flows (batches, timelapse) subscribe here; applies to all printers. Keyed so HMR re-registration replaces. */
export function registerLifecycleListener(key: string, listener: JobLifecycleListener): void {
	lifecycleListeners.set(key, listener);
}

function scheduleTick(rt: PrinterRuntime): void {
	if (rt.stopped) return;
	rt.timer = setTimeout(async () => {
		try {
			await rt.watcher.tick();
		} catch (err) {
			console.error(`[orchestrator] watcher tick failed for printer ${rt.printer.id}:`, err);
		}
		scheduleTick(rt);
	}, rt.watcher.isBusy() ? ACTIVE_POLL_MS : IDLE_POLL_MS);
}

async function startRuntime(printer: Printer): Promise<void> {
	const watcher = new PrinterWatcher(printer, adapterFor(printer), () => lifecycleListeners.values());
	await watcher.recover();
	const rt: PrinterRuntime = { printer, watcher, timer: null, stopped: false };
	runtimes.set(printer.id, rt);
	scheduleTick(rt);
}

function stopRuntime(id: number): void {
	const rt = runtimes.get(id);
	if (!rt) return;
	rt.stopped = true;
	if (rt.timer) clearTimeout(rt.timer);
	runtimes.delete(id);
}

/** Called after printer create/update/delete so the poller picks up new config. */
export async function refreshPrinter(id: number): Promise<void> {
	stopRuntime(id);
	const printer = await getPrinter(id);
	if (printer && printer.enabled) await startRuntime(printer);
}

export function getWatcher(printerId: number): PrinterWatcher | null {
	return runtimes.get(printerId)?.watcher ?? null;
}

async function recentJobAlreadyFailed(printerId: number): Promise<boolean> {
	const rows = await sql`SELECT 1 FROM print_jobs
		WHERE printer_id = ${printerId} AND failure_detected = true
		AND finished_at > now() - interval '15 minutes' LIMIT 1`;
	return rows.length > 0;
}

/**
 * Entry point for vision failure alerts (webhook). Dedupes per job, records
 * the failure with its snapshot, and stops the print if the printer is
 * configured to do so.
 */
export async function onFailureAlert(printerId: number, payload: VisionAlertPayload): Promise<{ acted: boolean }> {
	const printer = await getPrinter(printerId);
	if (!printer) throw new Error(`Unknown printer ${printerId}`);

	const job = await getActiveJob(printerId);
	if (!job) {
		// Vision re-fires every ~60s while the failed part is still in view; stay quiet
		// if the failure was already recorded on a recently closed job.
		if (await recentJobAlreadyFailed(printerId)) return { acted: false };
		await recordEvent({
			type: 'failure_detected',
			printerId,
			message: `${printer.name}: failure reported by vision but no print is being tracked`,
			data: { detections: payload.detections ?? [] }
		});
		return { acted: false };
	}

	const first = await markFailureDetected(job.id);
	if (!first) return { acted: false }; // repeat alert for the same job — already handled

	let imagePath: string | null = null;
	let image: Buffer | undefined;
	if (payload.image_jpeg_base64) {
		image = Buffer.from(payload.image_jpeg_base64, 'base64');
		imagePath = storage.failurePath(`job-${job.id}.jpg`);
		await fs.writeFile(imagePath, image);
		await setFailureImage(job.id, imagePath);
	}

	await recordEvent(
		{
			type: 'failure_detected',
			printerId,
			jobId: job.id,
			batchRunId: job.batch_run_id ?? undefined,
			message: `${printer.name}: print failure detected on ${job.file_name}`,
			data: { detections: payload.detections ?? [] }
		},
		{ alert: true, imageJpeg: image }
	);

	// During a batch the run's own failure-detection toggle gates the stop.
	const batchWants = await batchWantsFailureStop(printerId);
	const shouldStop = printer.stop_on_failure && batchWants !== false;
	if (!shouldStop) return { acted: false };

	await finishJob(job.id, 'failed');
	if (job.prusalink_job_id != null) {
		try {
			await adapterFor(printer).stop(job.prusalink_job_id);
			await recordEvent({
				type: 'printer_stopped',
				printerId,
				jobId: job.id,
				message: `${printer.name}: print stopped automatically after failure`
			});
			await onBatchPrintFailure(printerId);
		} catch (err) {
			await recordEvent(
				{
					type: 'state_change',
					printerId,
					jobId: job.id,
					message: `${printer.name}: failed to stop the print after failure — stop it manually`,
					data: { error: String(err) }
				},
				{ alert: true }
			);
		}
	}
	return { acted: true };
}

/** Boots per-printer watchers once per process (guarded for dev HMR). */
export async function startOrchestrator(): Promise<void> {
	if (state.started) return;
	state.started = true;
	const printers = await listPrinters();
	for (const printer of printers.filter((p) => p.enabled)) {
		await startRuntime(printer);
	}
	console.log(`[orchestrator] watching ${runtimes.size} printer(s)`);
}
