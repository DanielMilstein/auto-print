import { redirect, type Handle } from '@sveltejs/kit';
import { randomBytes } from 'node:crypto';
import { ready } from '$lib/server/db';
import { ensurePasswordSeeded, isValidSession, SESSION_COOKIE } from '$lib/server/auth';
import { getSetting, setSetting } from '$lib/server/settings';
import { registerLifecycleListener, startOrchestrator } from '$lib/server/orchestrator';
import { batchLifecycleListener, recoverBatches } from '$lib/server/orchestrator/batch';
import { registerAlertSink } from '$lib/server/events';
import { TelegramAlertSink } from '$lib/server/telegram';
import { TimelapseRecorder } from '$lib/server/timelapse';

async function ensureWebhookSecret(): Promise<void> {
	if (await getSetting('webhook_secret')) return;
	await setSetting('webhook_secret', randomBytes(24).toString('hex'));
}

const boot = ready()
	.then(ensurePasswordSeeded)
	.then(ensureWebhookSecret)
	.then(() => {
		registerAlertSink('telegram', new TelegramAlertSink());
		registerLifecycleListener('timelapse', new TimelapseRecorder());
		registerLifecycleListener('batch', batchLifecycleListener);
	})
	.then(startOrchestrator)
	.then(recoverBatches);

/** Routes reachable without a session cookie. The vision webhook authenticates with its own shared secret. */
function isPublic(pathname: string): boolean {
	return pathname === '/login' || pathname.startsWith('/api/webhooks/');
}

export const handle: Handle = async ({ event, resolve }) => {
	await boot;

	if (!isPublic(event.url.pathname)) {
		const authed = await isValidSession(event.cookies.get(SESSION_COOKIE));
		if (!authed) {
			if (event.url.pathname.startsWith('/api/')) {
				return new Response('Unauthorized', { status: 401 });
			}
			redirect(303, '/login');
		}
		event.locals.authed = true;
	}

	return resolve(event);
};
