<script lang="ts">
	let { form } = $props();
</script>

<div class="flex min-h-screen items-center justify-center">
	<form method="POST" action="?/login" class="border-line bg-surface w-80 border p-8">
		<div class="mb-8 flex items-center gap-2.5">
			<span class="bg-accent block h-2.5 w-2.5"></span>
			<h1 class="font-display text-text text-xl font-bold tracking-wide uppercase">Autoprint</h1>
		</div>
		<label class="text-muted mb-1.5 block text-xs tracking-wider uppercase" for="password">Password</label>
		<input
			id="password"
			name="password"
			type="password"
			required
			autofocus
			class="border-line bg-bg text-text focus:border-accent mb-4 w-full border px-3 py-2 font-mono text-sm outline-none"
		/>
		{#if form?.incorrect}
			<p class="text-danger mb-4 text-sm">Incorrect password.</p>
		{/if}
		<button
			type="submit"
			class="bg-accent hover:bg-accent-dim font-display w-full px-3 py-2 text-sm font-semibold tracking-wide text-black uppercase transition-colors"
		>
			Log in
		</button>
	</form>
</div>
