<script lang="ts">
	import PrinterForm from '$lib/components/PrinterForm.svelte';
</script>

<h1 class="font-display mb-8 text-xl font-bold tracking-wide uppercase">Add printer</h1>
<PrinterForm action="?/create" submitLabel="Add printer" toast="Add printer" />
