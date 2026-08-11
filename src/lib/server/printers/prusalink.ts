import {
	PrinterUnreachableError,
	type JobInfo,
	type PrinterAdapter,
	type PrinterState,
	type PrinterStatus,
	type UsbFile
} from './adapter';

const STATUS_TIMEOUT_MS = 10_000;
// USB writes on the printer are slow; large .bgcode uploads need a generous window.
const UPLOAD_TIMEOUT_MS = 5 * 60_000;
// Enumerating a full USB drive is slow: a real XL took 6-12s for 381 files.
const LIST_TIMEOUT_MS = 45_000;
// A single 133 KB preview off the same printer measured 13.8s once and 24.4s the
// next time. It is cached forever afterwards, so wait generously rather than fail.
const THUMBNAIL_TIMEOUT_MS = 60_000;
// Only the first few KB are read, which measured 169-347ms across real files.
const HEAD_TIMEOUT_MS = 20_000;

/** PrusaLink v1 REST client (Prusa XL / MK4 / Core One). */
export class PrusaLinkAdapter implements PrinterAdapter {
	constructor(
		private readonly host: string,
		private readonly apiKey: string
	) {}

	private async request(
		method: string,
		path: string,
		opts: { body?: Buffer; headers?: Record<string, string>; timeoutMs?: number } = {}
	): Promise<Response> {
		const url = `http://${this.host}${path}`;
		let res: Response;
		try {
			res = await fetch(url, {
				method,
				headers: { 'X-Api-Key': this.apiKey, ...opts.headers },
				body: opts.body as BodyInit | undefined,
				signal: AbortSignal.timeout(opts.timeoutMs ?? STATUS_TIMEOUT_MS)
			});
		} catch (err) {
			throw new PrinterUnreachableError(this.host, err);
		}
		if (!res.ok && res.status !== 204) {
			const text = await res.text().catch(() => '');
			throw new Error(`PrusaLink ${method} ${path} -> ${res.status} ${text}`.trim());
		}
		return res;
	}

	async getStatus(): Promise<PrinterStatus> {
		const res = await this.request('GET', '/api/v1/status');
		const data = await res.json();
		const state = normalizeState(data?.printer?.state);
		const status: PrinterStatus = {
			state,
			nozzleTempC: data?.printer?.temp_nozzle,
			bedTempC: data?.printer?.temp_bed
		};
		if (data?.job?.id != null) {
			status.job = await this.getJob(data.job);
		}
		return status;
	}

	/** `statusJob` is the summary from /status; /api/v1/job fills in the file name. */
	private async getJob(statusJob: { id: number; progress?: number }): Promise<JobInfo> {
		const job: JobInfo = {
			id: statusJob.id,
			fileName: '',
			progress: statusJob.progress ?? 0
		};
		try {
			const res = await this.request('GET', '/api/v1/job');
			if (res.status !== 204) {
				const data = await res.json();
				job.fileName = data?.file?.display_name ?? data?.file?.name ?? '';
				job.progress = data?.progress ?? job.progress;
				job.timeRemainingSec = data?.time_remaining ?? undefined;
				job.timePrintingSec = data?.time_printing ?? undefined;
			}
		} catch {
			// /status already gave us id + progress; the job detail is best-effort
		}
		return job;
	}

