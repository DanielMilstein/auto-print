/** Client for the robot_gateway HTTP service (one arm per printer). */

const REMOVAL_JOB_TIMEOUT_SEC = 1200;

export type RobotJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface RobotJob {
	jobId: string;
	status: RobotJobStatus;
	startedAt?: string;
	finishedAt?: string;
	logTail?: string[];
}

export interface RobotHealth {
	ok: boolean;
	busy?: boolean;
	error?: string;
}

export interface RemovalRequest {
	task: string;
	params: Record<string, string>;
	geminiApiKeys: string[];
}

export async function checkRobotHealth(gatewayUrl: string): Promise<RobotHealth> {
	try {
		const res = await fetch(`${gatewayUrl}/health`, { signal: AbortSignal.timeout(5000) });
		if (!res.ok) return { ok: false, error: `Robot gateway returned ${res.status}` };
		const data = await res.json();
		return { ok: true, busy: !!data.busy };
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : 'Robot gateway unreachable' };
	}
}

export async function startRemoval(gatewayUrl: string, req: RemovalRequest): Promise<string> {
	const res = await fetch(`${gatewayUrl}/jobs`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			task: req.task,
			params: req.params,
			gemini_api_keys: req.geminiApiKeys,
			timeout_sec: REMOVAL_JOB_TIMEOUT_SEC
		}),
		signal: AbortSignal.timeout(15_000)
	});
	if (res.status === 409) throw new Error('The robot arm is busy with another job');
	if (!res.ok) throw new Error(`Robot gateway returned ${res.status}: ${await res.text().catch(() => '')}`);
	const data = await res.json();
	return String(data.job_id);
}

export async function getRemovalJob(gatewayUrl: string, jobId: string): Promise<RobotJob> {
	const res = await fetch(`${gatewayUrl}/jobs/${jobId}`, { signal: AbortSignal.timeout(10_000) });
	if (!res.ok) throw new Error(`Robot gateway returned ${res.status}`);
	const data = await res.json();
	return {
		jobId,
		status: data.status,
		startedAt: data.started_at,
		finishedAt: data.finished_at,
		logTail: data.log_tail
	};
}

export async function cancelRemoval(gatewayUrl: string, jobId: string): Promise<void> {
	await fetch(`${gatewayUrl}/jobs/${jobId}/cancel`, { method: 'POST', signal: AbortSignal.timeout(10_000) });
}
