<script lang="ts">
	let {
		progress,
		tone = 'accent'
	}: { progress: number; tone?: 'accent' | 'ok' | 'muted' } = $props();

	const tones = { accent: 'text-accent', ok: 'text-ok', muted: 'text-muted' };
	const clamped = $derived(Math.max(0, Math.min(100, progress)));
</script>

<div class="layer-track h-2 w-full" role="progressbar" aria-valuenow={Math.round(clamped)} aria-valuemin={0} aria-valuemax={100}>
	<div class="layer-fill h-full {tones[tone]}" style="width: {clamped}%"></div>
</div>
