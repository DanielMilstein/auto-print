/** Wire shapes for GET /api/printers/[id]/files — shared by the endpoint and the client store. */

export interface UsbFileEntry {
	name: string;
	displayName: string;
	sizeBytes?: number;
	/** Printer-relative preview path, proxied by /api/printers/[id]/thumbnail. */
	thumbnailUrl?: string;
	/** Printer-relative path to the file's bytes, read by /api/printers/[id]/file-meta. */
	downloadUrl?: string;
	/** Unix seconds from the printer's filesystem. */
	modifiedAt?: number;
	/**
	 * A preview is already on disk, so it renders instantly. Uncached previews cost
	 * seconds against a real printer, so the UI keeps those behind a button.
	 */
	thumbnailCached: boolean;
}

export interface UsbFilesResponse {
	files: UsbFileEntry[];
	/** Set instead of a non-200 when the drive could not be read, so the card can show why. */
	error: string | null;
}

/**
 * One extruder's settings. Multi-tool printers store these as parallel lists
 * (`filament_type=PLA;PETG;…`, `nozzle_diameter=0.4,0.6,…`) and each tool is kept
 * separate — a 5-tool XL shows five rows, not one collapsed value.
 */
export interface ToolMeta {
	/** 1-based, as printers label their tools. */
	index: number;
	material?: string;
	nozzleMm?: number;
	nozzleTempC?: number;
	/** `#RRGGBB` from extruder_colour, rendered as a swatch. */
	colour?: string;
	/** ASCII .gcode only. 0 marks a tool this particular print doesn't use. */
	filamentGrams?: number;
}

/** Whatever could be learned about a file. Every field is optional; the UI renders what it gets. */
export interface FileMeta {
	tools: ToolMeta[];
	estimatedTime?: string;
	layerHeightMm?: number;
	infill?: string;
	printerModel?: string;
	/** The bed is one heater, so the slicer's per-filament values are joined. */
	bedTempC?: string;
	maxHeightMm?: number;
	producer?: string;
	sizeBytes?: number;
	modifiedAt?: number;
}

export interface FileMetaResponse {
	meta: FileMeta | null;
	error: string | null;
}
