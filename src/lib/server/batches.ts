import { sql } from './db';

export type BatchStatus = 'active' | 'paused_failure' | 'paused_user' | 'completed' | 'cancelled' | 'error';
export type BatchPhase = 'uploading' | 'starting' | 'printing' | 'removing' | 'idle';

export interface BatchRun {
	id: number;
	printer_id: number;
	file_name: string;
	total_count: number;
	completed_count: number;
	failure_detection: boolean;
	status: BatchStatus;
	phase: BatchPhase;
	current_job_id: number | null;
	robot_job_id: string | null;
	started_at: Date;
	finished_at: Date | null;
}

export async function createBatch(input: {
	printer_id: number;
	file_name: string;
	total_count: number;
	failure_detection: boolean;
}): Promise<number> {
	const rows = await sql`INSERT INTO batch_runs ${sql({ ...input, status: 'active', phase: 'uploading' })} RETURNING id`;
	return rows[0].id as number;
}

export async function getBatch(id: number): Promise<BatchRun | null> {
	const rows = await sql`SELECT * FROM batch_runs WHERE id = ${id}`;
	return (rows[0] as unknown as BatchRun) ?? null;
}

export async function getActiveBatch(printerId: number): Promise<BatchRun | null> {
	const rows = await sql`SELECT * FROM batch_runs
		WHERE printer_id = ${printerId} AND status IN ('active', 'paused_failure', 'paused_user')
		ORDER BY id DESC LIMIT 1`;
	return (rows[0] as unknown as BatchRun) ?? null;
}

export async function updateBatch(
	id: number,
	patch: Partial<Pick<BatchRun, 'status' | 'phase' | 'completed_count' | 'current_job_id' | 'robot_job_id'>>
): Promise<void> {
	await sql`UPDATE batch_runs SET ${sql(patch as Record<string, unknown>)} WHERE id = ${id}`;
}

export async function closeBatch(id: number, status: 'completed' | 'cancelled' | 'error'): Promise<void> {
	await sql`UPDATE batch_runs SET status = ${status}, phase = 'idle', finished_at = now() WHERE id = ${id}`;
}
