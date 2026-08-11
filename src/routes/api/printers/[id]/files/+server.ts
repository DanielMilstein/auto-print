import { json, error } from '@sveltejs/kit';
import fs from 'node:fs/promises';
import type { RequestHandler } from './$types';
import { getPrinter } from '$lib/server/printers/repo';
import { adapterFor } from '$lib/server/printers';
import { storage } from '$lib/server/storage';
import type { UsbFilesResponse } from '$lib/usb';

/**
 * Listing a full USB drive takes 6-12s on a real printer, so it is deliberately kept
 * out of the page load and fetched from here once the page is on screen. Like
 * /api/printers/[id]/state, it reports failure in the payload rather than a non-200,
 * so the card can render the reason in place.
 */
export const GET: RequestHandler = async ({ params }) => {
	const printer = await getPrinter(Number(params.id));
	if (!printer) error(404, 'Printer not found');

	let body: UsbFilesResponse;
	try {
		const files = await adapterFor(printer).listFiles();
		const cached = await cachedThumbnails(printer.id);
		body = {
			files: files.map((f) => ({
				...f,
				thumbnailCached: cached.has(`${storage.cacheKey(f.name)}.img`)
			})),
			error: null
		};
	} catch (err) {
		body = { files: [], error: err instanceof Error ? err.message : 'Could not list files' };
	}
	return json(body);
};

/** One readdir, rather than a stat per file. */
async function cachedThumbnails(printerId: number): Promise<Set<string>> {
	try {
		const names = await fs.readdir(storage.thumbnailsDir(printerId));
		return new Set(names.filter((n) => n.endsWith('.img')));
	} catch {
		return new Set();
	}
}
