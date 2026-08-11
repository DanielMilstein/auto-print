import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { JobLifecycleListener } from './orchestrator/watcher';
import type { Printer } from './printers/repo';
import { fetchSnapshot } from './vision';
import { setTimelapsePath } from './jobs';
import { storage } from './storage';

interface Recording {
	timer: ReturnType<typeof setInterval>;
	framesDir: string;
	frameCount: number;
	fps: number;
}

/**
 * Records a timelapse per print job: grabs a vision snapshot every
 * `timelapse_interval_sec` while the job runs, then assembles an mp4 with
 * ffmpeg when the job closes.
 */
export class TimelapseRecorder implements JobLifecycleListener {
	private recordings = new Map<number, Recording>();

	async onJobStarted(printer: Printer, jobRowId: number): Promise<void> {
		if (!printer.timelapse_enabled || !printer.vision_base_url) return;
		const framesDir = storage.timelapsePath(`job-${jobRowId}`);
		await fs.mkdir(framesDir, { recursive: true });

		const rec: Recording = {
			framesDir,
			frameCount: 0,
			fps: printer.timelapse_fps,
			timer: setInterval(
				() => this.captureFrame(printer, rec),
				Math.max(1, printer.timelapse_interval_sec) * 1000
			)
		};
		this.recordings.set(jobRowId, rec);
		void this.captureFrame(printer, rec); // first frame right away
	}

	async onJobClosed(printer: Printer, jobRowId: number): Promise<void> {
		const rec = this.recordings.get(jobRowId);
		if (!rec) return;
		this.recordings.delete(jobRowId);
		clearInterval(rec.timer);

		if (rec.frameCount < 2) {
			await fs.rm(rec.framesDir, { recursive: true, force: true });
			return;
		}
		try {
			const outPath = storage.timelapsePath(`job-${jobRowId}.mp4`);
			await encodeTimelapse(rec.framesDir, outPath, rec.fps);
			await setTimelapsePath(jobRowId, outPath);
			await fs.rm(rec.framesDir, { recursive: true, force: true });
			console.log(`[timelapse] job ${jobRowId}: wrote ${outPath} (${rec.frameCount} frames)`);
		} catch (err) {
			console.error(`[timelapse] job ${jobRowId}: encoding failed:`, err);
		}
	}

	private async captureFrame(printer: Printer, rec: Recording): Promise<void> {
		const image = await fetchSnapshot(printer.vision_base_url);
		if (!image) return;
		rec.frameCount += 1;
		const name = `frame-${String(rec.frameCount).padStart(6, '0')}.jpg`;
		await fs.writeFile(path.join(rec.framesDir, name), image).catch(() => {
			rec.frameCount -= 1;
		});
	}
}

function encodeTimelapse(framesDir: string, outPath: string, fps: number): Promise<void> {
	return new Promise((resolve, reject) => {
		const args = [
			'-y',
			'-framerate', String(fps),
			'-i', path.join(framesDir, 'frame-%06d.jpg'),
			'-c:v', 'libx264',
			'-pix_fmt', 'yuv420p',
			// libx264 requires even dimensions; pad odd-sized camera frames up
			'-vf', 'scale=ceil(iw/2)*2:ceil(ih/2)*2',
			outPath
		];
		const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
		let stderr = '';
		proc.stderr.on('data', (c) => (stderr += c));
		proc.on('error', reject);
		proc.on('close', (code) =>
			code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`))
		);
	});
}
