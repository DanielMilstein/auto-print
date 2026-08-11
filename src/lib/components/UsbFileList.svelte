<script lang="ts">
	import { browser } from '$app/environment';
	import ActionForm from './ActionForm.svelte';
	import Spinner from './Spinner.svelte';
	import UsbFileDetail from './UsbFileDetail.svelte';
	import type { UsbFiles } from '$lib/usbFiles.svelte';
	import type { UsbFileEntry } from '$lib/usb';

	let { printerId, usb }: { printerId: number; usb: UsbFiles } = $props();

	const PAGE_SIZE = 8;

	type SortMode = 'newest' | 'oldest' | 'name' | 'name-desc' | 'largest' | 'smallest';

	const SORTS: { value: SortMode; label: string; needsSize?: boolean }[] = [
		{ value: 'newest', label: 'Newest first' },
		{ value: 'oldest', label: 'Oldest first' },
		{ value: 'name', label: 'Name A–Z' },
		{ value: 'name-desc', label: 'Name Z–A' },
		{ value: 'largest', label: 'Largest first', needsSize: true },
		{ value: 'smallest', label: 'Smallest first', needsSize: true }
	];

	/** Numeric collation so gear-2t sorts before gear-10t. */
	const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

	const SORT_KEY = 'autoprint:usb-sort';

	/**
	 * Newest first by default: a real drive holds hundreds of files spanning
	 * months, and the one you want is nearly always recent. The card only renders
	 * client-side (the list is fetched after load), so reading storage here can't
	 * cause a hydration mismatch.
	 */
	function storedSort(): SortMode {
		if (!browser) return 'newest';
		try {
			const saved = localStorage.getItem(SORT_KEY);
			if (SORTS.some((s) => s.value === saved)) return saved as SortMode;
		} catch {
			// Storage can be unavailable (private browsing); the default is fine.
		}
		return 'newest';
	}

	let filter = $state('');
	let page = $state(1);
	let sort = $state<SortMode>(storedSort());
	/** Rows toggle independently, so several files can be compared side by side. */
	let expanded = $state<Record<string, boolean>>({});

	// PrusaLink omits size for every entry on a real drive, so only offer those
	// sorts when the listing actually carries sizes.
	const hasSizes = $derived(usb.files.some((f) => f.sizeBytes != null));
	const sortOptions = $derived(SORTS.filter((s) => !s.needsSize || hasSizes));
	/**
	 * A remembered size sort is meaningless on a printer that reports no sizes, so
	 * fall back for this printer while keeping the stored preference intact.
	 */
	const activeSort = $derived(
		sortOptions.some((o) => o.value === sort) ? sort : ('newest' as SortMode)
	);

	function setSort(next: SortMode): void {
		sort = next;
		page = 1;
		try {
			localStorage.setItem(SORT_KEY, next);
		} catch {
			// Not persisting is survivable; the sort still applies for this session.
		}
	}

	const filtered = $derived(
		usb.files
			.filter((f) => f.displayName.toLowerCase().includes(filter.trim().toLowerCase()))
			.toSorted(compare)
	);

	function compare(a: UsbFileEntry, b: UsbFileEntry): number {
		switch (activeSort) {
			case 'newest':
				return byNumber(a.modifiedAt, b.modifiedAt, -1);
			case 'oldest':
				return byNumber(a.modifiedAt, b.modifiedAt, 1);
			case 'largest':
				return byNumber(a.sizeBytes, b.sizeBytes, -1);
			case 'smallest':
				return byNumber(a.sizeBytes, b.sizeBytes, 1);
			case 'name-desc':
				return collator.compare(b.displayName, a.displayName);
			default:
				return collator.compare(a.displayName, b.displayName);
		}
	}

	/**
	 * `direction` 1 ascending, -1 descending. Entries missing the field sink to the
	 * bottom either way, rather than riding to the top of a descending sort.
	 */
	function byNumber(a: number | undefined, b: number | undefined, direction: 1 | -1): number {
		if (a == null && b == null) return 0;
		if (a == null) return 1;
		if (b == null) return -1;
		return (a - b) * direction;
	}
	const pageCount = $derived(Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)));
	/** Clamped, so deleting the last file on the last page doesn't strand us on an empty view. */
	const safePage = $derived(Math.min(page, pageCount));
	const visible = $derived(filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE));
	const firstShown = $derived((safePage - 1) * PAGE_SIZE + 1);

	function toggle(file: UsbFileEntry): void {
		expanded = { ...expanded, [file.name]: !expanded[file.name] };
	}

	function fmtSize(bytes: number): string {
		const units = ['B', 'KB', 'MB', 'GB'];
		let n = bytes;
		let u = 0;
		while (n >= 1024 && u < units.length - 1) {
			n /= 1024;
			u++;
		}
		return `${u === 0 ? n : n.toFixed(1)} ${units[u]}`;
	}

	function fmtDate(unixSeconds: number): string {
		return new Date(unixSeconds * 1000).toLocaleDateString('en-GB', {
			day: '2-digit',
			month: 'short',
			year: 'numeric'
		});
	}
</script>

