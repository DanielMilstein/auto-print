<script lang="ts">
	import ActionForm from '$lib/components/ActionForm.svelte';
	import Spinner from '$lib/components/Spinner.svelte';

	let { data } = $props();
</script>

<h1 class="font-display mb-8 text-xl font-bold tracking-wide uppercase">Settings</h1>

<div class="max-w-2xl space-y-10">
	<!-- Telegram -->
	<section class="space-y-4">
		<h2 class="font-display border-line border-b pb-2 text-sm font-semibold tracking-wider uppercase">Telegram alerts</h2>
		<ActionForm action="?/saveTelegram" toast="Save Telegram settings" class="space-y-4">
			{#snippet children({ pending })}
				<label class="block">
					<span class="text-muted mb-1.5 block text-xs tracking-wider uppercase">Bot token</span>
					<input
						name="bot_token"
						value={data.telegramBotToken}
						placeholder="123456:ABC-DEF…"
						class="border-line bg-bg text-text focus:border-accent w-full border px-3 py-2 font-mono text-sm outline-none"
					/>
				</label>
				<label class="block">
					<span class="text-muted mb-1.5 block text-xs tracking-wider uppercase">Chat ID</span>
					<input
						name="chat_id"
						value={data.telegramChatId}
						placeholder="-100123456789"
						class="border-line bg-bg text-text focus:border-accent w-full border px-3 py-2 font-mono text-sm outline-none"
					/>
				</label>
				<button
					disabled={pending}
					aria-busy={pending}
					class="bg-accent hover:bg-accent-dim font-display flex items-center gap-2 px-5 py-2 text-sm font-semibold tracking-wide text-black uppercase transition-colors disabled:opacity-50"
				>
					{#if pending}<Spinner />{/if}
					Save
				</button>
			{/snippet}
		</ActionForm>
		<ActionForm action="?/testTelegram" toast="Send test message">
			{#snippet children({ pending })}
				<button
					disabled={pending}
					aria-busy={pending}
					class="border-line hover:border-accent hover:text-accent flex items-center gap-2 border px-4 py-1.5 text-sm transition-colors disabled:opacity-50"
				>
					{#if pending}<Spinner />{/if}
					Send test message
				</button>
			{/snippet}
		</ActionForm>
	</section>

	<!-- Gemini -->
	<section class="space-y-4">
		<h2 class="font-display border-line border-b pb-2 text-sm font-semibold tracking-wider uppercase">Gemini API keys</h2>
		<p class="text-muted text-sm">
			Used by the robot arm's Gemini bridge for each removal job. One key per line; extra keys are rotated in
			when a key hits its quota.
		</p>
		<ActionForm action="?/saveGemini" toast="Save Gemini API keys" class="space-y-4">
			{#snippet children({ pending })}
				<textarea
					name="keys"
					rows="3"
					placeholder="AIza…"
					class="border-line bg-bg text-text focus:border-accent w-full border px-3 py-2 font-mono text-sm outline-none"
				>{data.geminiApiKeys.join('\n')}</textarea>
				<button
					disabled={pending}
					aria-busy={pending}
					class="bg-accent hover:bg-accent-dim font-display flex items-center gap-2 px-5 py-2 text-sm font-semibold tracking-wide text-black uppercase transition-colors disabled:opacity-50"
				>
					{#if pending}<Spinner />{/if}
					Save
				</button>
			{/snippet}
		</ActionForm>
	</section>

	<!-- Vision webhook -->
	<section class="space-y-4">
		<h2 class="font-display border-line border-b pb-2 text-sm font-semibold tracking-wider uppercase">Vision webhook</h2>
		<p class="text-muted text-sm">
			Configure each printer's vision service with these environment variables so failure alerts reach
			Autoprint:
		</p>
		{#each data.printers as p (p.id)}
			<div class="border-line bg-surface border p-3">
				<p class="font-display mb-2 text-xs font-semibold tracking-wider uppercase">{p.name}</p>
				<pre class="text-muted overflow-x-auto font-mono text-xs leading-relaxed">HTTP_POST_URL={data.appOrigin}/api/webhooks/vision/{p.id}
HTTP_POST_HEADERS_JSON={'{'}"X-Webhook-Token":"{data.webhookSecret}"{'}'}</pre>
			</div>
		{:else}
			<p class="text-muted text-sm">Add a printer first.</p>
		{/each}
	</section>

	<!-- Password -->
	<section class="space-y-4">
		<h2 class="font-display border-line border-b pb-2 text-sm font-semibold tracking-wider uppercase">Password</h2>
		<ActionForm action="?/changePassword" toast="Change password" reset class="space-y-4">
			{#snippet children({ pending })}
				<label class="block">
					<span class="text-muted mb-1.5 block text-xs tracking-wider uppercase">Current password</span>
					<input
						name="current"
						type="password"
						required
						class="border-line bg-bg text-text focus:border-accent w-full border px-3 py-2 font-mono text-sm outline-none"
					/>
				</label>
				<label class="block">
					<span class="text-muted mb-1.5 block text-xs tracking-wider uppercase">New password</span>
					<input
						name="next"
						type="password"
						required
						minlength="6"
						class="border-line bg-bg text-text focus:border-accent w-full border px-3 py-2 font-mono text-sm outline-none"
					/>
				</label>
				<button
					disabled={pending}
					aria-busy={pending}
					class="bg-accent hover:bg-accent-dim font-display flex items-center gap-2 px-5 py-2 text-sm font-semibold tracking-wide text-black uppercase transition-colors disabled:opacity-50"
				>
					{#if pending}<Spinner />{/if}
					Change password
				</button>
			{/snippet}
		</ActionForm>
	</section>
</div>
