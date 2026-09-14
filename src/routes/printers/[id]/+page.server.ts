import { error, fail } from '@sveltejs/kit';
import fs from 'node:fs/promises';
import type { Actions, PageServerLoad } from './$types';
import { getPrinter, type Printer } from '$lib/server/printers/repo';
import { adapterFor } from '$lib/server/printers';
import { storage } from '$lib/server/storage';
import { getActiveBatch } from '$lib/server/batches';
import { cancelBatch, resumeBatch, startBatch } from '$lib/server/orchestrator/batch';
import {
	cancelManualJob,
	getManualJob,
	startManualJob
} from '$lib/server/orchestrator/manual-robot';

async function requirePrinter(id: string): Promise<Printer> {
	const printer = await getPrinter(Number(id));
	if (!printer) error(404, 'Printer not found');
	return printer;
}

/**
 * Deliberately DB-only. Listing the USB drive takes 6-12s on a real printer, so it
 * is fetched from /api/printers/[id]/files once the page is on screen instead of
 * blocking the first paint.
 */
export const load: PageServerLoad = async ({ params }) => {
	const printer = await requirePrinter(params.id);
	return {
		printer,
		batch: await getActiveBatch(printer.id),
		manualJob: getManualJob(printer.id)
	};
};

/**
 * Wraps a printer control action with uniform error reporting back to the form.
 * Whatever the handler returns becomes the message shown in the client's toast.
 */
function control(fn: (printer: Printer, form: FormData) => Promise<string>) {
	return async ({ params, request }: { params: { id: string }; request: Request }) => {
		const printer = await requirePrinter(params.id);
		let message: string;
		try {
			message = await fn(printer, await request.formData());
		} catch (err) {
			return fail(502, { error: err instanceof Error ? err.message : 'Printer command failed' });
		}
		return { message };
	};
}

const jobId = (form: FormData) => Number(form.get('jobId'));

export const actions: Actions = {
	pause: control(async (p, form) => {
		await adapterFor(p).pause(jobId(form));
		return 'Print paused.';
	}),
	resume: control(async (p, form) => {
		await adapterFor(p).resume(jobId(form));
		return 'Print resumed.';
	}),
	stop: control(async (p, form) => {
		await adapterFor(p).stop(jobId(form));
		return 'Print stopped.';
	}),
	startPrint: control(async (p, form) => {
		const name = String(form.get('file') ?? '');
		if (!name) throw new Error('No file selected');
		await adapterFor(p).startPrint(name);
		return `Printing ${name}.`;
	}),
	deleteFile: control(async (p, form) => {
		const name = String(form.get('file') ?? '');
		await adapterFor(p).deleteFile(name);
		// Don't leave the file's cached preview and metadata behind on disk.
		await Promise.all([
			fs.rm(storage.thumbnailPath(p.id, name), { force: true }).catch(() => {}),
			fs.rm(storage.fileMetaPath(p.id, name), { force: true }).catch(() => {})
		]);
		return `Deleted ${name} from the USB drive.`;
	}),
	uploadFile: control(async (p, form) => {
		const file = form.get('file');
		if (!(file instanceof File) || file.size === 0) throw new Error('No file selected');
		const name = file.name;
		if (!/\.(bgcode|gcode)$/i.test(name)) throw new Error('Only .bgcode and .gcode files can be printed');
		const data = Buffer.from(await file.arrayBuffer());
		await fs.writeFile(storage.gcodePath(name), data);
		await adapterFor(p).uploadFile(name, data);
		return `Uploaded ${name} to the USB drive.`;
	}),
	startBatch: control(async (p, form) => {
		const file = String(form.get('file') ?? '');
		const count = Number(form.get('count'));
		if (!file) throw new Error('Pick a file for the batch');
		if (!Number.isInteger(count) || count < 1) throw new Error('Part count must be at least 1');
		await startBatch(p.id, file, count, form.get('failure_detection') === 'on');
		return `Batch started — ${count} × ${file}.`;
	}),
	batchResumeRetry: control(async (p, form) => {
		await resumeBatch(Number(form.get('batchId')), 'retry');
		return 'Batch resumed — retrying the failed part.';
	}),
	batchResumeSkip: control(async (p, form) => {
		await resumeBatch(Number(form.get('batchId')), 'skip');
		return 'Batch resumed — skipped the failed part.';
	}),
	batchCancel: control(async (p, form) => {
		await cancelBatch(Number(form.get('batchId')));
		return 'Batch cancelled.';
	}),
	robotRemove: control(async (p) => {
		await startManualJob(p, 'pick_place');
		return 'Robot removal started.';
	}),
	robotReturnToOrigin: control(async (p) => {
		await startManualJob(p, 'return_to_origin');
		return 'Return to origin started.';
	}),
	robotCancel: control(async (p) => {
		await cancelManualJob(p);
		return 'Robot job cancelled.';
	})
};
