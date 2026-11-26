import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRemovalJob, startRemoval } from './robot';

describe('robot gateway client', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('requests enough gateway time for a complete hardware removal', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ job_id: 'job-1' }), {
				status: 202,
				headers: { 'Content-Type': 'application/json' }
			})
		);
		vi.stubGlobal('fetch', fetchMock);

		await startRemoval('http://robot:8090', {
			task: 'put the white cube in the grey container',
			params: {},
			geminiApiKeys: []
		});

		const [, request] = fetchMock.mock.calls[0];
		expect(JSON.parse(String(request.body))).toMatchObject({
			timeout_sec: 1200
		});
	});

	// The gateway keeps jobs in memory. After it restarts, every job it was
	// running is gone and GET /jobs/{id} answers 404 for good. Reporting that
	// as a transport error would leave the pollers retrying until their caps.
	it('settles a job the gateway no longer knows as failed', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify({ detail: 'unknown job' }), {
					status: 404,
					headers: { 'Content-Type': 'application/json' }
				})
			)
		);

		const job = await getRemovalJob('http://robot:8090', 'job-1');

		expect(job.status).toBe('failed');
		expect(job.logTail?.at(-1)).toMatch(/no longer knows/i);
	});

	it('still throws on other gateway errors so the poller keeps trying', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 503 })));

		await expect(getRemovalJob('http://robot:8090', 'job-1')).rejects.toThrow(/503/);
	});
});
