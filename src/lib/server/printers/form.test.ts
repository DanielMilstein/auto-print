import { describe, expect, it } from 'vitest';
import { parsePrinterForm } from './form';

function formWith(entries: Record<string, string>): FormData {
	const form = new FormData();
	for (const [k, v] of Object.entries(entries)) form.set(k, v);
	return form;
}

describe('parsePrinterForm', () => {
	it('parses a full form', () => {
		const input = parsePrinterForm(
			formWith({
				name: 'XL',
				host: '192.168.1.50',
				api_key: 'k',
				vision_base_url: 'http://jetson:8080/',
				stop_on_failure: 'on',
				robot_gateway_url: 'http://robot:8090',
				robot_task: 'pick the part',
				robot_params_json: '{"table_z_m": 0.16}',
				timelapse_enabled: 'on',
				timelapse_interval_sec: '5',
				timelapse_fps: '24'
			})
		);
		expect(input.name).toBe('XL');
		expect(input.vision_base_url).toBe('http://jetson:8080'); // trailing slash stripped
		expect(input.stop_on_failure).toBe(true);
		expect(input.robot_params_json).toEqual({ table_z_m: '0.16' }); // values normalized to strings
		expect(input.timelapse_interval_sec).toBe(5);
	});

	it('defaults unchecked toggles to false and empty params to {}', () => {
		const input = parsePrinterForm(formWith({ name: 'XL', host: 'h' }));
		expect(input.stop_on_failure).toBe(false);
		expect(input.timelapse_enabled).toBe(false);
		expect(input.robot_params_json).toEqual({});
	});

	it('rejects non-object params JSON', () => {
		expect(() => parsePrinterForm(formWith({ name: 'XL', host: 'h', robot_params_json: '[1,2]' }))).toThrow();
		expect(() => parsePrinterForm(formWith({ name: 'XL', host: 'h', robot_params_json: 'not json' }))).toThrow();
	});

	it('clamps bad numeric values to sane defaults', () => {
		const input = parsePrinterForm(
			formWith({ name: 'XL', host: 'h', timelapse_interval_sec: '-3', timelapse_fps: 'abc' })
		);
		expect(input.timelapse_interval_sec).toBeGreaterThanOrEqual(1);
		expect(input.timelapse_fps).toBe(30);
	});
});
