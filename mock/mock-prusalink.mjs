// Mock PrusaLink v1 server for development without a real printer.
// Usage: node mock/mock-prusalink.mjs [port] [printDurationSec]
import http from 'node:http';

const port = Number(process.argv[2] ?? 8091);
const printDurationSec = Number(process.argv[3] ?? 60);

// A 2x2 grey PNG — stands in for the slicer thumbnail a real printer would render.
const THUMBNAIL = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP8//8/AzbAhFVsGEsAAP//' +
		'FvIC1QAAAABJRU5ErkJggg==',
	'base64'
);

/**
 * Builds a .bgcode container header the way PrusaSlicer does, so the app's parser
 * has something real to read. Mirrors the writer in src/lib/server/gcode/bgcode.test.ts.
 */
function bgcodeBlock(type, payload) {
	const head = Buffer.alloc(8);
	head.writeUInt16LE(type, 0);
	head.writeUInt16LE(0, 2); // no compression
	head.writeUInt32LE(payload.length, 4);
	const encoding = Buffer.alloc(2); // u16 encoding = INI
	return Buffer.concat([head, encoding, payload, Buffer.alloc(4)]); // trailing CRC32
}

function bgcodeFor(name) {
	// A 5-tool XL with mixed materials, so the per-tool table has something to show.
	const multiTool = name.includes('gear') || name.includes('hinge');
	const printerMeta =
		`printer_model=${multiTool ? 'XL5' : 'MK4S'}\n` +
		(multiTool
			? 'filament_type=PLA;PETG;PLA;ASA;PLA\n' +
				'nozzle_diameter=0.4,0.6,0.4,0.4,0.4\n' +
				'temperature=215,240,215,260,215\n' +
				'bed_temperature=60,85,60,105,60\n' +
				'extruder_colour=#FF8000;#DB5182;#3EC0FF;#FF4F4F;#FBEB7D\n'
			: 'filament_type=PLA\nnozzle_diameter=0.4\ntemperature=215\nbed_temperature=60\n') +
		'layer_height=0.2\nfill_density=15%\nsupport_material=0\nmax_layer_z=24.6\n';

	const header = Buffer.alloc(10);
	header.write('GCDE', 0, 'latin1');
	header.writeUInt32LE(1, 4); // version
	header.writeUInt16LE(1, 8); // checksum type: CRC32
	return Buffer.concat([
		header,
		bgcodeBlock(0, Buffer.from('Producer=PrusaSlicer 2.9.0\nProduced on=2026-01-04 at 16:27:13 UTC\n')),
		bgcodeBlock(3, Buffer.from(printerMeta)),
		// A thumbnail block follows in a real file; the parser must stop here.
		bgcodeBlock(5, Buffer.alloc(64))
	]);
}

/** Enough files that the UI's pagination and name filter are actually exercisable. */
function seedFiles() {
	const names = [
		'benchy.bgcode',
		'calibration-cube.bgcode',
		'shape-box.gcode',
		'bracket-v3.bgcode',
		'gear-24t.gcode',
		'gear-36t.gcode',
		'hinge-left.bgcode',
		'hinge-right.bgcode',
		'knob-large.gcode',
		'knob-small.gcode',
		'mount-plate.bgcode',
		'phone-stand.gcode',
		'spool-holder.bgcode',
		'tolerance-test.gcode',
		'vase-mode-test.bgcode',
		'wall-hook.gcode',
		'whistle.bgcode',
		'clip-a.gcode',
		'clip-b.gcode',
		'enclosure-vent.bgcode'
	];
	// Fixed timestamps so the mock stays deterministic across restarts.
	return new Map(names.map((n, i) => [n, { size: (i + 1) * 128 * 1024, mtime: 1736008103 + i * 3600 }]));
}

const state = {
	printer: 'IDLE', // IDLE|PRINTING|PAUSED|FINISHED|STOPPED|ATTENTION|ERROR
	files: seedFiles(),
	job: null, // { id, fileName, startedAt, pausedAt, pausedTotalMs }
	nextJobId: 1
};

function jobProgress() {
	if (!state.job) return 0;
	const pausedMs = state.job.pausedTotalMs + (state.job.pausedAt ? Date.now() - state.job.pausedAt : 0);
	const elapsed = (Date.now() - state.job.startedAt - pausedMs) / 1000;
	return Math.min(100, (elapsed / printDurationSec) * 100);
}

function tick() {
	if (state.printer === 'PRINTING' && jobProgress() >= 100) {
		state.printer = 'FINISHED';
	}
}
setInterval(tick, 500);

