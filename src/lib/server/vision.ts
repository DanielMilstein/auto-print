/** Client for the per-printer vision (failure detection) service. */

export interface VisionHealth {
	ok: boolean;
	mlApi?: boolean;
	frame?: boolean;
	error?: string;
}

export function streamUrl(visionBaseUrl: string): string {
	return `${visionBaseUrl}/stream.mjpg`;
}

export function snapshotUrl(visionBaseUrl: string): string {
	return `${visionBaseUrl}/snapshot.jpg`;
}

export async function checkVisionHealth(visionBaseUrl: string): Promise<VisionHealth> {
	try {
		const res = await fetch(`${visionBaseUrl}/hc/`, { signal: AbortSignal.timeout(5000) });
		if (!res.ok) return { ok: false, error: `Vision service returned ${res.status}` };
		const data = await res.json();
		return { ok: true, mlApi: !!data.ml_api, frame: !!data.frame };
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : 'Vision service unreachable' };
	}
}

export async function fetchSnapshot(visionBaseUrl: string): Promise<Buffer | null> {
	try {
		const res = await fetch(snapshotUrl(visionBaseUrl), { signal: AbortSignal.timeout(5000) });
		if (!res.ok) return null;
		return Buffer.from(await res.arrayBuffer());
	} catch {
		return null;
	}
}
