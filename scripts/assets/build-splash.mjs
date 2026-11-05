import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileRecord, readManifest, repositoryRoot, writeManifest } from './manifest.mjs';

// Rebuilds the Pantheon splash derivatives (P10 loop, P01 still) from their
// masters with FFmpeg, then records every output in assets/manifest.json.
// Run: corepack pnpm assets:splash   (requires ffmpeg and ffprobe on PATH)

const loopMaster = 'assets/masters/pantheon/pantheon-splash-loop.mp4';
const stillMaster = 'assets/masters/pantheon/pantheon-splash-still.png';
const outputDirectory = 'apps/pantheon/public/media/splash';
const widths = [1920, 1280, 960];
const fadeFrames = 24;
// Byte budgets from the splash plan: desktop motion <= 2.5 MB (AV1), mobile <= 0.8 MB.
const budgets = {
  webm: { 1920: 2_500_000, 1280: 1_400_000, 960: 800_000 },
  mp4: { 1920: 3_500_000, 1280: 1_800_000, 960: 1_000_000 },
  webp: { 1920: 420_000, 1280: 240_000, 960: 150_000 },
};

function run(command, args) {
  const result = spawnSync(command, args, { cwd: repositoryRoot, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (result.error?.code === 'ENOENT') throw new Error(`${command} is not on PATH; install FFmpeg to rebuild splash media.`);
  if (result.status !== 0) throw new Error(`${command} failed:\n${result.stderr}`);
  return result.stdout.trim();
}

const probe = (file, entries) => run('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', `stream=${entries}`, '-of', 'json', file]);
const dimensions = (file) => { const [stream] = JSON.parse(probe(file, 'width,height')).streams; return { width: stream.width, height: stream.height }; };

// The source does not loop cleanly (its last frame differs ~10x more than a
// normal frame step). Drop the first F frames, then blend the last F frames
// toward source frames 0..F-1, reaching 100% on the final frame. The output
// therefore ends on source frame F-1 and starts on source frame F: the wrap is
// one natural source step.
async function buildLoop(temporary) {
  const total = Number(JSON.parse(probe(loopMaster, 'nb_read_frames')).streams[0].nb_read_frames);
  const weight = `min(1,(N+1)/${fadeFrames})`;
  const graph = [
    `[0]split=3[a][b][c]`,
    `[a]trim=start_frame=${fadeFrames}:end_frame=${total - fadeFrames},setpts=PTS-STARTPTS[body]`,
    `[b]trim=start_frame=${total - fadeFrames}:end_frame=${total},setpts=PTS-STARTPTS[tail]`,
    `[c]trim=end_frame=${fadeFrames},setpts=PTS-STARTPTS[head]`,
    `[tail][head]blend=all_expr='A*(1-${weight})+B*${weight}'[mix]`,
    `[body][mix]concat=n=2:v=1[out]`,
  ].join(';');
  const loop = path.join(temporary, 'loop.mkv');
  run('ffmpeg', ['-v', 'error', '-y', '-i', loopMaster, '-filter_complex', graph, '-map', '[out]', '-c:v', 'ffv1', loop]);
  return { loop, frames: total - fadeFrames };
}

// AV1: 10-bit avoids banding in the sun halo; the temporal filter is off because
// it smooths away the engraved hatching (the identity of the artwork).
const encoders = {
  webm: (frames) => ['-c:v', 'libsvtav1', '-crf', '42', '-preset', '4', '-g', String(frames), '-pix_fmt', 'yuv420p10le', '-svtav1-params', 'tune=0:enable-tf=0'],
  mp4: () => ['-c:v', 'libx264', '-crf', '26', '-preset', 'slow', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'],
};

async function main() {
  await mkdir(path.join(repositoryRoot, outputDirectory), { recursive: true });
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'stex-splash-'));
  const outputs = { P10: [], P01: [] };
  try {
    const { loop, frames } = await buildLoop(temporary);
    for (const width of widths) {
      for (const container of ['webm', 'mp4']) {
        const target = `${outputDirectory}/pantheon-splash-loop-${width}w.${container}`;
        run('ffmpeg', ['-v', 'error', '-y', '-i', loop, '-vf', `scale=${width}:-2:flags=lanczos`, ...encoders[container](frames), '-an', '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:v', '+bitexact', target]);
        outputs.P10.push({ target, budget: budgets[container][width] });
      }
      const still = `${outputDirectory}/pantheon-splash-still-${width}w.webp`;
      run('ffmpeg', ['-v', 'error', '-y', '-i', stillMaster, '-vf', `scale=${width}:-2:flags=lanczos`, '-c:v', 'libwebp', '-quality', '78', '-map_metadata', '-1', '-fflags', '+bitexact', still]);
      outputs.P01.push({ target: still, budget: budgets.webp[width] });
    }
  } finally { await rm(temporary, { recursive: true, force: true }); }

  const manifest = await readManifest();
  let overBudget = false;
  for (const [id, files] of Object.entries(outputs)) {
    const asset = manifest.assets.find((entry) => entry.id === id);
    if (!asset) throw new Error(`Manifest has no ${id} record.`);
    asset.derivatives = [];
    for (const { target, budget } of files) {
      const record = { path: target, ...(await fileRecord(target)), ...dimensions(target), budgetBytes: budget, recipe: 'scripts/assets/build-splash.mjs' };
      asset.derivatives.push(record);
      if (record.bytes > budget) overBudget = true;
      console.log(`${record.bytes > budget ? 'OVER' : 'ok  '}  ${String(record.bytes).padStart(9)} / ${String(budget).padStart(9)}  ${target}`);
    }
  }
  await writeManifest(manifest);
  if (overBudget) { console.error('A splash derivative is over its byte budget.'); process.exit(1); }
}

await main();
