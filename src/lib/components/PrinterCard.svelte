<script lang="ts">
	import StateBadge from './StateBadge.svelte';
	import LayerProgress from './LayerProgress.svelte';
	import type { PrinterStatus } from '$lib/server/printers/adapter';

	interface CardPrinter {
		id: number;
		name: string;
		vision_base_url: string;
	}

	let { printer }: { printer: CardPrinter } = $props();

	let status = $state<PrinterStatus | null>(null);

	async function poll() {
		try {
			const res = await fetch(`/api/printers/${printer.id}/state`);
			if (res.ok) status = (await res.json()).status;
		} catch {
			// transient; next tick retries
		}
	}

	$effect(() => {
		poll();
		const t = setInterval(poll, 5000);
		return () => clearInterval(t);
	});
</script>

<a href="/printers/{printer.id}" class="border-line bg-surface hover:border-accent/50 block border transition-colors">
	{#if printer.vision_base_url}
		<img
			src="/api/printers/{printer.id}/snapshot?ts={Date.now()}"
			alt="Latest camera frame of {printer.name}"
			class="aspect-video w-full bg-black object-contain"
			loading="lazy"
		/>
	{:else}
		<div class="text-muted flex aspect-video items-center justify-center bg-black/40 text-xs">no camera</div>
	{/if}
	<div class="space-y-3 p-4">
		<div class="flex items-center justify-between gap-2">
			<h2 class="font-display truncate font-semibold tracking-wide">{printer.name}</h2>
			{#if status}<StateBadge state={status.state} />{/if}
		</div>
		{#if status?.job}
			<p class="text-muted truncate font-mono text-xs">{status.job.fileName || '—'}</p>
			<LayerProgress progress={status.job.progress} />
			<p class="font-mono text-xs">{status.job.progress.toFixed(1)}%</p>
		{:else}
			<p class="text-muted text-xs">Nothing printing</p>
		{/if}
	</div>
</a>
