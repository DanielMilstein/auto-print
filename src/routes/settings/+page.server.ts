import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getSetting, setSetting, getGeminiApiKeys } from '$lib/server/settings';
import { hashPassword, verifyPassword } from '$lib/server/auth';
import { sendTelegramMessage } from '$lib/server/telegram';
import { listPrinters } from '$lib/server/printers/repo';

export const load: PageServerLoad = async ({ url }) => {
	return {
		telegramBotToken: (await getSetting('telegram_bot_token')) ?? '',
		telegramChatId: (await getSetting('telegram_chat_id')) ?? '',
		geminiApiKeys: await getGeminiApiKeys(),
		webhookSecret: (await getSetting('webhook_secret')) ?? '',
		appOrigin: url.origin,
		printers: await listPrinters()
	};
};

export const actions: Actions = {
	saveTelegram: async ({ request }) => {
		const form = await request.formData();
		await setSetting('telegram_bot_token', String(form.get('bot_token') ?? '').trim());
		await setSetting('telegram_chat_id', String(form.get('chat_id') ?? '').trim());
		return { message: 'Telegram settings saved.' };
	},
	testTelegram: async () => {
		const token = await getSetting('telegram_bot_token');
		const chatId = await getSetting('telegram_chat_id');
		if (!token || !chatId) return fail(400, { error: 'Set the bot token and chat id first' });
		try {
			await sendTelegramMessage('Autoprint: test message — alerts are working.');
			return { message: 'Sent — check your phone.' };
		} catch (err) {
			return fail(502, { error: err instanceof Error ? err.message : 'Telegram test failed' });
		}
	},
	saveGemini: async ({ request }) => {
		const form = await request.formData();
		const keys = String(form.get('keys') ?? '')
			.split('\n')
			.map((k) => k.trim())
			.filter(Boolean);
		await setSetting('gemini_api_keys', JSON.stringify(keys));
		return { message: 'Gemini API keys saved.' };
	},
	changePassword: async ({ request }) => {
		const form = await request.formData();
		const current = String(form.get('current') ?? '');
		const next = String(form.get('next') ?? '');
		if (next.length < 6) return fail(400, { error: 'New password must be at least 6 characters' });
		const stored = await getSetting('password_hash');
		if (!stored || !(await verifyPassword(current, stored))) {
			return fail(401, { error: 'Current password is incorrect' });
		}
		await setSetting('password_hash', await hashPassword(next));
		return { message: 'Password changed.' };
	}
};