	async listFiles(): Promise<UsbFile[]> {
		const res = await this.request('GET', '/api/v1/files/usb/', { timeoutMs: LIST_TIMEOUT_MS });
		const data = await res.json();
		const children: unknown[] = Array.isArray(data?.children) ? data.children : [];
		return children
			.filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null)
			.filter((c) => c.type === 'PRINT_FILE' || isPrintableName(String(c.name ?? '')))
			.map(toUsbFile);
	}

	/**
	 * Per-file detail. Worth a call because the bulk listing omits `size` for every
	 * entry on a real drive, while this returns it.
	 */
	async getFile(name: string): Promise<UsbFile | null> {
		try {
			const res = await this.request('GET', `/api/v1/files/usb/${encodeURIComponent(name)}`);
			const data = await res.json();
			return typeof data === 'object' && data !== null ? toUsbFile(data) : null;
		} catch {
			return null;
		}
	}

	/** Fetches a preview image the printer serves for a file, e.g. the slicer thumbnail. */
	async fetchThumbnail(ref: string): Promise<{ data: Buffer; contentType: string }> {
		const res = await this.request('GET', ref, { timeoutMs: THUMBNAIL_TIMEOUT_MS });
		return {
			data: Buffer.from(await res.arrayBuffer()),
			contentType: res.headers.get('content-type') ?? 'image/png'
		};
	}

	/**
	 * Reads the first `maxBytes` of a file and cancels the response. PrusaLink
	 * serves no Range header, so this is the only way to avoid pulling an entire
	 * print file: ~250ms for 9 KB versus 60s+ for the whole thing.
	 */
	async fetchFileHead(ref: string, maxBytes: number): Promise<Buffer> {
		const res = await this.request('GET', ref, { timeoutMs: HEAD_TIMEOUT_MS });
		if (!res.body) return Buffer.alloc(0);

		const reader = res.body.getReader();
		const chunks: Uint8Array[] = [];
		let read = 0;
		try {
			while (read < maxBytes) {
				const { done, value } = await reader.read();
				if (done) break;
				chunks.push(value);
				read += value.length;
			}
		} finally {
			await reader.cancel().catch(() => {});
		}
		return Buffer.concat(chunks).subarray(0, maxBytes);
	}

	async fileExists(name: string): Promise<boolean> {
		try {
			const res = await fetch(`http://${this.host}/api/v1/files/usb/${encodeURIComponent(name)}`, {
				method: 'HEAD',
				headers: { 'X-Api-Key': this.apiKey },
				signal: AbortSignal.timeout(STATUS_TIMEOUT_MS)
			});
			return res.ok;
		} catch (err) {
			throw new PrinterUnreachableError(this.host, err);
		}
	}

	async uploadFile(name: string, data: Buffer): Promise<void> {
		await this.request('PUT', `/api/v1/files/usb/${encodeURIComponent(name)}`, {
			body: data,
			headers: {
				'Content-Type': 'application/octet-stream',
				'Content-Length': String(data.byteLength),
				Overwrite: '?1'
			},
			timeoutMs: UPLOAD_TIMEOUT_MS
		});
	}

	async deleteFile(name: string): Promise<void> {
		await this.request('DELETE', `/api/v1/files/usb/${encodeURIComponent(name)}`);
	}

	async startPrint(name: string): Promise<void> {
		await this.request('POST', `/api/v1/files/usb/${encodeURIComponent(name)}`);
	}

	async pause(jobId: number): Promise<void> {
		await this.request('PUT', `/api/v1/job/${jobId}/pause`);
	}

	async resume(jobId: number): Promise<void> {
		await this.request('PUT', `/api/v1/job/${jobId}/resume`);
	}

	async stop(jobId: number): Promise<void> {
		await this.request('DELETE', `/api/v1/job/${jobId}`);
	}
}

const KNOWN_STATES: PrinterState[] = [
	'IDLE',
	'READY',
	'BUSY',
	'PRINTING',
	'PAUSED',
	'FINISHED',
	'STOPPED',
	'ERROR',
	'ATTENTION'
];

function normalizeState(raw: unknown): PrinterState {
	const upper = String(raw ?? '').toUpperCase();
	return (KNOWN_STATES as string[]).includes(upper) ? (upper as PrinterState) : 'ERROR';
}

function isPrintableName(name: string): boolean {
	const lower = name.toLowerCase();
	return lower.endsWith('.bgcode') || lower.endsWith('.gcode');
}

function toUsbFile(c: Record<string, unknown>): UsbFile {
	const refs = (typeof c.refs === 'object' && c.refs !== null ? c.refs : {}) as Record<string, unknown>;
	return {
		name: String(c.name ?? ''),
		displayName: String(c.display_name ?? c.name ?? ''),
		sizeBytes: typeof c.size === 'number' ? c.size : undefined,
		// Prefer the full-size preview, falling back to the small icon.
		thumbnailUrl: printerPath(refs.thumbnail) ?? printerPath(refs.icon),
		downloadUrl: printerPath(refs.download),
		modifiedAt: typeof c.m_timestamp === 'number' ? c.m_timestamp : undefined
	};
}

/** Accepts only a printer-relative path, so a ref can never point at another host. */
function printerPath(ref: unknown): string | undefined {
	if (typeof ref !== 'string' || !ref.startsWith('/') || ref.startsWith('//')) return undefined;
	return ref;
}
