// Mock robot_gateway for development.
// Usage: node mock/mock-robot.mjs [port] [jobDurationSec]
//   POST /jobs?fail=1 makes the job fail (also honored as {"fail": true} in the body params)
import http from 'node:http';
import { randomUUID } from 'node:crypto';

const port = Number(process.argv[2] ?? 8093);
const jobDurationSec = Number(process.argv[3] ?? 20);

const jobs = new Map(); // id -> { status, started_at, finished_at, log_tail }
let running = null;

function json(res, code, body) {
	res.writeHead(code, { 'content-type': 'application/json' });
	res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
	const url = new URL(req.url, 'http://x');

	if (req.method === 'GET' && url.pathname === '/health') {
		return json(res, 200, { ok: true, busy: running !== null });
	}

	if (req.method === 'POST' && url.pathname === '/jobs') {
		if (running !== null) return json(res, 409, { message: 'busy' });
		let body = '';
		req.on('data', (c) => (body += c));
		req.on('end', () => {
			const parsed = body ? JSON.parse(body) : {};
			const shouldFail = url.searchParams.get('fail') === '1' || parsed?.params?.fail === 'true';
			const kind = parsed.kind ?? 'pick_place';
			const id = randomUUID();
			const job = {
				status: 'running',
				started_at: new Date().toISOString(),
				finished_at: null,
				log_tail:
					kind === 'return_to_origin'
						? [`[gateway] kind: ${kind}`, 'ros2 run gemini_pick_place_executor return_to_origin.py']
						: [`[gateway] kind: ${kind}`, `task: ${parsed.task ?? ''}`, `keys: ${(parsed.gemini_api_keys ?? []).length}`]
			};
			jobs.set(id, job);
			running = id;
			// Dribble out lines so the UI's log window has something to follow.
			const chatter = setInterval(() => {
				if (job.status !== 'running') return clearInterval(chatter);
				job.log_tail.push(
					kind === 'return_to_origin'
						? `[return_to_origin] driving, ${(Math.random() * 0.5).toFixed(3)} m to go`
						: `[executor] step ${job.log_tail.length}`
				);
			}, 2000);
			setTimeout(() => {
				clearInterval(chatter);
				job.status = shouldFail ? 'failed' : 'succeeded';
				job.finished_at = new Date().toISOString();
				job.log_tail.push(
					kind === 'return_to_origin'
						? shouldFail
							? '[return_to_origin] position drive: timeout'
							: 'position: arrived (err=0.0041 m)'
						: shouldFail
							? 'Pick-and-place sequence aborted'
							: 'Pick-and-place sequence completed'
				);
				running = null;
			}, jobDurationSec * 1000);
			json(res, 202, { job_id: id });
		});
		return;
	}

	const m = url.pathname.match(/^\/jobs\/([0-9a-f-]+)(\/cancel)?$/);
	if (m) {
		const job = jobs.get(m[1]);
		if (!job) return json(res, 404, { message: 'unknown job' });
		if (req.method === 'POST' && m[2]) {
			if (job.status === 'running') {
				job.status = 'cancelled';
				job.finished_at = new Date().toISOString();
				running = null;
			}
			return json(res, 200, { ok: true });
		}
		if (req.method === 'GET' && !m[2]) return json(res, 200, job);
	}

	json(res, 404, { message: `no route ${req.method} ${url.pathname}` });
});

server.listen(port, () => console.log(`[mock-robot] listening on :${port}, removals take ${jobDurationSec}s`));
