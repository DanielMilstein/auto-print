export type PrinterState =
	| 'IDLE'
	| 'READY'
	| 'BUSY'
	| 'PRINTING'
	| 'PAUSED'
	| 'FINISHED'
	| 'STOPPED'
	| 'ERROR'
	| 'ATTENTION'
	| 'OFFLINE';

export interface JobInfo {
	id: number | null;
	fileName: string;
	/** 0-100 */
	progress: number;
	timeRemainingSec?: number;
	timePrintingSec?: number;
}

export interface PrinterStatus {
	state: PrinterState;
	nozzleTempC?: number;
	bedTempC?: number;
	job?: JobInfo;
}

export interface UsbFile {
	name: string;
	displayName: string;
	sizeBytes?: number;
	/**
	 * Printer-relative path to a preview image the printer renders for this file
	 * (PrusaLink exposes the slicer's embedded thumbnail this way). Proxied by
	 * /api/printers/[id]/thumbnail — never fetched by the browser directly.
	 */
	thumbnailUrl?: string;
	/**
	 * Printer-relative path to the file's bytes. Used to read the slicer metadata
	 * out of the header — never to download the whole file.
	 */
	downloadUrl?: string;
	/** Unix seconds, as reported by the printer's filesystem. */
	modifiedAt?: number;
}

/**
 * Brand-agnostic printer control surface. Every brand implementation must be
 * fully substitutable for another: same semantics, normalized states, and
 * errors thrown as PrinterUnreachableError when the machine can't be reached.
 */
export interface PrinterAdapter {
	getStatus(): Promise<PrinterStatus>;
	listFiles(): Promise<UsbFile[]>;
	fileExists(name: string): Promise<boolean>;
	uploadFile(name: string, data: Buffer): Promise<void>;
	deleteFile(name: string): Promise<void>;
	startPrint(name: string): Promise<void>;
	pause(jobId: number): Promise<void>;
	resume(jobId: number): Promise<void>;
	stop(jobId: number): Promise<void>;
	/**
	 * Fetches a preview image by the `thumbnailUrl` a listFiles() entry reported.
	 * Optional: brands that expose no previews simply omit it.
	 */
	fetchThumbnail?(ref: string): Promise<{ data: Buffer; contentType: string }>;
	/**
	 * Reads at most `maxBytes` from the start of a file and stops. Slicer metadata
	 * lives in the first few KB, and pulling a whole print file off a printer is
	 * minutes of work — this must never read to the end.
	 */
	fetchFileHead?(ref: string, maxBytes: number): Promise<Buffer>;
	/** Per-file detail, for fields the bulk listing leaves out (notably size). */
	getFile?(name: string): Promise<UsbFile | null>;
}

export class PrinterUnreachableError extends Error {
	constructor(host: string, cause?: unknown) {
		super(`Printer at ${host} is unreachable`);
		this.name = 'PrinterUnreachableError';
		this.cause = cause;
	}
}
