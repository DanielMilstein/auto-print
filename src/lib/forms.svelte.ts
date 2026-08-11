import type { ActionResult, SubmitFunction } from '@sveltejs/kit';
import { toasts, type ToastTone } from './toast.svelte';

export interface ActionOptions {
	/** Toast title. When set, submitting opens a pending toast that settles with the result. */
	toast?: string;
	/** Clear the form's inputs on success. Off by default so typed values survive a save. */
	reset?: boolean;
	/** Keep the success toast on screen until dismissed by hand. Errors always stick. */
	sticky?: boolean;
	/** Gate run before anything else; returning false aborts the submit silently. */
	confirm?: () => boolean;
	onSuccess?: () => void;
}

/**
 * Pending state + toast reporting for a `use:enhance` form. Owned in one place so
 * every action button in the app disables, spins, and reports identically.
 *
 * Note `update()` re-runs the page load on success, so `pending` stays true until
 * the refreshed data has landed — the button is disabled for the whole round trip.
 */
export function createAction(opts: ActionOptions = {}) {
	let pending = $state(false);

	const submit: SubmitFunction = ({ cancel }) => {
		if (opts.confirm && !opts.confirm()) {
			cancel();
			return;
		}

		pending = true;
		const toastId = opts.toast ? toasts.open(opts.toast, { sticky: opts.sticky }) : null;

		return async ({ result, update }) => {
			try {
				await update({ reset: opts.reset ?? false });
			} finally {
				pending = false;
				if (toastId !== null) toasts.settle(toastId, describe(result));
			}
			if (result.type === 'success') opts.onSuccess?.();
		};
	};

	return {
		get pending(): boolean {
			return pending;
		},
		submit
	};
}

/** Maps an action result onto toast tone + body, following this app's action shapes. */
function describe(result: ActionResult): { tone: ToastTone; body: string } {
	switch (result.type) {
		case 'success': {
			const data = result.data as Record<string, unknown> | undefined;
			return { tone: 'ok', body: typeof data?.message === 'string' ? data.message : 'Done.' };
		}
		case 'failure': {
			const data = result.data as Record<string, unknown> | undefined;
			return { tone: 'error', body: typeof data?.error === 'string' ? data.error : 'Request failed.' };
		}
		case 'redirect':
			return { tone: 'ok', body: 'Done.' };
		case 'error':
			return { tone: 'error', body: result.error?.message ?? 'Request failed.' };
	}
}
