/** Payload shape posted by the vision service's HttpPostNotifier. */
export interface VisionAlertPayload {
	title?: string;
	text?: string;
	timestamp?: number;
	detections?: Array<{ label: string; score: number; bbox?: unknown }>;
	image_jpeg_base64?: string;
}
