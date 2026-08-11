import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { PrusaLinkAdapter } from './prusalink';
import { PrinterUnreachableError } from './adapter';

const PORT = 8971;
let mock: ChildProcess;

beforeAll(async () => {
	mock = spawn('node', [path.resolve('mock/mock-prusalink.mjs'), String(PORT), '2'], { stdio: 'ignore' });
	// wait for the mock to listen
	for (let i = 0; i < 50; i++) {
		try {
			await fetch(`http://localhost:${PORT}/api/v1/info`);
			return;
		} catch {
			await new Promise((r) => setTimeout(r, 100));
		}
	}
	throw new Error('mock printer did not start');
});

afterAll(() => {
	mock.kill();
});

describe('PrusaLinkAdapter (against mock PrusaLink)', () => {
	const adapter = new PrusaLinkAdapter(`localhost:${PORT}`, 'test-key');

	it('runs the full print lifecycle', async () => {
		expect((await adapter.getStatus()).state).toBe('IDLE');

		await adapter.uploadFile('part.gcode', Buffer.from('G1 X0\n'));
		expect(await adapter.fileExists('part.gcode')).toBe(true);
		expect((await adapter.listFiles()).map((f) => f.name)).toContain('part.gcode');

		await adapter.startPrint('part.gcode');
		let status = await adapter.getStatus();
		expect(status.state).toBe('PRINTING');
		expect(status.job?.fileName).toBe('part.gcode');
		const jobId = status.job!.id!;

		await adapter.pause(jobId);
		expect((await adapter.getStatus()).state).toBe('PAUSED');
		await adapter.resume(jobId);
		expect((await adapter.getStatus()).state).toBe('PRINTING');
		await adapter.stop(jobId);
		expect((await adapter.getStatus()).state).toBe('STOPPED');

		await adapter.deleteFile('part.gcode');
		expect(await adapter.fileExists('part.gcode')).toBe(false);
	});

	it('carries the printer refs and mtime through listFiles', async () => {
		const file = (await adapter.listFiles()).find((f) => f.name === 'benchy.bgcode');
		expect(file?.sizeBytes).toBeGreaterThan(0);
		expect(file?.thumbnailUrl).toBe('/api/thumbnails/usb/benchy.bgcode.orig.png');
		expect(file?.downloadUrl).toBe('/usb/benchy.bgcode');
		expect(file?.modifiedAt).toBeGreaterThan(0);
	});

	it('reads per-file detail', async () => {
		const file = await adapter.getFile('benchy.bgcode');
		expect(file?.displayName).toBe('benchy.bgcode');
		expect(file?.sizeBytes).toBeGreaterThan(0);
		expect(await adapter.getFile('nope.bgcode')).toBeNull();
	});

	it('reads only the head of a file and stops', async () => {
		const head = await adapter.fetchFileHead('/usb/benchy.bgcode', 32);
		expect(head.byteLength).toBe(32);
		expect(head.subarray(0, 4).toString('latin1')).toBe('GCDE');
	});

	it('fetches a thumbnail by ref', async () => {
		const image = await adapter.fetchThumbnail('/api/thumbnails/usb/benchy.bgcode.orig.png');
		expect(image.contentType).toBe('image/png');
		expect(image.data.subarray(0, 4).toString('hex')).toBe('89504e47');
	});

	it('reports unreachable hosts as PrinterUnreachableError', async () => {
		const dead = new PrusaLinkAdapter('localhost:1', 'k');
		await expect(dead.getStatus()).rejects.toBeInstanceOf(PrinterUnreachableError);
	});
});
