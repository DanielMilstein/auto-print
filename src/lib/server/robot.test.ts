import { afterEach, describe, expect, it, vi } from 'vitest';
import { startRemoval } from './robot';

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
});
