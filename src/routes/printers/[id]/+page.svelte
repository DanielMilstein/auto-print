<script lang="ts">
	import StateBadge from '$lib/components/StateBadge.svelte';
	import LayerProgress from '$lib/components/LayerProgress.svelte';
	import ActionForm from '$lib/components/ActionForm.svelte';
	import Spinner from '$lib/components/Spinner.svelte';
	import UsbFileList from '$lib/components/UsbFileList.svelte';
	import { createUsbFiles } from '$lib/usbFiles.svelte';
	import type { PrinterStatus } from '$lib/server/printers/adapter';

	let { data } = $props();

	// Fetched client-side: the USB listing takes 6-12s on a real printer and must
	// not hold up the first paint. Shared with the batch form's file picker.
	const usb = createUsbFiles(() => data.printer.id);

	interface BatchInfo {
		id: number;
		file_name: string;
		total_count: number;
		completed_count: number;
		status: string;
		phase: string;
	}

	interface ManualJobInfo {
		jobId: string;
		kind: 'pick_place' | 'return_to_origin';
		status: 'running' | 'succeeded' | 'failed' | 'cancelled';
		startedAt: number;
		finishedAt?: number;
		logTail: string[];
	}

	let status = $state<PrinterStatus | null>(null);
	let batch = $state<BatchInfo | null>(data.batch as BatchInfo | null);
	let manualJob = $state<ManualJobInfo | null>(data.manualJob as ManualJobInfo | null);
	// Ticks with the poll so the job's elapsed time keeps moving.
	let now = $state(Date.now());

	async function poll() {
		now = Date.now();
		try {
			const res = await fetch(`/api/printers/${data.printer.id}/state`);
			if (res.ok) {
				const body = await res.json();
				status = body.status;
				batch = body.batch;
				manualJob = body.manualJob;
			}
		} catch {
			// transient poll failure; next tick retries
		}
	}

	$effect(() => {
		poll();
		const t = setInterval(poll, 3000);
		return () => clearInterval(t);
	});

	const job = $derived(status?.job);
	const canPause = $derived(status?.state === 'PRINTING');
	const canResume = $derived(status?.state === 'PAUSED' || status?.state === 'ATTENTION');
	const canStop = $derived(!!job && ['PRINTING', 'PAUSED', 'ATTENTION'].includes(status?.state ?? ''));
	// Bed occupied and the head in the way — mirrors the server-side guard.
	const printerBusy = $derived(['PRINTING', 'PAUSED', 'ATTENTION'].includes(status?.state ?? ''));

	function fmtTime(sec?: number): string {
		if (sec == null) return '—';
		const h = Math.floor(sec / 3600);
		const m = Math.round((sec % 3600) / 60);
		return h > 0 ? `${h}h ${m}m` : `${m}m`;
	}

	/** m:ss, clamped — `startedAt` is the server's clock, the browser's may differ. */
	function fmtElapsed(ms: number): string {
		const s = Math.max(0, Math.round(ms / 1000));
		return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
	}

	const JOB_VERB = {
		pick_place: { running: 'Removing…', done: 'Removal' },
		return_to_origin: { running: 'Returning to origin…', done: 'Return to origin' }
	} as const;

	const jobTone = $derived(
		manualJob?.status === 'succeeded'
			? 'text-ok'
			: manualJob?.status === 'running'
				? 'text-text'
				: 'text-danger'
	);

	// Follow the log as the gateway appends to it, but only while it is running —
	// once it settles the operator is reading, and yanking the scroll is rude.
	let logBox = $state<HTMLPreElement | null>(null);
	$effect(() => {
		const lines = manualJob?.logTail.length ?? 0;
		if (logBox && manualJob?.status === 'running' && lines) logBox.scrollTop = logBox.scrollHeight;
	});
</script>

