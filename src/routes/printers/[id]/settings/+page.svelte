<script lang="ts">
	import PrinterForm from '$lib/components/PrinterForm.svelte';
	import ActionForm from '$lib/components/ActionForm.svelte';
	import Spinner from '$lib/components/Spinner.svelte';

	let { data } = $props();

	const tests = [
		{ action: '?/testPrinter', label: 'Test printer' },
		{ action: '?/testVision', label: 'Test camera' },
		{ action: '?/testRobot', label: 'Test robot' }
	];
</script>

<div class="mb-8 flex items-center justify-between">
	<h1 class="font-display text-xl font-bold tracking-wide uppercase">{data.printer.name} — Settings</h1>
	<a href="/printers/{data.printer.id}" class="text-muted hover:text-text text-sm">Back to printer</a>
</div>

<PrinterForm printer={data.printer} action="?/save" submitLabel="Save changes" toast="Save settings" />

<section class="border-line mt-10 max-w-2xl space-y-4 border-t pt-6">
	<h2 class="font-display text-sm font-semibold tracking-wider uppercase">Connection tests</h2>
	<div class="flex gap-3">
		{#each tests as test (test.action)}
			<ActionForm action={test.action} toast={test.label} sticky>
				{#snippet children({ pending })}
					<button
						disabled={pending}
						aria-busy={pending}
						class="border-line hover:border-accent hover:text-accent flex items-center gap-2 border px-4 py-1.5 text-sm transition-colors disabled:opacity-50"
					>
						{#if pending}<Spinner />{/if}
						{test.label}
					</button>
				{/snippet}
			</ActionForm>
		{/each}
	</div>
	<p class="text-muted text-xs">
		Results appear as a notification in the bottom-right corner and stay until you close them.
	</p>
</section>

<section class="border-line mt-10 max-w-2xl border-t pt-6">
	<h2 class="font-display text-danger mb-3 text-sm font-semibold tracking-wider uppercase">Remove printer</h2>
	<ActionForm
		action="?/delete"
		toast="Remove printer"
		confirm={() => window.confirm(`Remove ${data.printer.name}? Its print history is deleted too.`)}
	>
		{#snippet children({ pending })}
			<button
				disabled={pending}
				aria-busy={pending}
				class="border-danger/40 text-danger hover:bg-danger/10 flex items-center gap-2 border px-4 py-1.5 text-sm transition-colors disabled:opacity-50"
			>
				{#if pending}<Spinner />{/if}
				Remove printer
			</button>
		{/snippet}
	</ActionForm>
</section>