function json(res, code, body) {
	res.writeHead(code, { 'content-type': 'application/json' });
	res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
	const url = new URL(req.url, `http://x`);
	const p = url.pathname;
	tick();

	// --- debug helpers ---
	if (req.method === 'POST' && p === '/debug/state') {
		let body = '';
		req.on('data', (c) => (body += c));
		req.on('end', () => {
			state.printer = JSON.parse(body).state;
			json(res, 200, { ok: true });
		});
		return;
	}

	if (req.method === 'GET' && p === '/api/v1/status') {
		const jobActive = state.job && ['PRINTING', 'PAUSED', 'ATTENTION'].includes(state.printer);
		return json(res, 200, {
			printer: { state: state.printer, temp_nozzle: 214.9, temp_bed: 60.1 },
			job: jobActive ? { id: state.job.id, progress: Math.round(jobProgress() * 10) / 10 } : undefined
		});
	}

	if (req.method === 'GET' && p === '/api/v1/job') {
		if (!state.job || !['PRINTING', 'PAUSED', 'ATTENTION'].includes(state.printer)) {
			res.writeHead(204);
			return res.end();
		}
		const progress = jobProgress();
		return json(res, 200, {
			id: state.job.id,
			state: state.printer,
			progress: Math.round(progress * 10) / 10,
			time_remaining: Math.max(0, Math.round(printDurationSec * (1 - progress / 100))),
			time_printing: Math.round(printDurationSec * (progress / 100)),
			file: { name: state.job.fileName, display_name: state.job.fileName, path: '/usb' }
		});
	}

	const jobMatch = p.match(/^\/api\/v1\/job\/(\d+)(\/pause|\/resume)?$/);
	if (jobMatch && state.job && Number(jobMatch[1]) === state.job.id) {
		if (req.method === 'PUT' && jobMatch[2] === '/pause' && state.printer === 'PRINTING') {
			state.printer = 'PAUSED';
			state.job.pausedAt = Date.now();
			res.writeHead(204);
			return res.end();
		}
		if (req.method === 'PUT' && jobMatch[2] === '/resume' && ['PAUSED', 'ATTENTION'].includes(state.printer)) {
			state.printer = 'PRINTING';
			if (state.job.pausedAt) {
				state.job.pausedTotalMs += Date.now() - state.job.pausedAt;
				state.job.pausedAt = null;
			}
			res.writeHead(204);
			return res.end();
		}
		if (req.method === 'DELETE' && !jobMatch[2]) {
			state.printer = 'STOPPED';
			res.writeHead(204);
			return res.end();
		}
	}

	if (p === '/api/v1/files/usb/' && req.method === 'GET') {
		return json(res, 200, {
			type: 'FOLDER',
			name: 'usb',
			children: [...state.files.entries()].map(([name, f]) => ({
				name,
				display_name: name,
				type: 'PRINT_FILE',
				size: f.size,
				m_timestamp: f.mtime,
				refs: {
					download: `/usb/${encodeURIComponent(name)}`,
					icon: `/api/thumbnails/usb/${encodeURIComponent(name)}.small.png`,
					thumbnail: `/api/thumbnails/usb/${encodeURIComponent(name)}.orig.png`
				}
			}))
		});
	}

	if (req.method === 'GET' && p.startsWith('/api/thumbnails/')) {
		res.writeHead(200, { 'content-type': 'image/png', 'content-length': THUMBNAIL.length });
		return res.end(THUMBNAIL);
	}

	// Raw file bytes, so the app can read slicer metadata out of the header.
	const rawMatch = p.match(/^\/usb\/(.+)$/);
	if (req.method === 'GET' && rawMatch) {
		const name = decodeURIComponent(rawMatch[1]);
		if (!state.files.has(name)) return json(res, 404, { message: 'file not found' });
		const body = bgcodeFor(name);
		res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': body.length });
		return res.end(body);
	}

	const fileMatch = p.match(/^\/api\/v1\/files\/usb\/(.+)$/);
	if (fileMatch) {
		const name = decodeURIComponent(fileMatch[1]);
		if (req.method === 'HEAD') {
			res.writeHead(state.files.has(name) ? 200 : 404);
			return res.end();
		}
		// Per-file detail. The real firmware returns `size` here even though its
		// bulk listing omits it, which is why the app bothers to ask.
		if (req.method === 'GET') {
			const f = state.files.get(name);
			if (!f) return json(res, 404, { message: 'file not found' });
			return json(res, 200, {
				name,
				display_name: name,
				type: 'PRINT_FILE',
				size: f.size,
				m_timestamp: f.mtime,
				refs: {
					download: `/usb/${encodeURIComponent(name)}`,
					icon: `/api/thumbnails/usb/${encodeURIComponent(name)}.small.png`,
					thumbnail: `/api/thumbnails/usb/${encodeURIComponent(name)}.orig.png`
				}
			});
		}
		if (req.method === 'PUT') {
			let size = 0;
			req.on('data', (c) => (size += c.length));
			req.on('end', () => {
				state.files.set(name, { size, mtime: Math.floor(Date.now() / 1000) });
				json(res, 201, { name });
			});
			return;
		}
		if (req.method === 'POST') {
			if (!state.files.has(name)) return json(res, 404, { message: 'file not found' });
			if (['PRINTING', 'PAUSED'].includes(state.printer)) return json(res, 409, { message: 'busy' });
			state.job = { id: state.nextJobId++, fileName: name, startedAt: Date.now(), pausedAt: null, pausedTotalMs: 0 };
			state.printer = 'PRINTING';
			res.writeHead(204);
			return res.end();
		}
		if (req.method === 'DELETE') {
			state.files.delete(name);
			res.writeHead(204);
			return res.end();
		}
	}

	if (p === '/api/v1/info') {
		return json(res, 200, { name: 'Mock XL', hostname: 'mock-xl', min_extrusion_temp: 170 });
	}

	json(res, 404, { message: `no route ${req.method} ${p}` });
});

server.listen(port, () => console.log(`[mock-prusalink] listening on :${port}, prints take ${printDurationSec}s`));