<div class="mb-6 flex items-center justify-between">
	<div class="flex items-center gap-4">
		<h1 class="font-display text-xl font-bold tracking-wide uppercase">{data.printer.name}</h1>
		{#if status}<StateBadge state={status.state} />{/if}
	</div>
	<a href="/printers/{data.printer.id}/settings" class="text-muted hover:text-text text-sm">Printer settings</a>
</div>

<div class="grid gap-6 xl:grid-cols-[3fr_2fr]">
	<!-- Camera -->
	<section class="border-line bg-surface border">
		<h2 class="font-display border-line border-b px-4 py-2.5 text-xs font-semibold tracking-wider uppercase">Camera</h2>
		{#if data.printer.vision_base_url}
			<img
				src="/api/printers/{data.printer.id}/stream"
				alt="Live camera stream of {data.printer.name}"
				class="aspect-video w-full bg-black object-contain"
			/>
		{:else}
			<div class="text-muted flex aspect-video items-center justify-center text-sm">
				No camera. Set the vision service URL in printer settings.
			</div>
		{/if}
	</section>

	<div class="space-y-6">
		<!-- Job -->
		<section class="border-line bg-surface border">
			<h2 class="font-display border-line border-b px-4 py-2.5 text-xs font-semibold tracking-wider uppercase">Print job</h2>
			<div class="space-y-4 p-4">
				{#if job}
					<p class="truncate font-mono text-sm">{job.fileName || '—'}</p>
					<LayerProgress progress={job.progress} />
					<div class="grid grid-cols-3 gap-2 font-mono text-sm">
						<div><span class="text-muted block text-[11px] uppercase">Progress</span>{job.progress.toFixed(1)}%</div>
						<div><span class="text-muted block text-[11px] uppercase">Remaining</span>{fmtTime(job.timeRemainingSec)}</div>
						<div><span class="text-muted block text-[11px] uppercase">Elapsed</span>{fmtTime(job.timePrintingSec)}</div>
					</div>
				{:else}
					<p class="text-muted text-sm">Nothing printing.</p>
				{/if}
				<div class="grid grid-cols-3 gap-2 font-mono text-sm">
					<div><span class="text-muted block text-[11px] uppercase">Nozzle</span>{status?.nozzleTempC?.toFixed(0) ?? '—'}°C</div>
					<div><span class="text-muted block text-[11px] uppercase">Bed</span>{status?.bedTempC?.toFixed(0) ?? '—'}°C</div>
				</div>
				{#if job}
					<div class="flex gap-2">
						{#if canPause}
							<ActionForm action="?/pause" toast="Pause print">
								{#snippet children({ pending })}
									<input type="hidden" name="jobId" value={job.id} />
									<button
										disabled={pending}
										aria-busy={pending}
										class="border-line hover:border-warn hover:text-warn flex items-center gap-2 border px-4 py-1.5 text-sm transition-colors disabled:opacity-50"
									>
										{#if pending}<Spinner />{/if}
										Pause
									</button>
								{/snippet}
							</ActionForm>
						{/if}
						{#if canResume}
							<ActionForm action="?/resume" toast="Resume print">
								{#snippet children({ pending })}
									<input type="hidden" name="jobId" value={job.id} />
									<button
										disabled={pending}
										aria-busy={pending}
										class="border-line hover:border-ok hover:text-ok flex items-center gap-2 border px-4 py-1.5 text-sm transition-colors disabled:opacity-50"
									>
										{#if pending}<Spinner />{/if}
										Resume
									</button>
								{/snippet}
							</ActionForm>
						{/if}
						{#if canStop}
							<ActionForm action="?/stop" toast="Stop print">
								{#snippet children({ pending })}
									<input type="hidden" name="jobId" value={job.id} />
									<button
										disabled={pending}
										aria-busy={pending}
										class="border-line hover:border-danger hover:text-danger flex items-center gap-2 border px-4 py-1.5 text-sm transition-colors disabled:opacity-50"
									>
										{#if pending}<Spinner />{/if}
										Stop
									</button>
								{/snippet}
							</ActionForm>
						{/if}
					</div>
				{/if}
			</div>
		</section>

		<!-- Robot -->
		<section class="border-line bg-surface border">
			<h2 class="font-display border-line border-b px-4 py-2.5 text-xs font-semibold tracking-wider uppercase">Robot</h2>
			<div class="space-y-4 p-4">
				{#if !data.printer.robot_gateway_url}
					<p class="text-muted text-sm">No robot. Set the gateway URL in printer settings.</p>
				{:else}
					{#if manualJob?.status === 'running'}
						{@const active = manualJob}
						<div class="flex items-center gap-2 text-sm">
							<Spinner />
							<span>{JOB_VERB[active.kind].running}</span>
							<span class="text-muted font-mono">{fmtElapsed(now - active.startedAt)}</span>
						</div>
						<ActionForm action="?/robotCancel" toast="Cancel robot job">
							{#snippet children({ pending })}
								<button
									disabled={pending}
									aria-busy={pending}
									class="border-danger/40 text-danger hover:bg-danger/10 flex items-center gap-2 border px-3 py-1.5 text-sm transition-colors disabled:opacity-50"
								>
									{#if pending}<Spinner />{/if}
									Cancel
								</button>
							{/snippet}
						</ActionForm>
					{:else}
						<div class="flex flex-wrap gap-2">
							<ActionForm
								action="?/robotRemove"
								toast="Robot removal"
								confirm={() => window.confirm(`Trigger the robot arm on ${data.printer.name}? It will move.`)}
							>
								{#snippet children({ pending })}
									<button
										disabled={pending || printerBusy}
										aria-busy={pending}
										class="border-line hover:border-accent hover:text-accent flex items-center gap-2 border px-4 py-1.5 text-sm transition-colors disabled:opacity-50"
									>
										{#if pending}<Spinner />{/if}
										Trigger removal
									</button>
								{/snippet}
							</ActionForm>
							<ActionForm
								action="?/robotReturnToOrigin"
								toast="Return to origin"
								confirm={() =>
									window.confirm('Drive the robot base back to the odometry origin? It will move across the floor.')}
							>
								{#snippet children({ pending })}
									<button
										disabled={pending}
										aria-busy={pending}
										class="border-line hover:border-accent hover:text-accent flex items-center gap-2 border px-4 py-1.5 text-sm transition-colors disabled:opacity-50"
									>
										{#if pending}<Spinner />{/if}
										Return to origin
									</button>
								{/snippet}
							</ActionForm>
						</div>
						<p class="text-muted text-xs">
							{#if printerBusy}
								Removal is unavailable mid-print — stop the print first. Return to origin only
								drives the base, so it stays available.
							{:else}
								Removal runs the same pick-and-place task a batch uses after a part finishes.
								Return to origin drives the base back to the odometry origin.
							{/if}
						</p>
					{/if}

					{#if manualJob}
						{@const shown = manualJob}
						<div class="space-y-1.5">
							<div class="flex items-baseline justify-between gap-2">
								<span class="text-muted font-mono text-[11px] tracking-wider uppercase">Gateway log</span>
								{#if shown.status !== 'running'}
									<span class="font-mono text-[11px] {jobTone}">
										{JOB_VERB[shown.kind].done}
										{shown.status}
									</span>
								{/if}
							</div>
							<pre
								bind:this={logBox}
								class="border-line bg-bg text-muted max-h-40 overflow-auto border p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">{shown
									.logTail.length
									? shown.logTail.join('\n')
									: 'Waiting for the gateway…'}</pre>
						</div>
					{/if}
				{/if}
			</div>
		</section>

		<!-- Batch -->
		<section class="border-line bg-surface border">
			<h2 class="font-display border-line border-b px-4 py-2.5 text-xs font-semibold tracking-wider uppercase">Batch run</h2>
			<div class="space-y-4 p-4">
				{#if batch}
					{@const activeBatch = batch}
					<div class="flex items-center justify-between gap-2">
						<p class="truncate font-mono text-sm">{batch.file_name}</p>
						<span class="font-mono text-sm">{batch.completed_count}/{batch.total_count}</span>
					</div>
					<LayerProgress progress={(batch.completed_count / batch.total_count) * 100} tone="ok" />
					<p class="text-muted font-mono text-xs tracking-wider uppercase">
						{batch.status === 'active' ? `phase: ${batch.phase}` : batch.status.replace('_', ' ')}
					</p>
					{#if batch.status === 'paused_failure' || batch.status === 'paused_user'}
						<div class="border-warn/40 bg-warn/5 space-y-3 border p-3">
							<p class="text-warn text-sm">
								Batch paused. Clear the print bed, then choose how to continue.
							</p>
							<div class="flex flex-wrap gap-2">
								<ActionForm action="?/batchResumeRetry" toast="Retry part">
									{#snippet children({ pending })}
										<input type="hidden" name="batchId" value={activeBatch.id} />
										<button
											disabled={pending}
											aria-busy={pending}
											class="border-line hover:border-ok hover:text-ok flex items-center gap-2 border px-3 py-1.5 text-sm transition-colors disabled:opacity-50"
										>
											{#if pending}<Spinner />{/if}
											Retry part
										</button>
									{/snippet}
								</ActionForm>
								<ActionForm action="?/batchResumeSkip" toast="Skip part">
									{#snippet children({ pending })}
										<input type="hidden" name="batchId" value={activeBatch.id} />
										<button
											disabled={pending}
											aria-busy={pending}
											class="border-line hover:border-ok hover:text-ok flex items-center gap-2 border px-3 py-1.5 text-sm transition-colors disabled:opacity-50"
										>
											{#if pending}<Spinner />{/if}
											Skip part &amp; continue
										</button>
									{/snippet}
								</ActionForm>
								<ActionForm action="?/batchCancel" toast="Cancel batch">
									{#snippet children({ pending })}
										<input type="hidden" name="batchId" value={activeBatch.id} />
										<button
											disabled={pending}
											aria-busy={pending}
											class="border-danger/40 text-danger hover:bg-danger/10 flex items-center gap-2 border px-3 py-1.5 text-sm transition-colors disabled:opacity-50"
										>
											{#if pending}<Spinner />{/if}
											Cancel batch
										</button>
									{/snippet}
								</ActionForm>
							</div>
						</div>
					{:else}
						<ActionForm action="?/batchCancel" toast="Cancel batch">
							{#snippet children({ pending })}
								<input type="hidden" name="batchId" value={activeBatch.id} />
								<button
									disabled={pending}
									aria-busy={pending}
									class="border-danger/40 text-danger hover:bg-danger/10 flex items-center gap-2 border px-3 py-1.5 text-sm transition-colors disabled:opacity-50"
								>
									{#if pending}<Spinner />{/if}
									Cancel batch
								</button>
							{/snippet}
						</ActionForm>
					{/if}
				{:else}
					<ActionForm action="?/startBatch" toast="Start batch" class="space-y-3">
						{#snippet children({ pending })}
							<div class="grid grid-cols-[1fr_5rem] gap-3">
								<label class="block">
									<span class="text-muted mb-1.5 block text-xs tracking-wider uppercase">File</span>
									<select
										name="file"
										required
										disabled={usb.loading || usb.files.length === 0}
										class="border-line bg-bg text-text w-full border px-2 py-2 font-mono text-sm disabled:opacity-50"
									>
										{#if usb.loading}
											<option value="">Loading files…</option>
										{:else if usb.files.length === 0}
											<option value="">No files on the USB drive</option>
										{:else}
											{#each usb.files as file (file.name)}
												<option value={file.name}>{file.displayName}</option>
											{/each}
										{/if}
									</select>
								</label>
								<label class="block">
									<span class="text-muted mb-1.5 block text-xs tracking-wider uppercase">Parts</span>
									<input
										name="count"
										type="number"
										min="1"
										value="1"
										required
										class="border-line bg-bg text-text w-full border px-2 py-2 font-mono text-sm"
									/>
								</label>
							</div>
							<label class="flex items-center gap-2.5">
								<input type="checkbox" name="failure_detection" checked class="accent-accent h-4 w-4" />
								<span class="text-sm">Stop on detected failure</span>
							</label>
							<p class="text-muted text-xs">
								Prints the file, has the robot remove the part, and repeats until all parts are done.
							</p>
							<button
								disabled={pending || usb.loading || usb.files.length === 0}
								aria-busy={pending}
								class="bg-accent hover:bg-accent-dim font-display flex items-center gap-2 px-4 py-1.5 text-sm font-semibold tracking-wide text-black uppercase transition-colors disabled:opacity-50"
							>
								{#if pending}<Spinner />{/if}
								Start batch
							</button>
						{/snippet}
					</ActionForm>
				{/if}
			</div>
		</section>

		<UsbFileList printerId={data.printer.id} {usb} />
	</div>
</div>
