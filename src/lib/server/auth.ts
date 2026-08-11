import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { sql } from './db';
import { getSetting, setSetting } from './settings';
import { env } from '$env/dynamic/private';

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_COOKIE = 'autoprint_session';

export async function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(16);
	const hash = await scrypt(password, salt, 64);
	return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
	const [saltHex, hashHex] = stored.split(':');
	if (!saltHex || !hashHex) return false;
	const hash = await scrypt(password, Buffer.from(saltHex, 'hex'), 64);
	const expected = Buffer.from(hashHex, 'hex');
	return hash.length === expected.length && timingSafeEqual(hash, expected);
}

/** Seeds the shared password from INITIAL_PASSWORD on first boot. */
export async function ensurePasswordSeeded(): Promise<void> {
	if (await getSetting('password_hash')) return;
	const initial = env.INITIAL_PASSWORD ?? 'autoprint';
	await setSetting('password_hash', await hashPassword(initial));
	console.log('[auth] seeded initial password (change it in Settings)');
}

export async function login(password: string): Promise<string | null> {
	const stored = await getSetting('password_hash');
	if (!stored || !(await verifyPassword(password, stored))) return null;
	const token = randomBytes(32).toString('hex');
	const expires = new Date(Date.now() + SESSION_TTL_MS);
	await sql`INSERT INTO sessions (token, expires_at) VALUES (${token}, ${expires})`;
	return token;
}

export async function logout(token: string): Promise<void> {
	await sql`DELETE FROM sessions WHERE token = ${token}`;
}

export async function isValidSession(token: string | undefined): Promise<boolean> {
	if (!token) return false;
	const rows = await sql`SELECT 1 FROM sessions WHERE token = ${token} AND expires_at > now()`;
	return rows.length > 0;
}
