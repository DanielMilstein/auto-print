<script lang="ts">
	let { state }: { state: string } = $props();

	const styles: Record<string, string> = {
		PRINTING: 'text-accent border-accent/40',
		PAUSED: 'text-warn border-warn/40',
		ATTENTION: 'text-warn border-warn/40',
		FINISHED: 'text-ok border-ok/40',
		ERROR: 'text-danger border-danger/40',
		OFFLINE: 'text-danger border-danger/40',
		STOPPED: 'text-muted border-line',
		IDLE: 'text-muted border-line',
		READY: 'text-muted border-line',
		BUSY: 'text-muted border-line'
	};
</script>

<span
	class="inline-flex items-center gap-1.5 border px-2 py-0.5 font-mono text-[11px] tracking-wider uppercase
		{styles[state] ?? 'text-muted border-line'}"
>
	{#if state === 'PRINTING'}
		<span class="bg-accent block h-1.5 w-1.5 animate-pulse rounded-full"></span>
	{/if}
	{state}
</span>
