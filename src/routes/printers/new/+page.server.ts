import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import { createPrinter } from '$lib/server/printers/repo';
import { parsePrinterForm } from '$lib/server/printers/form';
import { refreshPrinter } from '$lib/server/orchestrator';

export const actions: Actions = {
	create: async ({ request }) => {
		let input;
		try {
			input = parsePrinterForm(await request.formData());
		} catch (err) {
			return fail(400, { error: err instanceof Error ? err.message : 'Invalid form' });
		}
		if (!input.name || !input.host) return fail(400, { error: 'Name and host are required' });
		const id = await createPrinter(input);
		await refreshPrinter(id);
		redirect(303, `/printers/${id}`);
	}
};
