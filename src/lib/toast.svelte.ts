export type ToastTone = 'pending' | 'ok' | 'error';

export interface Toast {
	id: number;
	title: string;
	tone: ToastTone;
	body?: string;
	/** Stays until dismissed by hand rather than expiring. */
	sticky: boolean;
}

const AUTO_DISMISS_MS = 5_000;

let items = $state<Toast[]>([]);
let nextId = 1;

/**
 * Bottom-right notification stack.
 *
 * Failures never expire — an error the operator hasn't read must not vanish.
 * Routine successes clear themselves after a few seconds so they don't pile up
 * over the page. Callers whose whole point is the returned text (the connection
 * tests) pass `sticky` to keep the result on screen until the × is pressed.
 */
export const toasts = {
	get items(): readonly Toast[] {
		return items;
	},

	/** Opens a toast in the 'pending' tone; settle() finishes it. */
	open(title: string, opts: { sticky?: boolean } = {}): number {
		const id = nextId++;
		items = [...items, { id, title, tone: 'pending', sticky: opts.sticky ?? false }];
		return id;
	},

	settle(id: number, patch: { tone: ToastTone; body?: string }): void {
		items = items.map((t) => (t.id === id ? { ...t, ...patch } : t));
		const settled = items.find((t) => t.id === id);
		if (settled && settled.tone === 'ok' && !settled.sticky) {
			setTimeout(() => toasts.dismiss(id), AUTO_DISMISS_MS);
		}
	},

	dismiss(id: number): void {
		items = items.filter((t) => t.id !== id);
	}
};
