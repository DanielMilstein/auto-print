import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPrinter } from '$lib/server/printers/repo';
import { adapterFor } from '$lib/server/printers';
import { getActiveBatch } from '$lib/server/batches';
import type { PrinterStatus } from '$lib/server/printers/adapter';

export const GET: RequestHandler = async ({ params }) => {
	const printer = await getPrinter(Number(params.id));
	if (!printer) error(404, 'Printer not found');

	let status: PrinterStatus;
	try {
		status = await adapterFor(printer).getStatus();
	} catch {
		status = { state: 'OFFLINE' };
	}
	return json({ printerId: printer.id, status, batch: await getActiveBatch(printer.id) });
};
