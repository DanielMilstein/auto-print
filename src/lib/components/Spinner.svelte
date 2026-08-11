<script lang="ts">
	let { class: cls = 'h-3.5 w-3.5' }: { class?: string } = $props();
</script>

<span
	aria-hidden="true"
	class="inline-block shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent {cls}"
></span>