<section class="border-line bg-surface border">
	<div class="border-line flex items-center justify-between gap-3 border-b px-4 py-2.5">
		<h2 class="font-display text-xs font-semibold tracking-wider uppercase">Files on USB</h2>
		<button
			type="button"
			onclick={() => usb.refresh()}
			disabled={usb.loading || usb.refreshing}
			aria-busy={usb.refreshing}
			class="text-muted hover:text-accent flex items-center gap-1.5 text-xs tracking-wide uppercase transition-colors disabled:opacity-50"
		>
			{#if usb.refreshing}<Spinner class="h-3 w-3" />{/if}
			Refresh
		</button>
	</div>

	<div class="space-y-4 p-4">
		{#if usb.loading}
			<div class="text-muted flex items-center justify-center gap-2.5 py-8 text-sm">
				<Spinner class="text-accent h-4 w-4" />
				Reading the USB drive…
			</div>
		{:else if usb.error}
			<div class="space-y-3">
				<p class="text-danger text-sm">{usb.error}</p>
				<button
					type="button"
					onclick={() => usb.refresh()}
					disabled={usb.refreshing}
					class="border-line hover:border-accent hover:text-accent flex items-center gap-2 border px-4 py-1.5 text-sm transition-colors disabled:opacity-50"
				>
					{#if usb.refreshing}<Spinner />{/if}
					Retry
				</button>
			</div>
		{:else}
			<div class="flex gap-2">
				<input
					type="search"
					bind:value={filter}
					oninput={() => (page = 1)}
					placeholder="Filter by name"
					aria-label="Filter files by name"
					class="border-line bg-bg text-text focus:border-accent min-w-0 flex-1 border px-3 py-1.5 font-mono text-sm outline-none"
				/>
				<select
					value={activeSort}
					onchange={(e) => setSort(e.currentTarget.value as SortMode)}
					aria-label="Sort files"
					class="border-line bg-bg text-text focus:border-accent shrink-0 border px-2 py-1.5 font-mono text-sm outline-none"
				>
					{#each sortOptions as option (option.value)}
						<option value={option.value}>{option.label}</option>
					{/each}
				</select>
			</div>

			{#if usb.files.length === 0}
				<p class="text-muted text-sm">No printable files on the USB drive.</p>
			{:else if visible.length === 0}
				<p class="text-muted text-sm">No files match “{filter.trim()}”.</p>
			{:else}
				<ul class="border-line divide-y divide-(--color-line) border">
					{#each visible as file (file.name)}
						{@const isOpen = expanded[file.name] ?? false}
						<li>
							<button
								type="button"
								onclick={() => toggle(file)}
								aria-expanded={isOpen}
								aria-controls="usb-file-{file.name}"
								class="hover:bg-surface-2 flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors
									{isOpen ? 'bg-surface-2' : ''}"
							>
								<span
									aria-hidden="true"
									class="text-muted shrink-0 text-[10px] transition-transform {isOpen ? 'rotate-90' : ''}"
								>
									▶
								</span>
								<span class="min-w-0 flex-1 truncate font-mono text-sm">{file.displayName}</span>
								<!-- Whatever the list is sorted by should be visible without expanding. -->
								{#if file.sizeBytes != null || file.modifiedAt != null}
									<span class="text-muted shrink-0 font-mono text-xs">
										{[
											file.sizeBytes != null ? fmtSize(file.sizeBytes) : null,
											file.modifiedAt != null ? fmtDate(file.modifiedAt) : null
										]
											.filter(Boolean)
											.join(' · ')}
									</span>
								{/if}
							</button>

							{#if isOpen}
								<div id="usb-file-{file.name}">
									<UsbFileDetail {printerId} {file} {usb} />
								</div>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}

			{#if filtered.length > PAGE_SIZE}
				<div class="flex items-center justify-between gap-3">
					<p class="text-muted font-mono text-xs">
						Showing {firstShown}–{firstShown + visible.length - 1} of {filtered.length}
					</p>
					<div class="flex gap-2">
						<button
							type="button"
							onclick={() => (page = safePage - 1)}
							disabled={safePage <= 1}
							class="border-line hover:border-accent hover:text-accent border px-3 py-1 text-xs tracking-wide uppercase transition-colors disabled:pointer-events-none disabled:opacity-40"
						>
							Prev
						</button>
						<button
							type="button"
							onclick={() => (page = safePage + 1)}
							disabled={safePage >= pageCount}
							class="border-line hover:border-accent hover:text-accent border px-3 py-1 text-xs tracking-wide uppercase transition-colors disabled:pointer-events-none disabled:opacity-40"
						>
							Next
						</button>
					</div>
				</div>
			{/if}
		{/if}

		<ActionForm
			action="?/uploadFile"
			toast="Upload to USB"
			enctype="multipart/form-data"
			reset
			onSuccess={() => usb.refresh()}
			class="flex items-center gap-3"
		>
			{#snippet children({ pending })}
				<input
					type="file"
					name="file"
					accept=".bgcode,.gcode"
					required
					disabled={pending}
					class="text-muted file:border-line file:bg-surface-2 file:text-text w-full text-sm file:mr-3 file:border file:px-3 file:py-1.5 file:text-xs file:uppercase disabled:opacity-50"
				/>
				<button
					disabled={pending}
					aria-busy={pending}
					class="border-line hover:border-accent hover:text-accent flex shrink-0 items-center gap-2 border px-4 py-1.5 text-sm transition-colors disabled:opacity-50"
				>
					{#if pending}<Spinner />{/if}
					Upload
				</button>
			{/snippet}
		</ActionForm>
	</div>
</section>
