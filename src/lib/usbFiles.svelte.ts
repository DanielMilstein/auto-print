import type { UsbFileEntry, UsbFilesResponse } from './usb';

/**
 * Client-side owner of a printer's USB file list.
 *
 * The listing takes 6-12s against a real printer, so it is deliberately not part of
 * the page load — the page paints from two DB queries and this fills the card in
 * afterwards. Same factory shape as createAction in ./forms.svelte.ts.
 */
export function createUsbFiles(printerId: () => number) {
	let files = $state<UsbFileEntry[]>([]);
	let error = $state<string | null>(null);
	let loading = $state(true); // first fetch: nothing to show yet
	let refreshing = $state(false); // later fetches: keep the current list on screen

	async function fetchList(id: number, isRefresh: boolean): Promise<void> {
		if (isRefresh) refreshing = true;
		try {
			const res = await fetch(`/api/printers/${id}/files`);
			if (!res.ok) throw new Error(`Could not reach the server (${res.status})`);
			const body: UsbFilesResponse = await res.json();
			// A slow listing may land after the user has moved to another printer.
			if (id !== printerId()) return;
			files = body.files;
			error = body.error;
		} catch (err) {
			if (id !== printerId()) return;
			files = [];
			error = err instanceof Error ? err.message : 'Could not list files';
		} finally {
			if (id === printerId()) {
				loading = false;
				refreshing = false;
			}
		}
	}

	// Re-runs when the route's printer changes — SvelteKit reuses this component
	// across /printers/1 -> /printers/2. $effect also keeps it out of SSR.
	$effect(() => {
		const id = printerId();
		files = [];
		error = null;
		loading = true;
		void fetchList(id, false);
	});

	return {
		get files(): UsbFileEntry[] {
			return files;
		},
		get error(): string | null {
			return error;
		},
		get loading(): boolean {
			return loading;
		},
		get refreshing(): boolean {
			return refreshing;
		},
		refresh: () => fetchList(printerId(), true),
		/** Drops a row immediately after a successful delete, ahead of the slow re-listing. */
		remove(name: string): void {
			files = files.filter((f) => f.name !== name);
		},
		/** A preview just landed, so it is on disk now and will render instantly next time. */
		markCached(name: string): void {
			files = files.map((f) => (f.name === name ? { ...f, thumbnailCached: true } : f));
		}
	};
}

export type UsbFiles = ReturnType<typeof createUsbFiles>;
