/** Client for the robot_gateway HTTP service (one arm per printer). */

const REMOVAL_JOB_TIMEOUT_SEC = 1200;

/**
 * `return_to_origin` drives the base home; its two 60 s phases plus the odom
 * wait cap it near 123 s, so 180 s leaves slack without masking a hang.
 */
const RETURN_TO_ORIGIN_TIMEOUT_SEC = 180;

/** Used whenever a printer has no `robot_task` of its own. */
export const DEFAULT_REMOVAL_TASK = 'pick the printed part off the print bed and place it in the bin';

/** Which command the gateway runs. Omitted by older gateways, which only ever did `pick_place`. */
export type RobotJobKind = 'pick_place' | 'return_to_origin';

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

/** Posts one job to the gateway and returns its id. */
async function postJob(gatewayUrl: string, body: Record<string, unknown>): Promise<string> {
	const res = await fetch(`${gatewayUrl}/jobs`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(15_000)
	});
	if (res.status === 409) throw new Error('The robot arm is busy with another job');
	if (!res.ok) throw new Error(`Robot gateway returned ${res.status}: ${await res.text().catch(() => '')}`);
	const data = await res.json();
	return String(data.job_id);
}

export async function startRemoval(gatewayUrl: string, req: RemovalRequest): Promise<string> {
	return postJob(gatewayUrl, {
		kind: 'pick_place',
		task: req.task,
		params: req.params,
		gemini_api_keys: req.geminiApiKeys,
		timeout_sec: REMOVAL_JOB_TIMEOUT_SEC
	});
}

/** Drives the base back to the odometry origin. Takes no task and no API keys. */
export async function startReturnToOrigin(gatewayUrl: string): Promise<string> {
	return postJob(gatewayUrl, {
		kind: 'return_to_origin',
		task: '',
		params: {},
		gemini_api_keys: [],
		timeout_sec: RETURN_TO_ORIGIN_TIMEOUT_SEC
	});
}

/**
 * Polls one job. Throws on transport trouble so callers keep retrying, except
 * for a 404: the gateway holds its jobs in memory, so an id it does not know
 * belongs to a job lost in a gateway restart. That job is over, and it is
 * reported here as failed rather than left to the pollers' give-up timers.
 */
export async function getRemovalJob(gatewayUrl: string, jobId: string): Promise<RobotJob> {
	const res = await fetch(`${gatewayUrl}/jobs/${jobId}`, { signal: AbortSignal.timeout(10_000) });
	if (res.status === 404) {
		return {
			jobId,
			status: 'failed',
			finishedAt: new Date().toISOString(),
			logTail: ['[autoprint] the gateway no longer knows this job — it probably restarted mid-run']
		};
	}
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
