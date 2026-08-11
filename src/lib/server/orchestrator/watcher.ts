import type { PrinterAdapter, PrinterState, PrinterStatus } from '../printers/adapter';
import type { Printer } from '../printers/repo';
import { closeOrphanJobs, createJob, finishJob, getActiveJob, updateJobProgress } from '../jobs';
import { recordEvent } from '../events';

/** Hooks for higher-level flows (batches, timelapse) into the job lifecycle. */
export interface JobLifecycleListener {
	onJobStarted?(printer: Printer, jobRowId: number): void | Promise<void>;
	onJobClosed?(
		printer: Printer,
		jobRowId: number,
		finalStatus: 'finished' | 'stopped' | 'failed' | 'error'
	): void | Promise<void>;
	onStatus?(printer: Printer, status: PrinterStatus): void | Promise<void>;
}

const ACTIVE_STATES: PrinterState[] = ['PRINTING', 'PAUSED', 'ATTENTION'];

/**
 * Tracks one printer: mirrors its live state into print_jobs rows and emits
 * events on transitions. Also covers prints started on the printer itself.
 */
export class PrinterWatcher {
	private lastState: PrinterState | null = null;
	private jobRowId: number | null = null;
	private prusaJobId: number | null = null;

	constructor(
		public printer: Printer,
		private readonly adapter: PrinterAdapter,
		private readonly getListeners: () => Iterable<JobLifecycleListener> = () => []
	) {}

	/** Re-attach to a job row after a process restart, closing any stale duplicates. */
	async recover(): Promise<void> {
		const open = await getActiveJob(this.printer.id);
		if (open) {
			this.jobRowId = open.id;
			this.prusaJobId = open.prusalink_job_id;
		}
		await closeOrphanJobs(this.printer.id, open?.id ?? null);
	}

	isBusy(): boolean {
		return this.lastState !== null && ACTIVE_STATES.includes(this.lastState);
	}

	currentJobRowId(): number | null {
		return this.jobRowId;
	}

	async tick(): Promise<PrinterStatus> {
		let status: PrinterStatus;
		try {
			status = await this.adapter.getStatus();
		} catch {
			status = { state: 'OFFLINE' };
		}
		await this.reconcile(status);
		this.lastState = status.state;
		for (const l of this.getListeners()) {
			await l.onStatus?.(this.printer, status);
		}
		return status;
	}

	private async reconcile(status: PrinterStatus): Promise<void> {
		const { state, job } = status;

		// First tick after a restart: if the recovered print already ended while we
		// were down, no transition will ever fire — resolve it from the current state.
		if (this.lastState === null && this.jobRowId !== null && !ACTIVE_STATES.includes(state) && state !== 'OFFLINE') {
			const id = this.jobRowId;
			const final = state === 'FINISHED' ? 'finished' : state === 'ERROR' ? 'error' : 'stopped';
			await finishJob(id, final, final === 'finished' ? 100 : undefined);
			await recordEvent(
				{
					type: final === 'finished' ? 'print_finished' : 'printer_stopped',
					printerId: this.printer.id,
					jobId: id,
					message: `${this.printer.name}: print ${final} while Autoprint was restarting`
				},
				{ alert: final === 'finished' }
			);
			await this.notifyClosed(id, final);
		}

		// New print appeared (started from the UI, a batch, or the printer's own screen).
		if (job?.id != null && job.id !== this.prusaJobId && ACTIVE_STATES.includes(state)) {
			if (this.jobRowId !== null) await this.closeJob('stopped');
			this.prusaJobId = job.id;
			this.jobRowId = await createJob({
				printer_id: this.printer.id,
				file_name: job.fileName,
				prusalink_job_id: job.id
			});
			await recordEvent({
				type: 'print_started',
				printerId: this.printer.id,
				jobId: this.jobRowId,
				message: `${this.printer.name}: started printing ${job.fileName || 'a file'}`
			});
			for (const l of this.getListeners()) {
				await l.onJobStarted?.(this.printer, this.jobRowId);
			}
		}

		if (this.jobRowId !== null && job) {
			const jobStatus = state === 'PAUSED' || state === 'ATTENTION' ? 'paused' : state === 'PRINTING' ? 'printing' : undefined;
			await updateJobProgress(this.jobRowId, job.progress, jobStatus);
		}

		// State transitions.
		if (this.lastState !== null && state !== this.lastState) {
			await this.onTransition(this.lastState, state, status);
		}

		// The tracked job vanished without a terminal state (e.g. cleared from the printer screen).
		if (this.jobRowId !== null && !job && !['FINISHED', 'STOPPED', 'ERROR', 'OFFLINE'].includes(state)) {
			await this.closeJob(this.lastState === 'PRINTING' || this.lastState === 'PAUSED' ? 'stopped' : 'finished');
		}
	}

	private async onTransition(from: PrinterState, to: PrinterState, status: PrinterStatus): Promise<void> {
		const name = this.printer.name;
		switch (to) {
			case 'FINISHED':
				if (this.jobRowId !== null) {
					const id = this.jobRowId;
					await finishJob(id, 'finished', 100);
					await recordEvent(
						{ type: 'print_finished', printerId: this.printer.id, jobId: id, message: `${name}: print finished` },
						{ alert: true }
					);
					await this.notifyClosed(id, 'finished');
				}
				break;
			case 'STOPPED':
				if (this.jobRowId !== null) {
					const id = this.jobRowId;
					// If the failure webhook already marked it failed, finishJob is a no-op.
					const closed = await finishJob(id, 'stopped', status.job?.progress);
					if (closed) {
						await recordEvent({
							type: 'printer_stopped',
							printerId: this.printer.id,
							jobId: id,
							message: `${name}: print stopped`
						});
					}
					await this.notifyClosed(id, closed ? 'stopped' : 'failed');
				}
				break;
			case 'ERROR':
				if (this.jobRowId !== null) {
					const id = this.jobRowId;
					await finishJob(id, 'error', status.job?.progress);
					await recordEvent(
						{ type: 'state_change', printerId: this.printer.id, jobId: id, message: `${name}: printer error during print` },
						{ alert: true }
					);
					await this.notifyClosed(id, 'error');
				}
				break;
			case 'ATTENTION':
				await recordEvent(
					{
						type: 'filament_runout',
						printerId: this.printer.id,
						jobId: this.jobRowId ?? undefined,
						message: `${name}: printer needs attention (filament runout or manual intervention)`
					},
					{ alert: true }
				);
				break;
			case 'PAUSED':
				if (from === 'PRINTING') {
					await recordEvent(
						{
							type: 'state_change',
							printerId: this.printer.id,
							jobId: this.jobRowId ?? undefined,
							message: `${name}: print paused`
						},
						{ alert: true }
					);
				}
				break;
			case 'OFFLINE':
				await recordEvent({
					type: 'state_change',
					printerId: this.printer.id,
					message: `${name}: printer went offline`
				});
				break;
		}
	}

	private async closeJob(finalStatus: 'finished' | 'stopped' | 'failed' | 'error'): Promise<void> {
		if (this.jobRowId === null) return;
		const id = this.jobRowId;
		await finishJob(id, finalStatus);
		await this.notifyClosed(id, finalStatus);
	}

	private async notifyClosed(jobRowId: number, finalStatus: 'finished' | 'stopped' | 'failed' | 'error'): Promise<void> {
		this.jobRowId = null;
		this.prusaJobId = null;
		for (const l of this.getListeners()) {
			await l.onJobClosed?.(this.printer, jobRowId, finalStatus);
		}
	}
}
