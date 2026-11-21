/**
 * Crisp, smooth clip recording.
 *
 * Playwright's built-in `recordVideo` is low-bitrate, variable-frame-rate VP8: text looks soft and motion
 * judders once Remotion resamples it. Instead this grabs high-quality JPEG frames through `page.screencast`,
 * keeps each frame's real capture time, and has ffmpeg lay them onto a constant 60fps H.264 timeline.
 */
import type { Page } from "playwright";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export const OUTPUT_FPS = 60;

/** ffmpeg with libx264 (on PATH, or set FFMPEG to its full path). */
const ffmpegBinary = () => process.env.FFMPEG ?? "ffmpeg";

export type KeyEvent = { t: number; keys: string };
export type ClipInfo = {
  /** Length of the recorded file in seconds. */
  duration: number;
  /** [start, end] ranges of the file to play back to back. Waiting time (e.g. for the model's first token) is cut out. */
  segments: [number, number][];
  /** Keyboard shortcuts pressed, in file time, so the video can show matching keycaps. */
  keys: KeyEvent[];
};

export class Recorder {
  private dir = "";
  private frames: { file: string; ts: number }[] = [];
  private writes: Promise<unknown>[] = [];
  private wallStart = 0;
  private firstTs: number | null = null;
  private firstWall = 0;
  private lastFrameWall = 0;
  private stopFn: (() => Promise<void>) | null = null;
  readonly keys: KeyEvent[] = [];
  private cuts: [number, number][] = [];

  constructor(
    private page: Page,
    private size: { width: number; height: number },
  ) {}

  /** Seconds since recording started. */
  now() {
    return (Date.now() - this.wallStart) / 1000;
  }

  async start() {
    this.dir = await mkdtemp(path.join(os.tmpdir(), "st-clip-"));
    this.wallStart = Date.now();
    await this.page.screencast.start({
      size: this.size,
      quality: 92,
      onFrame: ({ data, timestamp }) => {
        // Timestamps are monotonic but their unit/epoch isn't guaranteed, so we normalise later.
        if (this.firstTs === null) {
          this.firstTs = timestamp;
          this.firstWall = Date.now();
        }
        const file = path.join(this.dir, `f${String(this.frames.length).padStart(6, "0")}.jpg`);
        this.frames.push({ file, ts: timestamp });
        this.lastFrameWall = Date.now();
        this.writes.push(writeFile(file, data));
      },
    });
    // (The cursor is drawn by capture.ts's init script. Playwright's showActions overlay
    // looks similar but adds ~2s to every click while recording.)
    this.stopFn = () => this.page.screencast.stop();
  }

  /** Note a keyboard shortcut so the video can pop up a matching keycap. */
  async press(keys: string, label = keys) {
    this.keys.push({ t: this.now(), keys: label });
    await this.page.keyboard.press(keys);
  }

  /**
   * Runs `wait` and marks the time it took as dead air to cut from the clip,
   * keeping a little either side so the cut feels natural.
   */
  async cut<T>(wait: () => Promise<T>, keepBefore = 0.25, keepAfter = 0.12): Promise<T> {
    const start = this.now();
    const result = await wait();
    const end = this.now();
    if (end - start > keepBefore + keepAfter + 0.3) this.cuts.push([start + keepBefore, end - keepAfter]);
    return result;
  }

  /** Stops recording and writes an mp4. */
  async save(outFile: string) {
    const stopWall = Date.now();
    await this.stopFn?.();
    await Promise.all(this.writes);
    if (this.frames.length < 2) throw new Error("No frames were captured.");

    const wallSpan = (Date.now() - this.wallStart) / 1000;
    const tsSpan = this.frames.at(-1)!.ts - this.frames[0].ts;
    // Decide whether timestamps are seconds or milliseconds by comparing with the wall clock.
    const unit = tsSpan > wallSpan * 20 ? 1 / 1000 : 1;

    const lines = ["ffconcat version 1.0"];
    for (let i = 0; i < this.frames.length; i++) {
      const cur = this.frames[i];
      const next = this.frames[i + 1];
      // The screencast only sends frames when something repaints, so a still ending has no frames:
      // hold the last one until recording actually stopped.
      const dur = next ? Math.max(0.001, (next.ts - cur.ts) * unit) : Math.max(1 / OUTPUT_FPS, (stopWall - this.lastFrameWall) / 1000);
      lines.push(`file '${path.basename(cur.file)}'`, `duration ${dur.toFixed(6)}`);
    }
    lines.push(`file '${path.basename(this.frames.at(-1)!.file)}'`);
    const list = path.join(this.dir, "frames.txt");
    await writeFile(list, lines.join("\n"));

    await mkdir(path.dirname(outFile), { recursive: true });
    await run(
      ffmpegBinary(),
      [
        "-y",
        "-loglevel", "error",
        "-f", "concat",
        "-safe", "0",
        "-i", list,
        "-vf", `fps=${OUTPUT_FPS},scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p`,
        "-c:v", "libx264",
        "-preset", "slow",
        "-crf", "14",
        "-movflags", "+faststart",
        outFile,
      ],
      { maxBuffer: 1 << 26 },
    );
    await rm(this.dir, { recursive: true, force: true });

    const duration = Number((tsSpan * unit + Math.max(0, (stopWall - this.lastFrameWall) / 1000)).toFixed(2));
    // Wall clock and frame clock start a hair apart; shift so wall times line up with file times.
    const offset = (this.firstWall - this.wallStart) / 1000;
    const r = (n: number) => Number(Math.max(0, n - offset).toFixed(3));
    const segments: [number, number][] = [];
    let from = 0;
    for (const [a, b] of this.cuts) {
      segments.push([r(from), r(a)]);
      from = b;
    }
    segments.push([r(from), duration]);
    return { duration, segments, keys: this.keys.map((k) => ({ ...k, t: r(k.t) })) } satisfies ClipInfo;
  }
}
