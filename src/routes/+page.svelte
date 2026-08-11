<script lang="ts">
	import PrinterCard from '$lib/components/PrinterCard.svelte';

	let { data } = $props();
</script>

<div class="mb-6 flex items-center justify-between">
	<h1 class="font-display text-xl font-bold tracking-wide uppercase">Dashboard</h1>
	<a
		href="/printers/new"
		class="bg-accent hover:bg-accent-dim font-display px-4 py-1.5 text-sm font-semibold tracking-wide text-black uppercase transition-colors"
	>
		Add printer
	</a>
</div>

{#if data.printers.length === 0}
	<div class="border-line text-muted border border-dashed p-12 text-center text-sm">
		No printers yet. Add one to get started.
	</div>
{:else}
	<div class="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
		{#each data.printers as printer (printer.id)}
			<PrinterCard {printer} />
		{/each}
	</div>
{/if}
