import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPrinter } from '$lib/server/printers/repo';
import { streamUrl } from '$lib/server/vision';

/** Proxies the vision service's MJPEG stream so camera feeds stay behind the app's session auth. */
export const GET: RequestHandler = async ({ params, request }) => {
	const printer = await getPrinter(Number(params.id));
	if (!printer) error(404, 'Printer not found');
	if (!printer.vision_base_url) error(404, 'No vision service configured for this printer');

	let upstream: Response;
	try {
		upstream = await fetch(streamUrl(printer.vision_base_url), { signal: request.signal });
	} catch {
		error(502, 'Vision service unreachable');
	}
	if (!upstream.ok || !upstream.body) error(502, 'Vision service returned no stream');

	return new Response(upstream.body, {
		headers: {
			'content-type': upstream.headers.get('content-type') ?? 'multipart/x-mixed-replace',
			'cache-control': 'no-store'
		}
	});
};
