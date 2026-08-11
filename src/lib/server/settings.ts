import { sql } from './db';

export type SettingKey =
	| 'password_hash'
	| 'telegram_bot_token'
	| 'telegram_chat_id'
	| 'gemini_api_keys'
	| 'webhook_secret';

export async function getSetting(key: SettingKey): Promise<string | null> {
	const rows = await sql`SELECT value FROM settings WHERE key = ${key}`;
	return rows.length ? (rows[0].value as string) : null;
}

export async function setSetting(key: SettingKey, value: string): Promise<void> {
	await sql`INSERT INTO settings (key, value) VALUES (${key}, ${value})
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
}

export async function getGeminiApiKeys(): Promise<string[]> {
	const raw = await getSetting('gemini_api_keys');
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter((k) => typeof k === 'string' && k.trim()) : [];
	} catch {
		return [];
	}
}
