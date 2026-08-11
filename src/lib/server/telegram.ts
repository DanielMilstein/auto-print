import type { AlertSink, AppEvent } from './events';
import { getSetting } from './settings';

/** Event types the user cares about on their phone; the rest stay in the history log. */
const ALERT_WORTHY: ReadonlySet<string> = new Set([
	'failure_detected',
	'print_finished',
	'filament_runout',
	'state_change',
	'batch_finished',
	'batch_paused',
	'robot_error'
]);

async function api(token: string, method: string, body: FormData | string): Promise<void> {
	const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
		method: 'POST',
		headers: typeof body === 'string' ? { 'content-type': 'application/json' } : undefined,
		body,
		signal: AbortSignal.timeout(15_000)
	});
	if (!res.ok) {
		throw new Error(`Telegram ${method} failed: ${res.status} ${await res.text().catch(() => '')}`);
	}
}

export async function sendTelegramMessage(text: string, imageJpeg?: Buffer): Promise<void> {
	const [token, chatId] = await Promise.all([getSetting('telegram_bot_token'), getSetting('telegram_chat_id')]);
	if (!token || !chatId) return;

	if (imageJpeg) {
		const form = new FormData();
		form.set('chat_id', chatId);
		form.set('caption', text);
		form.set('photo', new Blob([new Uint8Array(imageJpeg)], { type: 'image/jpeg' }), 'alert.jpg');
		await api(token, 'sendPhoto', form);
	} else {
		await api(token, 'sendMessage', JSON.stringify({ chat_id: chatId, text }));
	}
}

export class TelegramAlertSink implements AlertSink {
	async send(event: AppEvent, imageJpeg?: Buffer): Promise<void> {
		if (!ALERT_WORTHY.has(event.type)) return;
		await sendTelegramMessage(event.message, imageJpeg);
	}
}
