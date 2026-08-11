import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSetting } from '$lib/server/settings';
import { onFailureAlert } from '$lib/server/orchestrator';
import type { VisionAlertPayload } from '$lib/server/orchestrator/types';

export const POST: RequestHandler = async ({ params, request }) => {
	const secret = await getSetting('webhook_secret');
	if (!secret || request.headers.get('x-webhook-token') !== secret) {
		error(401, 'Invalid webhook token');
	}

	let payload: VisionAlertPayload;
	try {
		payload = await request.json();
	} catch {
		error(400, 'Expected a JSON body');
	}

	try {
		const result = await onFailureAlert(Number(params.printerId), payload);
		return json({ ok: true, ...result });
	} catch (err) {
		error(404, err instanceof Error ? err.message : 'Unknown printer');
	}
};
