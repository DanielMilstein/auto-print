export interface GcodeThumbnail {
	data: Buffer;
	contentType: string;
	width: number;
	height: number;
}

/** `; thumbnail begin 380x285 35112` — the bare marker means PNG; _JPG/_QOI are the variants. */
const BEGIN = /^;\s*thumbnail(_[A-Z]+)?\s+begin\s+(\d+)x(\d+)\s+(\d+)\s*$/i;
const END = /^;\s*thumbnail(_[A-Z]+)?\s+end\s*$/i;

const MAGIC: Record<string, { bytes: number[]; contentType: string }> = {
	PNG: { bytes: [0x89, 0x50, 0x4e, 0x47], contentType: 'image/png' },
	JPG: { bytes: [0xff, 0xd8, 0xff], contentType: 'image/jpeg' }
};

/**
 * Content type of an image from its leading bytes, or null if it isn't one we
 * recognise. Lets cached previews be stored without an extension or sidecar.
 */
export function sniffImageType(data: Buffer): string | null {
	for (const { bytes, contentType } of Object.values(MAGIC)) {
		if (bytes.every((b, n) => data[n] === b)) return contentType;
	}
	return null;
}

/**
 * Pulls the largest slicer-embedded preview out of an ASCII g-code header.
 *
 * PrusaSlicer writes each thumbnail as base64 across `;`-prefixed comment lines
 * between begin/end markers. QOI blocks are skipped — we have no decoder, and a
 * PNG block is always emitted alongside them.
 *
 * Deliberately dependency-free (no $lib/server/storage, no $env) so it unit-tests
 * under the project's bare Vitest config.
 */
export function extractGcodeThumbnail(head: Buffer | string): GcodeThumbnail | null {
	const lines = (typeof head === 'string' ? head : head.toString('latin1')).split(/\r?\n/);
	let best: GcodeThumbnail | null = null;

	for (let i = 0; i < lines.length; i++) {
		const begin = BEGIN.exec(lines[i]);
		if (!begin) continue;

		const format = (begin[1] ?? '_PNG').slice(1).toUpperCase();
		const magic = MAGIC[format];
		const width = Number(begin[2]);
		const height = Number(begin[3]);
		// The declared size is the base64 character count, not the decoded byte count.
		const declaredChars = Number(begin[4]);

		const chunks: string[] = [];
		let closed = false;
		for (i++; i < lines.length; i++) {
			if (END.test(lines[i])) {
				closed = true;
				break;
			}
			const payload = /^;\s*(.*)$/.exec(lines[i]);
			// A non-comment line means the block was truncated mid-write.
			if (!payload) break;
			chunks.push(payload[1].trim());
		}

		// Unsupported format (QOI) still had to be consumed so we resume after it.
		if (!closed || !magic) continue;

		const base64 = chunks.join('');
		if (base64.length !== declaredChars) continue;

		const data = Buffer.from(base64, 'base64');
		if (!magic.bytes.every((b, n) => data[n] === b)) continue;

		if (!best || width * height > best.width * best.height) {
			best = { data, contentType: magic.contentType, width, height };
		}
	}

	return best;
}
