import { sql } from './db';

export interface PrintJob {
	id: number;
	printer_id: number;
	batch_run_id: number | null;
	file_name: string;
	prusalink_job_id: number | null;
	status: 'printing' | 'paused' | 'finished' | 'stopped' | 'failed' | 'error';
	progress: number;
	started_at: Date;
	finished_at: Date | null;
	failure_detected: boolean;
	failure_cause: string | null;
	failure_image_path: string | null;
	timelapse_path: string | null;
}

const OPEN_STATUSES = ['printing', 'paused'];

export async function createJob(input: {
	printer_id: number;
	file_name: string;
	prusalink_job_id: number | null;
	batch_run_id?: number | null;
}): Promise<number> {
	const rows = await sql`INSERT INTO print_jobs ${sql({
		printer_id: input.printer_id,
		file_name: input.file_name,
		prusalink_job_id: input.prusalink_job_id,
		batch_run_id: input.batch_run_id ?? null
	})} RETURNING id`;
	return rows[0].id as number;
}

export async function getJob(id: number): Promise<PrintJob | null> {
	const rows = await sql`SELECT * FROM print_jobs WHERE id = ${id}`;
	return (rows[0] as unknown as PrintJob) ?? null;
}

export async function getActiveJob(printerId: number): Promise<PrintJob | null> {
	const rows = await sql`SELECT * FROM print_jobs
		WHERE printer_id = ${printerId} AND status = ANY(${OPEN_STATUSES})
		ORDER BY id DESC LIMIT 1`;
	return (rows[0] as unknown as PrintJob) ?? null;
}

export async function updateJobProgress(id: number, progress: number, status?: 'printing' | 'paused'): Promise<void> {
	if (status) {
		await sql`UPDATE print_jobs SET progress = ${progress}, status = ${status}
			WHERE id = ${id} AND status = ANY(${OPEN_STATUSES})`;
	} else {
		await sql`UPDATE print_jobs SET progress = ${progress} WHERE id = ${id}`;
	}
}

/** Closes an open job with its final status; no-op if the job was already closed (e.g. marked failed). */
export async function finishJob(
	id: number,
	status: 'finished' | 'stopped' | 'failed' | 'error',
	progress?: number
): Promise<boolean> {
	const rows = await sql`UPDATE print_jobs
		SET status = ${status}, finished_at = now(),
			progress = COALESCE(${progress ?? null}, progress)
		WHERE id = ${id} AND status = ANY(${OPEN_STATUSES})
		RETURNING id`;
	return rows.length > 0;
}

/** Closes stale open rows left behind by a crash/restart, keeping the one row still being tracked. */
export async function closeOrphanJobs(printerId: number, keepId: number | null): Promise<void> {
	await sql`UPDATE print_jobs SET status = 'error', finished_at = now()
		WHERE printer_id = ${printerId} AND status = ANY(${OPEN_STATUSES})
		AND id IS DISTINCT FROM ${keepId}`;
}

/**
 * Atomic dedupe for repeated failure webhooks: only the first caller per job
 * gets `true`; concurrent and later calls see the flag already set.
 */
export async function markFailureDetected(id: number): Promise<boolean> {
	const rows = await sql`UPDATE print_jobs SET failure_detected = true
		WHERE id = ${id} AND failure_detected = false RETURNING id`;
	return rows.length > 0;
}

export async function setFailureImage(id: number, path: string): Promise<void> {
	await sql`UPDATE print_jobs SET failure_image_path = ${path} WHERE id = ${id}`;
}

export async function setFailureCause(id: number, cause: string): Promise<void> {
	await sql`UPDATE print_jobs SET failure_cause = ${cause} WHERE id = ${id}`;
}

export async function setTimelapsePath(id: number, path: string): Promise<void> {
	await sql`UPDATE print_jobs SET timelapse_path = ${path} WHERE id = ${id}`;
}
