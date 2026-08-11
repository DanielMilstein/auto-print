import { error } from '@sveltejs/kit';
import fs from 'node:fs';
import type { RequestHandler } from './$types';
import { getJob } from '$lib/server/jobs';

export const GET: RequestHandler = async ({ params }) => {
	const job = await getJob(Number(params.id));
	if (!job?.timelapse_path || !fs.existsSync(job.timelapse_path)) error(404, 'No timelapse for this job');

	const stat = fs.statSync(job.timelapse_path);
	const stream = fs.createReadStream(job.timelapse_path);
	return new Response(stream as unknown as ReadableStream, {
		headers: {
			'content-type': 'video/mp4',
			'content-length': String(stat.size)
		}
	});
};
