import { error } from '@sveltejs/kit';
import fs from 'node:fs/promises';
import type { RequestHandler } from './$types';
import { getPrinter } from '$lib/server/printers/repo';
import { adapterFor } from '$lib/server/printers';
import { storage } from '$lib/server/storage';
import { extractGcodeThumbnail, sniffImageType } from '$lib/server/gcode/thumbnail';

/**
 * The printer path we're willing to proxy. Anchored, and rejects `..`, schemes and
 * protocol-relative `//` so a crafted ?ref can only ever reach the thumbnail routes
 * of the printer this id belongs to.
 */
const REF_PATTERN = /^\/(api\/thumbnails|thumb)\/[A-Za-z0-9._~%/+-]+$/;

/** Slicer thumbnails live in the file header; never read a 400 MB g-code into memory. */
const HEAD_BYTES = 2 * 1024 * 1024;

/** A preview never changes for a given file, and fetching one costs ~14s on real hardware. */
const CACHE_CONTROL = 'private, max-age=86400';

export const GET: RequestHandler = async ({ params, url }) => {
	const printer = await getPrinter(Number(params.id));
	if (!printer) error(404, 'Printer not found');

	const file = url.searchParams.get('file') ?? '';
	const ref = url.searchParams.get('ref');
	if (!file) error(400, 'No file given');

	// 1. Already on disk — the only fast path, and the reason the UI can show
	//    cached previews immediately instead of behind a button.
	const cached = await readCache(printer.id, file);
	if (cached) return imageResponse(cached.data, cached.contentType);

	// 2. The printer's own preview — covers .bgcode too, and costs no parsing.
	if (ref && REF_PATTERN.test(ref) && !ref.includes('..')) {
		const adapter = adapterFor(printer);
		if (adapter.fetchThumbnail) {
			try {
				const image = await adapter.fetchThumbnail(ref);
				if (sniffImageType(image.data)) {
					await writeCache(printer.id, file, image.data);
					return imageResponse(image.data, image.contentType);
				}
			} catch {
				// Fall through to the locally cached g-code.
			}
		}
	}

	// 3. The upload cache — ASCII .gcode only, since .bgcode stores previews in a binary block.
	if (/\.gcode$/i.test(file)) {
		const local = await readLocalThumbnail(file);
		if (local) {
			await writeCache(printer.id, file, local.data);
			return imageResponse(local.data, local.contentType);
		}
	}

	error(404, 'No thumbnail available for this file');
};

async function readCache(printerId: number, file: string) {
	let data: Buffer;
	try {
		data = await fs.readFile(storage.thumbnailPath(printerId, file));
	} catch {
		return null;
	}
	const contentType = sniffImageType(data);
	return contentType ? { data, contentType } : null;
}

/** Writes via a temp file so an aborted request can't leave a truncated cache entry. */
async function writeCache(printerId: number, file: string, data: Buffer): Promise<void> {
	const target = storage.thumbnailPath(printerId, file);
	const tmp = `${target}.tmp`;
	try {
		await fs.writeFile(tmp, data);
		await fs.rename(tmp, target);
	} catch (err) {
		console.error(`[thumbnail] could not cache ${file} for printer ${printerId}:`, err);
		await fs.rm(tmp, { force: true }).catch(() => {});
	}
}

async function readLocalThumbnail(file: string) {
	let handle;
	try {
		handle = await fs.open(storage.gcodePath(file), 'r');
	} catch {
		return null;
	}
	try {
		const head = Buffer.alloc(HEAD_BYTES);
		const { bytesRead } = await handle.read(head, 0, HEAD_BYTES, 0);
		return extractGcodeThumbnail(head.subarray(0, bytesRead));
	} finally {
		await handle.close();
	}
}

function imageResponse(data: Buffer, contentType: string): Response {
	return new Response(new Uint8Array(data), {
		headers: { 'content-type': contentType, 'cache-control': CACHE_CONTROL }
	});
}
