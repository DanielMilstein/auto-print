<script lang="ts">
	import ActionForm from './ActionForm.svelte';
	import Spinner from './Spinner.svelte';
	import type { UsbFiles } from '$lib/usbFiles.svelte';
	import type { FileMeta, FileMetaResponse, UsbFileEntry } from '$lib/usb';

	let {
		printerId,
		file,
		usb
	}: { printerId: number; file: UsbFileEntry; usb: UsbFiles } = $props();

	let meta = $state<FileMeta | null>(null);
	let metaLoading = $state(true);
	let imageFailed = $state(false);
	let imageLoaded = $state(false);

	$effect(() => {
		const params = new URLSearchParams({ file: file.name, displayName: file.displayName });
		if (file.downloadUrl) params.set('ref', file.downloadUrl);
		let cancelled = false;
		metaLoading = true;
		fetch(`/api/printers/${printerId}/file-meta?${params}`)
			.then((res) => (res.ok ? (res.json() as Promise<FileMetaResponse>) : null))
			.then((body) => {
				if (cancelled) return;
				meta = body?.meta ?? null;
			})
			.catch(() => {})
			.finally(() => {
				if (!cancelled) metaLoading = false;
			});
		return () => {
			cancelled = true;
		};
	});

	const thumbnailSrc = $derived.by(() => {
		const params = new URLSearchParams({ file: file.name });
		if (file.thumbnailUrl) params.set('ref', file.thumbnailUrl);
		return `/api/printers/${printerId}/thumbnail?${params}`;
	});

	/** Print-level facts, rendered as label/value pairs in source order. */
	const facts = $derived.by(() => {
		const m = meta;
		if (!m) return [] as [string, string][];
		const rows: [string, string | undefined][] = [
			['Est. time', m.estimatedTime],
			['Layer', m.layerHeightMm != null ? `${m.layerHeightMm} mm` : undefined],
			['Infill', m.infill],
			['Bed', m.bedTempC ? `${m.bedTempC} °C` : undefined],
			['Height', m.maxHeightMm != null ? `${m.maxHeightMm} mm` : undefined],
			['Printer', m.printerModel],
			['Size', m.sizeBytes != null ? fmtSize(m.sizeBytes) : undefined],
			['Modified', m.modifiedAt != null ? fmtDate(m.modifiedAt) : undefined],
			['Sliced with', m.producer]
		];
		return rows.filter((r): r is [string, string] => Boolean(r[1]));
	});

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

<div class="bg-bg/40 border-line space-y-4 border-t p-4">
	<div class="flex flex-wrap gap-4">
		<!-- Preview -->
		<div class="w-48 shrink-0 space-y-2">
			<div
				class="border-line relative flex aspect-4/3 w-full items-center justify-center overflow-hidden border bg-black/40"
			>
				{#if imageFailed}
					<span class="text-muted text-xs tracking-wider uppercase">No preview</span>
				{:else}
					<img
						src={thumbnailSrc}
						alt="Preview of {file.displayName}"
						class="h-full w-full object-contain {imageLoaded ? '' : 'invisible'}"
						onload={() => {
							imageLoaded = true;
							usb.markCached(file.name);
						}}
						onerror={() => (imageFailed = true)}
					/>
					{#if !imageLoaded}
						<span class="absolute inset-0 flex items-center justify-center">
							<Spinner class="text-accent h-5 w-5" />
						</span>
					{/if}
				{/if}
			</div>
			{#if !imageLoaded && !imageFailed && !file.thumbnailCached}
				<p class="text-muted text-[11px] leading-snug">
					Pulling the preview off the printer — this can take a moment the first time.
				</p>
			{/if}
		</div>

		<!-- Facts -->
		<div class="min-w-48 flex-1 space-y-3">
			{#if metaLoading}
				<div class="text-muted flex items-center gap-2 text-xs">
					<Spinner class="h-3.5 w-3.5" />
					Reading file details…
				</div>
			{:else if !meta}
				<p class="text-muted text-xs">No slicer details available for this file.</p>
			{:else}
				{#if facts.length > 0}
					<div class="grid grid-cols-2 gap-x-4 gap-y-2 font-mono text-xs">
						{#each facts as [label, value] (label)}
							<div>
								<span class="text-muted block text-[10px] tracking-wider uppercase">{label}</span>
								{value}
							</div>
						{/each}
					</div>
				{/if}

				{#if meta.tools.length > 0}
					<div>
						<span class="text-muted mb-1.5 block text-[10px] tracking-wider uppercase">
							{meta.tools.length > 1 ? `Tools (${meta.tools.length})` : 'Tool'}
						</span>
						<table class="w-full font-mono text-xs">
							<tbody>
								{#each meta.tools as tool (tool.index)}
									<tr class="border-line border-b last:border-0">
										<td class="py-1 pr-2 align-middle">
											<span class="flex items-center gap-1.5">
												{#if tool.colour}
													<span
														class="border-line inline-block h-2.5 w-2.5 shrink-0 border"
														style="background: {tool.colour}"
													></span>
												{/if}
												<span class="text-muted">T{tool.index}</span>
											</span>
										</td>
										<td class="py-1 pr-2">{tool.material ?? '—'}</td>
										<td class="text-muted py-1 pr-2">
											{tool.nozzleMm != null ? `${tool.nozzleMm} mm` : '—'}
										</td>
										<td class="text-muted py-1 pr-2">
											{tool.nozzleTempC != null ? `${tool.nozzleTempC} °C` : '—'}
										</td>
										{#if meta.tools.some((t) => t.filamentGrams != null)}
											<td class="text-muted py-1 text-right">
												{tool.filamentGrams != null ? `${tool.filamentGrams.toFixed(2)} g` : '—'}
											</td>
										{/if}
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			{/if}
		</div>
	</div>

	<!-- Actions -->
	<div class="border-line flex gap-2 border-t pt-3">
		<ActionForm action="?/startPrint" toast="Start print" onSuccess={() => usb.refresh()}>
			{#snippet children({ pending })}
				<input type="hidden" name="file" value={file.name} />
				<button
					disabled={pending}
					aria-busy={pending}
					class="bg-accent hover:bg-accent-dim font-display flex items-center gap-2 px-4 py-1.5 text-xs font-semibold tracking-wide text-black uppercase transition-colors disabled:opacity-50"
				>
					{#if pending}<Spinner class="h-3 w-3" />{/if}
					Print
				</button>
			{/snippet}
		</ActionForm>
		<ActionForm
			action="?/deleteFile"
			toast="Delete file"
			onSuccess={() => {
				usb.remove(file.name);
				usb.refresh();
			}}
		>
			{#snippet children({ pending })}
				<input type="hidden" name="file" value={file.name} />
				<button
					disabled={pending}
					aria-busy={pending}
					class="border-danger/40 text-danger hover:bg-danger/10 flex items-center gap-2 border px-4 py-1.5 text-xs tracking-wide uppercase transition-colors disabled:opacity-50"
				>
					{#if pending}<Spinner class="h-3 w-3" />{/if}
					Delete
				</button>
			{/snippet}
		</ActionForm>
	</div>
</div>
