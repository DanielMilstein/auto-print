import { json, error } from '@sveltejs/kit';
import fs from 'node:fs/promises';
import type { RequestHandler } from './$types';
import { getPrinter } from '$lib/server/printers/repo';
import type { UsbFile } from '$lib/server/printers/adapter';
import { adapterFor } from '$lib/server/printers';
import { storage } from '$lib/server/storage';
import { parseBgcodeHeader } from '$lib/server/gcode/bgcode';
import { fromBgcodeHeader, fromGcodeComments, isEmptyMeta, printTimeFromName } from '$lib/server/gcode/meta';
import type { FileMeta, FileMetaResponse } from '$lib/usb';

/**
 * Download paths we're willing to read. Anchored, and rejects `..`, schemes and
 * protocol-relative `//`, mirroring the thumbnail endpoint's guard — the two
 * firmware shapes seen in the wild are `/usb/NAME.BGC` and
 * `/api/v1/files/usb/NAME/raw`.
 */
const REF_PATTERN = /^\/(usb|api\/v1\/files\/usb)\/[A-Za-z0-9._~%/+-]+$/;

/**
 * Enough for the uncompressed FileMetadata and PrinterMetadata blocks: on a real
 * XL file they end by byte 5780, and 9 KB yielded the same 24 keys as 384 KB did.
 */
const HEAD_BYTES = 16 * 1024;

export const GET: RequestHandler = async ({ params, url }) => {
	const printer = await getPrinter(Number(params.id));
	if (!printer) error(404, 'Printer not found');

	const file = url.searchParams.get('file') ?? '';
	const displayName = url.searchParams.get('displayName') || file;
	const ref = url.searchParams.get('ref');
	if (!file) error(400, 'No file given');

	const cachePath = storage.fileMetaPath(printer.id, file);
	const cached = await readCache(cachePath);
	if (cached) return json({ meta: cached, error: null } satisfies FileMetaResponse);

	const adapter = adapterFor(printer);
	// Started up front so its round-trip overlaps the header read rather than following it.
	const detail = adapter.getFile?.(file).catch(() => null) ?? Promise.resolve(null);

	let body: FileMetaResponse;
	try {
		const meta = await readMeta(adapter, file, ref);
		const filled = await withFallbacks(meta ?? { tools: [] }, displayName, detail);
		if (isEmptyMeta(filled)) {
			body = { meta: null, error: null };
		} else {
			await writeCache(cachePath, filled);
			body = { meta: filled, error: null };
		}
	} catch (err) {
		body = { meta: null, error: err instanceof Error ? err.message : 'Could not read file details' };
	} finally {
		await detail.catch(() => null); // never leave the request floating
	}
	return json(body);
};

async function readMeta(
	adapter: ReturnType<typeof adapterFor>,
	file: string,
	ref: string | null
): Promise<FileMeta | null> {
	// 1. An ASCII .gcode we uploaded: richest source, and free. It is the only one
	//    carrying the exact print time and per-tool filament weight.
	const local = await readLocalGcode(file);
	if (local) return local;

	// 2. The .bgcode header on the printer — one short read, aborted after 16 KB.
	if (ref && REF_PATTERN.test(ref) && !ref.includes('..') && adapter.fetchFileHead) {
		const head = await adapter.fetchFileHead(ref, HEAD_BYTES);
		const kv = parseBgcodeHeader(head);
		if (kv) return fromBgcodeHeader(kv);
		// Some firmwares serve ASCII .gcode from the same path.
		return fromGcodeComments(head);
	}

	return null;
}

/** Fills in what the file itself didn't provide: print time from the name, size from the printer. */
async function withFallbacks(
	meta: FileMeta,
	displayName: string,
	detail: Promise<UsbFile | null>
): Promise<FileMeta> {
	if (!meta.estimatedTime) {
		const fromName = printTimeFromName(displayName);
		if (fromName) meta.estimatedTime = fromName;
	}
	// The bulk listing omits size for every entry on a real drive; the detail call has it.
	const info = await detail;
	if (meta.sizeBytes == null && info?.sizeBytes != null) meta.sizeBytes = info.sizeBytes;
	if (meta.modifiedAt == null && info?.modifiedAt != null) meta.modifiedAt = info.modifiedAt;
	return meta;
}

async function readLocalGcode(file: string): Promise<FileMeta | null> {
	if (!/\.gcode$/i.test(file)) return null;
	let handle;
	try {
		handle = await fs.open(storage.gcodePath(file), 'r');
	} catch {
		return null;
	}
	try {
		// Slicer comments sit in the header, but the `filament used` and
		// `estimated printing time` lines are written in the footer, so read both ends.
		const { size } = await handle.stat();
		const head = Buffer.alloc(Math.min(HEAD_BYTES, size));
		await handle.read(head, 0, head.byteLength, 0);
		const tailBytes = Math.min(64 * 1024, size);
		const tail = Buffer.alloc(tailBytes);
		await handle.read(tail, 0, tailBytes, size - tailBytes);
		return fromGcodeComments(Buffer.concat([head, Buffer.from('\n'), tail]));
	} finally {
		await handle.close();
	}
}

async function readCache(path: string): Promise<FileMeta | null> {
	try {
		return JSON.parse(await fs.readFile(path, 'utf8')) as FileMeta;
	} catch {
		return null;
	}
}

/** Writes via a temp file so an aborted request can't leave truncated JSON behind. */
async function writeCache(path: string, meta: FileMeta): Promise<void> {
	const tmp = `${path}.tmp`;
	try {
		await fs.writeFile(tmp, JSON.stringify(meta));
		await fs.rename(tmp, path);
	} catch (err) {
		console.error(`[file-meta] could not cache ${path}:`, err);
		await fs.rm(tmp, { force: true }).catch(() => {});
	}
}
