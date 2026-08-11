import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPrinter } from '$lib/server/printers/repo';
import { fetchSnapshot } from '$lib/server/vision';

export const GET: RequestHandler = async ({ params }) => {
	const printer = await getPrinter(Number(params.id));
	if (!printer) error(404, 'Printer not found');
	if (!printer.vision_base_url) error(404, 'No vision service configured for this printer');

	const image = await fetchSnapshot(printer.vision_base_url);
	if (!image) error(502, 'No camera frame available');

	return new Response(new Uint8Array(image), {
		headers: { 'content-type': 'image/jpeg', 'cache-control': 'no-store' }
	});
};
