<script lang="ts">
	import StateBadge from '$lib/components/StateBadge.svelte';
	import ActionForm from '$lib/components/ActionForm.svelte';
	import Spinner from '$lib/components/Spinner.svelte';

	let { data } = $props();

	let tab = $state<'jobs' | 'batches' | 'events'>('jobs');
	let expandedJob = $state<number | null>(null);

	const jobBadge: Record<string, string> = {
		printing: 'PRINTING',
		paused: 'PAUSED',
		finished: 'FINISHED',
		stopped: 'STOPPED',
		failed: 'ERROR',
		error: 'ERROR'
	};

	function fmt(ts: unknown): string {
		if (!ts) return '—';
		return new Date(ts as string).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' });
	}
</script>

<h1 class="font-display mb-6 text-xl font-bold tracking-wide uppercase">History</h1>

<div class="border-line mb-6 flex gap-1 border-b">
	{#each [['jobs', 'Prints'], ['batches', 'Batches'], ['events', 'Events']] as [key, label] (key)}
		<button
			class="-mb-px border-b-2 px-4 py-2 text-sm transition-colors
				{tab === key ? 'border-accent text-text' : 'text-muted hover:text-text border-transparent'}"
			onclick={() => (tab = key as typeof tab)}
		>
			{label}
		</button>
	{/each}
</div>

{#if tab === 'jobs'}
	<form method="GET" class="mb-4 flex gap-3">
		<select name="printer" class="border-line bg-surface text-text border px-2 py-1.5 text-sm">
			<option value="">All printers</option>
			{#each data.printers as p (p.id)}
				<option value={p.id} selected={data.filters.printerId === p.id}>{p.name}</option>
			{/each}
		</select>
		<select name="status" class="border-line bg-surface text-text border px-2 py-1.5 text-sm">
			<option value="">Any status</option>
			{#each ['finished', 'failed', 'stopped', 'error', 'printing'] as s (s)}
				<option value={s} selected={data.filters.status === s}>{s}</option>
			{/each}
		</select>
		<button class="border-line hover:border-accent hover:text-accent border px-4 py-1.5 text-sm transition-colors">Filter</button>
	</form>

	<div class="border-line border">
		<table class="w-full text-sm">
			<thead>
				<tr class="border-line text-muted border-b text-left font-mono text-[11px] tracking-wider uppercase">
					<th class="px-3 py-2">File</th>
					<th class="px-3 py-2">Printer</th>
					<th class="px-3 py-2">Status</th>
					<th class="px-3 py-2">Progress</th>
					<th class="px-3 py-2">Started</th>
					<th class="px-3 py-2">Finished</th>
					<th class="px-3 py-2"></th>
				</tr>
			</thead>
			<tbody>
				{#each data.jobs as job (job.id)}
					<tr class="border-line border-b last:border-0">
						<td class="max-w-56 truncate px-3 py-2 font-mono">{job.file_name}</td>
						<td class="px-3 py-2">{job.printer_name}</td>
						<td class="px-3 py-2"><StateBadge state={jobBadge[job.status as string] ?? 'IDLE'} /></td>
						<td class="px-3 py-2 font-mono">{(job.progress as number).toFixed(0)}%</td>
						<td class="text-muted px-3 py-2 font-mono text-xs">{fmt(job.started_at)}</td>
						<td class="text-muted px-3 py-2 font-mono text-xs">{fmt(job.finished_at)}</td>
						<td class="px-3 py-2 text-right whitespace-nowrap">
							{#if job.timelapse_path}
								<a href="/api/jobs/{job.id}/timelapse" target="_blank" class="text-accent hover:underline">Timelapse</a>
							{/if}
							{#if job.failure_detected || job.status === 'failed'}
								<button
									class="text-warn ml-2 hover:underline"
									onclick={() => (expandedJob = expandedJob === job.id ? null : (job.id as number))}
								>
									{expandedJob === job.id ? 'Hide' : 'Failure'}
								</button>
							{/if}
						</td>
					</tr>
					{#if expandedJob === job.id}
						<tr class="border-line bg-surface border-b">
							<td colspan="7" class="px-3 py-4">
								<div class="flex flex-wrap gap-6">
									{#if job.failure_image_path}
										<img
											src="/api/jobs/{job.id}/failure-image"
											alt="Camera frame at failure detection"
											class="border-line max-h-48 border"
										/>
									{/if}
									<ActionForm action="?/saveFailureCause" toast="Save failure cause" class="min-w-64 flex-1">
										{#snippet children({ pending })}
											<input type="hidden" name="jobId" value={job.id} />
											<label class="text-muted mb-1.5 block text-xs tracking-wider uppercase" for="cause-{job.id}">
												Failure cause
											</label>
											<textarea
												id="cause-{job.id}"
												name="cause"
												rows="3"
												placeholder="What went wrong? e.g. first layer detached, spaghetti from support failure…"
												class="border-line bg-bg text-text focus:border-accent w-full border px-3 py-2 font-mono text-sm outline-none"
											>{job.failure_cause ?? ''}</textarea>
											<button
												disabled={pending}
												aria-busy={pending}
												class="border-line hover:border-accent hover:text-accent mt-2 flex items-center gap-2 border px-4 py-1.5 text-sm transition-colors disabled:opacity-50"
											>
												{#if pending}<Spinner />{/if}
												Save cause
											</button>
										{/snippet}
									</ActionForm>
								</div>
							</td>
						</tr>
					{/if}
				{:else}
					<tr><td colspan="7" class="text-muted px-3 py-8 text-center">No prints recorded yet.</td></tr>
				{/each}
			</tbody>
		</table>
	</div>
{:else if tab === 'batches'}
	<div class="border-line border">
		<table class="w-full text-sm">
			<thead>
				<tr class="border-line text-muted border-b text-left font-mono text-[11px] tracking-wider uppercase">
					<th class="px-3 py-2">File</th>
					<th class="px-3 py-2">Printer</th>
					<th class="px-3 py-2">Parts</th>
					<th class="px-3 py-2">Status</th>
					<th class="px-3 py-2">Started</th>
					<th class="px-3 py-2">Finished</th>
				</tr>
			</thead>
			<tbody>
				{#each data.batches as b (b.id)}
					<tr class="border-line border-b last:border-0">
						<td class="max-w-56 truncate px-3 py-2 font-mono">{b.file_name}</td>
						<td class="px-3 py-2">{b.printer_name}</td>
						<td class="px-3 py-2 font-mono">{b.completed_count}/{b.total_count}</td>
						<td class="px-3 py-2 font-mono text-xs uppercase">{b.status}</td>
						<td class="text-muted px-3 py-2 font-mono text-xs">{fmt(b.started_at)}</td>
						<td class="text-muted px-3 py-2 font-mono text-xs">{fmt(b.finished_at)}</td>
					</tr>
				{:else}
					<tr><td colspan="6" class="text-muted px-3 py-8 text-center">No batch runs yet.</td></tr>
				{/each}
			</tbody>
		</table>
	</div>
{:else}
	<div class="border-line border">
		<table class="w-full text-sm">
			<tbody>
				{#each data.events as e (e.id)}
					<tr class="border-line border-b last:border-0">
						<td class="text-muted w-40 px-3 py-2 font-mono text-xs">{fmt(e.created_at)}</td>
						<td class="w-40 px-3 py-2 font-mono text-xs uppercase">{e.type}</td>
						<td class="px-3 py-2">{e.message}</td>
					</tr>
				{:else}
					<tr><td class="text-muted px-3 py-8 text-center">No events yet.</td></tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}
