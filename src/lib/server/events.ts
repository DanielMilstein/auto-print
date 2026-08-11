import { sql } from './db';

export type EventType =
	| 'failure_detected'
	| 'print_started'
	| 'print_finished'
	| 'printer_stopped'
	| 'state_change'
	| 'filament_runout'
	| 'batch_started'
	| 'batch_paused'
	| 'batch_resumed'
	| 'batch_finished'
	| 'batch_cancelled'
	| 'robot_started'
	| 'robot_finished'
	| 'robot_error';

export interface AppEvent {
	type: EventType;
	message: string;
	printerId?: number;
	jobId?: number;
	batchRunId?: number;
	data?: Record<string, unknown>;
}

/** Anything that can push an alert to the user (Telegram, future channels). */
export interface AlertSink {
	send(event: AppEvent, imageJpeg?: Buffer): Promise<void>;
}

// Keyed and kept on globalThis so dev HMR re-registration replaces instead of duplicating.
const g = globalThis as unknown as { __autoprintAlertSinks?: Map<string, AlertSink> };
g.__autoprintAlertSinks ??= new Map();
const sinks = g.__autoprintAlertSinks;

export function registerAlertSink(key: string, sink: AlertSink): void {
	sinks.set(key, sink);
}

/**
 * Records an event in the history log. With `alert: true` it is also fanned
 * out to every registered alert sink (fire-and-forget; a failing sink never
 * breaks the caller).
 */
export async function recordEvent(
	event: AppEvent,
	opts: { alert?: boolean; imageJpeg?: Buffer } = {}
): Promise<void> {
	await sql`INSERT INTO events ${sql({
		printer_id: event.printerId ?? null,
		job_id: event.jobId ?? null,
		batch_run_id: event.batchRunId ?? null,
		type: event.type,
		message: event.message,
		data_json: sql.json((event.data ?? {}) as never)
	})}`;
	if (opts.alert) {
		for (const sink of sinks.values()) {
			sink.send(event, opts.imageJpeg).catch((err) => console.error('[events] alert sink failed:', err));
		}
	}
}
