import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import { login, logout, SESSION_COOKIE } from '$lib/server/auth';

export const actions: Actions = {
	login: async ({ request, cookies, url }) => {
		const form = await request.formData();
		const password = String(form.get('password') ?? '');
		const token = await login(password);
		if (!token) return fail(401, { incorrect: true });
		cookies.set(SESSION_COOKIE, token, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			// Kit defaults to `secure: true` off localhost; browsers drop Secure cookies over plain
			// http (e.g. hitting :3000 directly), so follow the (possibly forwarded) protocol instead.
			secure: url.protocol === 'https:',
			maxAge: 60 * 60 * 24 * 30
		});
		redirect(303, '/');
	},
	logout: async ({ cookies }) => {
		const token = cookies.get(SESSION_COOKIE);
		if (token) await logout(token);
		cookies.delete(SESSION_COOKIE, { path: '/' });
		redirect(303, '/login');
	}
};
