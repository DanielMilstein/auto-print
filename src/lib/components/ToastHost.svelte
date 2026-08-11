<script lang="ts">
	import { toasts } from '$lib/toast.svelte';
	import Spinner from './Spinner.svelte';

	const bars = { pending: 'bg-accent', ok: 'bg-ok', error: 'bg-danger' };
</script>

{#if toasts.items.length > 0}
	<div
		class="fixed right-4 bottom-4 z-50 flex max-h-[80vh] w-80 flex-col gap-2 overflow-y-auto"
		role="status"
		aria-live="polite"
	>
		{#each toasts.items as toast (toast.id)}
			<div class="border-line bg-surface-2 flex items-stretch border shadow-lg">
				<span class="w-1 shrink-0 {bars[toast.tone]}"></span>
				<div class="flex min-w-0 flex-1 items-start gap-2.5 px-3 py-2.5">
					{#if toast.tone === 'pending'}
						<Spinner class="text-accent mt-0.5 h-3.5 w-3.5" />
					{/if}
					<div class="min-w-0 flex-1">
						<p class="font-display text-xs font-semibold tracking-wider uppercase">{toast.title}</p>
						{#if toast.body}
							<p class="text-muted mt-1 font-mono text-xs break-words">{toast.body}</p>
						{/if}
					</div>
					<button
						type="button"
						aria-label="Dismiss"
						onclick={() => toasts.dismiss(toast.id)}
						class="text-muted hover:text-text -mt-1 -mr-1.5 shrink-0 px-1.5 py-0.5 text-base leading-none"
					>
						×
					</button>
				</div>
			</div>
		{/each}
	</div>
{/if}
