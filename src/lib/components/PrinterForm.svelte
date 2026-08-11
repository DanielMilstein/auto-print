<script lang="ts">
	import { enhance } from '$app/forms';
	import { createAction } from '$lib/forms.svelte';
	import Spinner from './Spinner.svelte';
	import type { Printer } from '$lib/server/printers/repo';

	let {
		printer,
		action,
		submitLabel,
		toast
	}: {
		printer?: Partial<Printer>;
		action: string;
		submitLabel: string;
		/** Toast title reported on submit. */
		toast: string;
	} = $props();

	const form = createAction({
		get toast() {
			return toast;
		}
	});
</script>

{#snippet field(label: string, name: string, value: string | number | undefined, opts: { type?: string; placeholder?: string; required?: boolean } = {})}
	<label class="block">
		<span class="text-muted mb-1.5 block text-xs tracking-wider uppercase">{label}</span>
		<input
			{name}
			type={opts.type ?? 'text'}
			value={value ?? ''}
			placeholder={opts.placeholder ?? ''}
			required={opts.required ?? false}
			class="border-line bg-bg text-text focus:border-accent w-full border px-3 py-2 font-mono text-sm outline-none"
		/>
	</label>
{/snippet}

{#snippet toggle(label: string, name: string, checked: boolean)}
	<label class="flex items-center gap-2.5">
		<input type="checkbox" {name} {checked} class="accent-accent h-4 w-4" />
		<span class="text-sm">{label}</span>
	</label>
{/snippet}

<form method="POST" {action} class="max-w-2xl space-y-8" use:enhance={form.submit}>
	<section class="space-y-4">
		<h2 class="font-display border-line border-b pb-2 text-sm font-semibold tracking-wider uppercase">Printer</h2>
		{@render field('Name', 'name', printer?.name, { required: true, placeholder: 'XL lab 1' })}
		{@render field('Host or IP', 'host', printer?.host, { required: true, placeholder: '192.168.1.50' })}
		{@render field('PrusaLink API key', 'api_key', printer?.api_key, { placeholder: 'from the printer: Settings → Network → PrusaLink' })}
	</section>

	<section class="space-y-4">
		<h2 class="font-display border-line border-b pb-2 text-sm font-semibold tracking-wider uppercase">Failure detection</h2>
		{@render field('Vision service URL', 'vision_base_url', printer?.vision_base_url, { placeholder: 'http://jetson:8080' })}
		{@render toggle('Stop the print when a failure is detected', 'stop_on_failure', printer?.stop_on_failure ?? true)}
	</section>

	<section class="space-y-4">
		<h2 class="font-display border-line border-b pb-2 text-sm font-semibold tracking-wider uppercase">Robot arm</h2>
		{@render field('Robot gateway URL', 'robot_gateway_url', printer?.robot_gateway_url, { placeholder: 'http://robot:8090' })}
		<label class="block">
			<span class="text-muted mb-1.5 block text-xs tracking-wider uppercase">Removal task (executor prompt)</span>
			<textarea
				name="robot_task"
				rows="3"
				placeholder="pick the printed part off the print bed and drop it in the bin"
				class="border-line bg-bg text-text focus:border-accent w-full border px-3 py-2 font-mono text-sm outline-none"
			>{printer?.robot_task ?? ''}</textarea>
		</label>
		<label class="block">
			<span class="text-muted mb-1.5 block text-xs tracking-wider uppercase">Executor parameter overrides (JSON)</span>
			<textarea
				name="robot_params_json"
				rows="3"
				placeholder={'{"approach_height": "0.12"}'}
				class="border-line bg-bg text-text focus:border-accent w-full border px-3 py-2 font-mono text-sm outline-none"
			>{JSON.stringify(printer?.robot_params_json ?? {}, null, 0) === '{}' ? '' : JSON.stringify(printer?.robot_params_json, null, 2)}</textarea>
		</label>
	</section>

	<section class="space-y-4">
		<h2 class="font-display border-line border-b pb-2 text-sm font-semibold tracking-wider uppercase">Timelapse</h2>
		{@render toggle('Record a timelapse of each print', 'timelapse_enabled', printer?.timelapse_enabled ?? false)}
		<div class="grid grid-cols-2 gap-4">
			{@render field('Snapshot every (seconds)', 'timelapse_interval_sec', printer?.timelapse_interval_sec ?? 10, { type: 'number' })}
			{@render field('Video speed (fps)', 'timelapse_fps', printer?.timelapse_fps ?? 30, { type: 'number' })}
		</div>
	</section>

	<button
		type="submit"
		disabled={form.pending}
		aria-busy={form.pending}
		class="bg-accent hover:bg-accent-dim font-display flex items-center gap-2 px-5 py-2 text-sm font-semibold tracking-wide text-black uppercase transition-colors disabled:opacity-50"
	>
		{#if form.pending}<Spinner />{/if}
		{submitLabel}
	</button>
</form>
