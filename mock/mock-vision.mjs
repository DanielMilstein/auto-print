// Mock vision (failure detection) service for development.
// Usage: node mock/mock-vision.mjs [port] [platformWebhookUrl] [webhookSecret]
//   POST /debug/fire-alert  -> posts the real HttpPostNotifier payload to the platform webhook
import http from 'node:http';

const port = Number(process.argv[2] ?? 8092);
const webhookUrl = process.argv[3] ?? 'http://localhost:3000/api/webhooks/vision/1';
const webhookSecret = process.argv[4] ?? '';

// A tiny valid JPEG (1x1 gray pixel), enough to exercise image handling.
const JPEG = Buffer.from(
	'/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
	'base64'
);

function json(res, code, body) {
	res.writeHead(code, { 'content-type': 'application/json' });
	res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
	const url = new URL(req.url, 'http://x');

	if (url.pathname === '/hc/') {
		return json(res, 200, { ml_api: true, frame: true, ts: Date.now() / 1000 });
	}

	if (url.pathname === '/snapshot.jpg') {
		res.writeHead(200, { 'content-type': 'image/jpeg' });
		return res.end(JPEG);
	}

	if (url.pathname === '/detections') {
		return json(res, 200, { timestamp: Date.now() / 1000, detections: [] });
	}

	if (url.pathname === '/stream.mjpg') {
		res.writeHead(200, { 'content-type': 'multipart/x-mixed-replace; boundary=frame' });
		const timer = setInterval(() => {
			res.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${JPEG.length}\r\n\r\n`);
			res.write(JPEG);
			res.write('\r\n');
		}, 200);
		req.on('close', () => clearInterval(timer));
		return;
	}

	if (req.method === 'POST' && url.pathname === '/debug/fire-alert') {
		const payload = {
			title: 'Detection Alert',
			text: 'failure 0.87 — 5 consecutive frames',
			timestamp: Date.now() / 1000,
			detections: [{ label: 'failure', score: 0.87, bbox: { xc: 320, yc: 240, w: 80, h: 60 } }],
			image_jpeg_base64: JPEG.toString('base64')
		};
		try {
			const r = await fetch(webhookUrl, {
				method: 'POST',
				headers: { 'content-type': 'application/json', 'x-webhook-token': webhookSecret },
				body: JSON.stringify(payload)
			});
			return json(res, 200, { forwarded: r.status, body: await r.text() });
		} catch (err) {
			return json(res, 502, { error: String(err) });
		}
	}

	json(res, 404, { message: `no route ${req.method} ${url.pathname}` });
});

server.listen(port, () => console.log(`[mock-vision] listening on :${port}, webhook -> ${webhookUrl}`));
