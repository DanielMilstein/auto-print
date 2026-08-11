import fs from 'node:fs';
import path from 'node:path';
import { env } from '$env/dynamic/private';

const DATA_DIR = path.resolve(env.DATA_DIR ?? './data');

function dir(...parts: string[]): string {
	const p = path.join(DATA_DIR, ...parts);
	fs.mkdirSync(p, { recursive: true });
	return p;
}

export const storage = {
	/** Uploaded g-code cache, reusable across batch restarts. */
	gcodeDir: () => dir('gcode'),
	gcodePath: (fileName: string) => path.join(dir('gcode'), path.basename(fileName)),
	/**
	 * Slicer previews pulled off the printer. Fetching one costs ~14s on real
	 * hardware and the image never changes for a given file, so it is cached
	 * permanently. Extension-less: the content type is sniffed on read.
	 */
	thumbnailsDir: (printerId: number) => dir('thumbnails', String(printerId)),
	/** Printer file names can carry anything; cache entries stay a flat, safe basename. */
	cacheKey: (fileName: string) => path.basename(fileName).replace(/[^A-Za-z0-9._~-]/g, '_'),
	thumbnailPath: (printerId: number, fileName: string) =>
		path.join(dir('thumbnails', String(printerId)), `${storage.cacheKey(fileName)}.img`),
	/** Parsed slicer metadata. Immutable per file, same as the preview beside it. */
	fileMetaPath: (printerId: number, fileName: string) =>
		path.join(dir('filemeta', String(printerId)), `${storage.cacheKey(fileName)}.json`),
	failuresDir: () => dir('failures'),
	failurePath: (fileName: string) => path.join(dir('failures'), path.basename(fileName)),
	timelapsesDir: () => dir('timelapses'),
	timelapsePath: (...parts: string[]) => path.join(dir('timelapses'), ...parts)
};
