import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { sql } from '$lib/server/db';
import { setFailureCause } from '$lib/server/jobs';
import { listPrinters } from '$lib/server/printers/repo';

export const load: PageServerLoad = async ({ url }) => {
	const printerId = Number(url.searchParams.get('printer')) || null;
	const status = url.searchParams.get('status') || null;

	const jobs = await sql`
		SELECT j.*, p.name AS printer_name
		FROM print_jobs j JOIN printers p ON p.id = j.printer_id
		WHERE (${printerId}::int IS NULL OR j.printer_id = ${printerId})
		AND (${status}::text IS NULL OR j.status = ${status})
		ORDER BY j.id DESC LIMIT 100`;

	const batches = await sql`
		SELECT b.*, p.name AS printer_name
		FROM batch_runs b JOIN printers p ON p.id = b.printer_id
		ORDER BY b.id DESC LIMIT 50`;

	const events = await sql`
		SELECT e.*, p.name AS printer_name
		FROM events e LEFT JOIN printers p ON p.id = e.printer_id
		ORDER BY e.id DESC LIMIT 200`;

	return {
		jobs: jobs as unknown as Record<string, unknown>[],
		batches: batches as unknown as Record<string, unknown>[],
		events: events as unknown as Record<string, unknown>[],
		printers: await listPrinters(),
		filters: { printerId, status }
	};
};

export const actions: Actions = {
	saveFailureCause: async ({ request }) => {
		const form = await request.formData();
		const jobId = Number(form.get('jobId'));
		const cause = String(form.get('cause') ?? '').trim();
		if (!jobId) return fail(400, { error: 'Missing job' });
		await setFailureCause(jobId, cause);
		return { message: 'Failure cause saved.' };
	}
};
