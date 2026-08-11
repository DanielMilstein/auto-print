<script lang="ts">
	import { enhance } from '$app/forms';
	import type { Snippet } from 'svelte';
	import { createAction } from '$lib/forms.svelte';

	let {
		action,
		toast,
		reset = false,
		sticky = false,
		enctype,
		class: cls = '',
		confirm,
		onSuccess,
		children
	}: {
		action: string;
		/** Toast title; omit to submit silently. */
		toast?: string;
		reset?: boolean;
		/** Keep the success toast up until dismissed by hand. Errors always stick. */
		sticky?: boolean;
		enctype?: 'application/x-www-form-urlencoded' | 'multipart/form-data' | 'text/plain';
		class?: string;
		/** Return false to abort the submit — for destructive actions. */
		confirm?: () => boolean;
		onSuccess?: () => void;
		children: Snippet<[{ pending: boolean }]>;
	} = $props();

	// Read through getters so the action always sees the current prop values.
	const form = createAction({
		get toast() {
			return toast;
		},
		get reset() {
			return reset;
		},
		get sticky() {
			return sticky;
		},
		confirm: () => confirm?.() ?? true,
		onSuccess: () => onSuccess?.()
	});
</script>

<form method="POST" {action} {enctype} class={cls} use:enhance={form.submit}>
	{@render children({ pending: form.pending })}
</form>
