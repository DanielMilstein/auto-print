import type { PrinterInput } from './repo';

/** Parses the shared printer form (create + settings) into a PrinterInput. Throws on invalid JSON. */
export function parsePrinterForm(form: FormData): PrinterInput {
	const rawParams = String(form.get('robot_params_json') ?? '').trim();
	let robotParams: Record<string, string> = {};
	if (rawParams) {
		const parsed = JSON.parse(rawParams);
		if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
			throw new Error('Executor parameter overrides must be a JSON object');
		}
		robotParams = Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v)]));
	}
	return {
		name: String(form.get('name') ?? '').trim(),
		brand: 'prusa',
		host: String(form.get('host') ?? '').trim(),
		api_key: String(form.get('api_key') ?? '').trim(),
		vision_base_url: String(form.get('vision_base_url') ?? '').trim().replace(/\/$/, ''),
		stop_on_failure: form.get('stop_on_failure') === 'on',
		robot_gateway_url: String(form.get('robot_gateway_url') ?? '').trim().replace(/\/$/, ''),
		robot_task: String(form.get('robot_task') ?? '').trim(),
		robot_params_json: robotParams,
		timelapse_enabled: form.get('timelapse_enabled') === 'on',
		timelapse_interval_sec: Math.max(1, Number(form.get('timelapse_interval_sec') ?? 10) || 10),
		timelapse_fps: Math.max(1, Number(form.get('timelapse_fps') ?? 30) || 30),
		enabled: true
	};
}
