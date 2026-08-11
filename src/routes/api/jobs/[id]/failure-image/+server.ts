import { error } from '@sveltejs/kit';
import fs from 'node:fs';
import type { RequestHandler } from './$types';
import { getJob } from '$lib/server/jobs';

export const GET: RequestHandler = async ({ params }) => {
	const job = await getJob(Number(params.id));
	if (!job?.failure_image_path || !fs.existsSync(job.failure_image_path)) {
		error(404, 'No failure image for this job');
	}
	return new Response(fs.createReadStream(job.failure_image_path) as unknown as ReadableStream, {
		headers: { 'content-type': 'image/jpeg' }
	});
};
