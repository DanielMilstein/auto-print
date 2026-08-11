import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { deletePrinter, getPrinter, updatePrinter } from '$lib/server/printers/repo';
import { parsePrinterForm } from '$lib/server/printers/form';
import { adapterFor } from '$lib/server/printers';
import { checkVisionHealth } from '$lib/server/vision';
import { checkRobotHealth } from '$lib/server/robot';
import { refreshPrinter } from '$lib/server/orchestrator';

export const load: PageServerLoad = async ({ params }) => {
	const printer = await getPrinter(Number(params.id));
	if (!printer) error(404, 'Printer not found');
	return { printer };
};

export const actions: Actions = {
	save: async ({ params, request }) => {
		let input;
		try {
			input = parsePrinterForm(await request.formData());
		} catch (err) {
			return fail(400, { error: err instanceof Error ? err.message : 'Invalid form' });
		}
		if (!input.name || !input.host) return fail(400, { error: 'Name and host are required' });
		await updatePrinter(Number(params.id), input);
		await refreshPrinter(Number(params.id));
		return { message: 'Settings saved.' };
	},
	delete: async ({ params }) => {
		await deletePrinter(Number(params.id));
		await refreshPrinter(Number(params.id));
		redirect(303, '/');
	},
	testPrinter: async ({ params }) => {
		const printer = await getPrinter(Number(params.id));
		if (!printer) error(404);
		try {
			const status = await adapterFor(printer).getStatus();
			return { message: `Printer reachable — state ${status.state}` };
		} catch (err) {
			return fail(502, { error: err instanceof Error ? err.message : 'Printer unreachable' });
		}
	},
	testVision: async ({ params }) => {
		const printer = await getPrinter(Number(params.id));
		if (!printer) error(404);
		if (!printer.vision_base_url) return fail(400, { error: 'No vision service URL configured' });
		const health = await checkVisionHealth(printer.vision_base_url);
		if (!health.ok) return fail(502, { error: health.error });
		return { message: `Vision service reachable — ml_api ${health.mlApi ? 'up' : 'down'}, camera frame ${health.frame ? 'available' : 'missing'}` };
	},
	testRobot: async ({ params }) => {
		const printer = await getPrinter(Number(params.id));
		if (!printer) error(404);
		if (!printer.robot_gateway_url) return fail(400, { error: 'No robot gateway URL configured' });
		const health = await checkRobotHealth(printer.robot_gateway_url);
		if (!health.ok) return fail(502, { error: health.error });
		return { message: `Robot gateway reachable${health.busy ? ' — a removal job is running' : ''}` };
	}
};
