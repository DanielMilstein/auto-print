/**
 * Minimal reader for the binary g-code container PrusaSlicer emits (.bgcode).
 *
 * Only the header is of interest: the FileMetadata and PrinterMetadata blocks sit
 * at the very front and are stored *uncompressed* as INI text, so the slicer
 * settings for a file can be read from its first few kilobytes without pulling
 * the whole thing. Verified against a real Prusa XL file, where PrinterMetadata
 * ends by byte 5780 while the first thumbnail does not start until 5780 and the
 * (compressed) PrintMetadata is 350 KB in.
 *
 * Deliberately dependency-free — no decompression, no checksum verification — so
 * it unit-tests under the project's bare Vitest config.
 */

const MAGIC = 'GCDE';
const HEADER_BYTES = 10; // magic(4) + version(4) + checksum_type(2)

const enum BlockType {
	FileMetadata = 0,
	GCode = 1,
	SlicerMetadata = 2,
	PrinterMetadata = 3,
	PrintMetadata = 4,
	Thumbnail = 5
}

const NO_COMPRESSION = 0;

/**
 * Merged key/values of the uncompressed metadata blocks at the head of a .bgcode
 * file, or null if this isn't one. Safe to call with a truncated head — parsing
 * stops as soon as a block runs past the end of the buffer.
 */
export function parseBgcodeHeader(head: Buffer): Record<string, string> | null {
	if (head.subarray(0, 4).toString('latin1') !== MAGIC) return null;

	const checksumBytes = head.readUInt16LE(8) === 0 ? 0 : 4;
	const values: Record<string, string> = {};
	let offset = HEADER_BYTES;

	while (offset + 8 <= head.byteLength) {
		const type = head.readUInt16LE(offset);
		const compression = head.readUInt16LE(offset + 2);
		const uncompressedSize = head.readUInt32LE(offset + 4);
		let cursor = offset + 8;

		// Everything we want precedes the thumbnails; past them lie only large,
		// compressed blocks, so there is no reason to keep walking.
		if (type === BlockType.Thumbnail || type === BlockType.GCode) break;

		let dataSize = uncompressedSize;
		if (compression !== NO_COMPRESSION) {
			if (cursor + 4 > head.byteLength) break;
			dataSize = head.readUInt32LE(cursor);
			cursor += 4;
		}

		// Metadata blocks carry a u16 encoding field ahead of their payload.
		if (cursor + 2 > head.byteLength) break;
		cursor += 2;

		if (cursor + dataSize > head.byteLength) break;

		if (compression === NO_COMPRESSION && isMetadata(type)) {
			parseIni(head.toString('utf8', cursor, cursor + dataSize), values);
		}

		offset = cursor + dataSize + checksumBytes;
	}

	return Object.keys(values).length > 0 ? values : null;
}

function isMetadata(type: number): boolean {
	return (
		type === BlockType.FileMetadata ||
		type === BlockType.PrinterMetadata ||
		type === BlockType.PrintMetadata ||
		type === BlockType.SlicerMetadata
	);
}

function parseIni(text: string, into: Record<string, string>): void {
	for (const line of text.split('\n')) {
		const eq = line.indexOf('=');
		if (eq <= 0) continue;
		const key = line.slice(0, eq).trim();
		if (key) into[key] = line.slice(eq + 1).trim();
	}
}
