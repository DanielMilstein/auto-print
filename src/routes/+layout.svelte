<script lang="ts">
	import './layout.css';
	import '@fontsource/chakra-petch/600.css';
	import '@fontsource/chakra-petch/700.css';
	import '@fontsource-variable/ibm-plex-sans/index.css';
	import '@fontsource/ibm-plex-mono/400.css';
	import '@fontsource/ibm-plex-mono/500.css';
	import favicon from '$lib/assets/favicon.svg';
	import ToastHost from '$lib/components/ToastHost.svelte';
	import { page } from '$app/state';

	let { children } = $props();

	const nav = [
		{ href: '/', label: 'Dashboard' },
		{ href: '/history', label: 'History' },
		{ href: '/settings', label: 'Settings' }
	];

	const isLogin = $derived(page.url.pathname === '/login');

	function isActive(href: string): boolean {
		if (href === '/') return page.url.pathname === '/' || page.url.pathname.startsWith('/printers');
		return page.url.pathname.startsWith(href);
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Autoprint</title>
</svelte:head>

{#if isLogin}
	{@render children()}
{:else}
	<div class="flex min-h-screen">
		<aside class="border-line bg-surface flex w-52 shrink-0 flex-col border-r">
			<a href="/" class="border-line flex items-center gap-2.5 border-b px-5 py-5">
				<span class="bg-accent block h-2.5 w-2.5"></span>
				<span class="font-display text-text text-lg font-bold tracking-wide uppercase">Autoprint</span>
			</a>
			<nav class="flex flex-1 flex-col gap-1 p-3">
				{#each nav as item (item.href)}
					<a
						href={item.href}
						class="rounded px-3 py-2 text-sm transition-colors
							{isActive(item.href) ? 'bg-surface-2 text-text' : 'text-muted hover:text-text'}"
					>
						{item.label}
					</a>
				{/each}
			</nav>
			<form method="POST" action="/login?/logout" class="border-line border-t p-3">
				<button type="submit" class="text-muted hover:text-text w-full rounded px-3 py-2 text-left text-sm">
					Log out
				</button>
			</form>
		</aside>
		<main class="min-w-0 flex-1 p-6 lg:p-8">
			{@render children()}
		</main>
	</div>
{/if}

<ToastHost />
