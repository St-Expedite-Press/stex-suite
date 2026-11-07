import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileRecord, readManifest, repositoryRoot, writeManifest } from './manifest.mjs';

// Rebuilds web derivatives from their masters with FFmpeg and records every
// output in assets/manifest.json. Output is bit-exact for a given FFmpeg build
// (with its libsvtav1, x264, and libwebp): unchanged masters reproduce identical
// files. A different FFmpeg build may produce different bytes.
//   corepack pnpm assets:build [splash|masthead|emblems ...]   (default: all)
// Requires ffmpeg and ffprobe on PATH.

const widths = [1920, 1280, 960];
const fadeFrames = 24;

// Loops and their stills. `crop(width)` keeps only the part of the master a
// page shows; `quality` sets AV1 CRF, H.264 CRF, and WebP quality.
const loops = {
  splash: {
    loop: { id: 'P10', master: 'assets/masters/pantheon/pantheon-splash-loop.mp4' },
    still: { id: 'P01', master: 'assets/masters/pantheon/pantheon-splash-still.png' },
    output: 'apps/pantheon/public/media/splash',
    crop: () => null,
    quality: { av1: 42, h264: 26, webp: 78 },
    // Desktop motion <= 2.5 MB (AV1), mobile <= 0.8 MB.
    budgets: { webm: { 1920: 2_500_000, 1280: 1_400_000, 960: 800_000 }, mp4: { 1920: 3_500_000, 1280: 1_800_000, 960: 1_000_000 }, webp: { 1920: 420_000, 1280: 240_000, 960: 150_000 } },
  },
  // The masthead shows a thin strip of P11's art band (rows 220-821). Desktop
  // widths get a 6.7:1 stripe around the face, arm, and sun (rows 300-587);
  // the phone width gets a 4:1 window (rows 220-699) for its taller header.
  // Dense engraving and fast motion cost more bits than the splash, so the
  // masthead is weighted as an editorial element: AV1 CRF 48 measured SSIM
  // 0.971 at 1.55 MB against 0.940 for H.264 CRF 29 at 1.41 MB.
  masthead: {
    loop: { id: 'P11', master: 'assets/masters/pantheon/pantheon-masthead-loop.mp4' },
    still: { id: 'P02', master: 'assets/masters/pantheon/pantheon-masthead-still.png' },
    output: 'apps/pantheon/public/media/masthead',
    crop: (width) => (width >= 1280 ? 'crop=1920:288:0:300' : 'crop=1920:480:0:220'),
    quality: { av1: 48, h264: 28, webp: 72 },
    budgets: { webm: { 1920: 1_800_000, 1280: 900_000, 960: 650_000 }, mp4: { 1920: 2_000_000, 1280: 1_000_000, 960: 750_000 }, webp: { 1920: 230_000, 1280: 115_000, 960: 110_000 } },
  },
};

// Studio emblems carved from R02: published at their native width and at 2x
// for high-density screens. Alpha is kept.
const emblems = [
  { id: 'F04', master: 'assets/masters/frige/frige-emblem.png' },
  { id: 'S04', master: 'assets/masters/seaxneat/seaxneat-emblem.png' },
  { id: 'E04', master: 'assets/masters/eostre/eostre-emblem.png' },
  { id: 'W04', master: 'assets/masters/woden/woden-emblem.png' },
];
const emblemOutput = 'apps/pantheon/public/media/studios';
const emblemBudget = 60_000;

// Applications serve brand media from their own origin and never read each
// other's files, so other applications get byte-identical copies, recorded with
// `copyOf` (verify-assets.mjs fails if a copy drifts). Prefix -> copy folder.
const copies = {
  'apps/pantheon/public/media/masthead/': 'apps/frige/public/media/masthead/',
  'apps/pantheon/public/media/studios/frige-': 'apps/frige/public/media/studios/frige-',
};

function run(command, args) {
  const result = spawnSync(command, args, { cwd: repositoryRoot, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (result.error?.code === 'ENOENT') throw new Error(`${command} is not on PATH; install FFmpeg to rebuild media.`);
  if (result.status !== 0) throw new Error(`${command} failed:\n${result.stderr}`);
  return result.stdout.trim();
}

const probe = (file, entries) => run('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', `stream=${entries}`, '-of', 'json', file]);
const dimensions = (file) => { const [stream] = JSON.parse(probe(file, 'width,height')).streams; return { width: stream.width, height: stream.height }; };
// RFC 6381 codec string for a <source type>, from the encoded profile and level.
// Pages must use exactly this value (apps/pantheon tests compare them).
function codecs(file) {
  const [stream] = JSON.parse(probe(file, 'codec_name,profile,level,pix_fmt')).streams;
  if (stream.codec_name === 'av1') return `av01.0.${String(stream.level).padStart(2, '0')}M.${stream.pix_fmt.includes('10') ? '10' : '08'}`;
  if (stream.codec_name === 'h264' && stream.profile === 'High') return `avc1.6400${stream.level.toString(16).toUpperCase().padStart(2, '0')}`;
  return null;
}
const stem = (master) => path.posix.basename(master).replace(/\.[^.]+$/, '');
const bitexact = ['-map_metadata', '-1', '-fflags', '+bitexact'];

// Neither source loops cleanly. Drop the first F frames, then blend the last F
// frames toward source frames 0..F-1, reaching 100% on the final frame. The
// output ends on source frame F-1 and starts on frame F: the wrap is one
// natural source step.
function buildLoop(master, temporary) {
  const total = Number(JSON.parse(probe(master, 'nb_read_frames')).streams[0].nb_read_frames);
  const weight = `min(1,(N+1)/${fadeFrames})`;
  const graph = [
    `[0]split=3[a][b][c]`,
    `[a]trim=start_frame=${fadeFrames}:end_frame=${total - fadeFrames},setpts=PTS-STARTPTS[body]`,
    `[b]trim=start_frame=${total - fadeFrames}:end_frame=${total},setpts=PTS-STARTPTS[tail]`,
    `[c]trim=end_frame=${fadeFrames},setpts=PTS-STARTPTS[head]`,
    `[tail][head]blend=all_expr='A*(1-${weight})+B*${weight}'[mix]`,
    `[body][mix]concat=n=2:v=1[out]`,
  ].join(';');
  const loop = path.join(temporary, `${stem(master)}.mkv`);
  run('ffmpeg', ['-v', 'error', '-y', '-i', master, '-filter_complex', graph, '-map', '[out]', '-c:v', 'ffv1', loop]);
  return { loop, frames: total - fadeFrames };
}

// AV1: 10-bit avoids banding in sun halos; the temporal filter is off because
// it smooths away the engraved hatching (the identity of the artwork).
const encoders = {
  webm: (frames, quality) => ['-c:v', 'libsvtav1', '-crf', String(quality.av1), '-preset', '4', '-g', String(frames), '-pix_fmt', 'yuv420p10le', '-svtav1-params', 'tune=0:enable-tf=0'],
  mp4: (frames, quality) => ['-c:v', 'libx264', '-crf', String(quality.h264), '-preset', 'slow', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'],
};

async function buildLoopJob(name, job, temporary) {
  await mkdir(path.join(repositoryRoot, job.output), { recursive: true });
  const outputs = { [job.loop.id]: [], [job.still.id]: [] };
  const { loop, frames } = buildLoop(job.loop.master, temporary);
  const filter = (width) => [job.crop(width), `scale=${width}:-2:flags=lanczos`].filter(Boolean).join(',');
  const record = (target, budget, width) => ({ target, budget, recipe: `scripts/assets/build-media.mjs ${name}`, ...(job.crop(width) ? { crop: job.crop(width).replace('crop=', '') } : {}) });
  for (const width of widths) {
    for (const container of ['webm', 'mp4']) {
      const target = `${job.output}/${stem(job.loop.master)}-${width}w.${container}`;
      run('ffmpeg', ['-v', 'error', '-y', '-i', loop, '-vf', filter(width), ...encoders[container](frames, job.quality), '-an', ...bitexact, '-flags:v', '+bitexact', target]);
      outputs[job.loop.id].push(record(target, job.budgets[container][width], width));
    }
    const still = `${job.output}/${stem(job.still.master)}-${width}w.webp`;
    run('ffmpeg', ['-v', 'error', '-y', '-i', job.still.master, '-vf', filter(width), '-c:v', 'libwebp', '-quality', String(job.quality.webp), ...bitexact, still]);
    outputs[job.still.id].push(record(still, job.budgets.webp[width], width));
  }
  return outputs;
}

async function buildEmblems() {
  await mkdir(path.join(repositoryRoot, emblemOutput), { recursive: true });
  const outputs = {};
  for (const { id, master } of emblems) {
    const { width } = dimensions(master);
    outputs[id] = [];
    for (const scale of [1, 2]) {
      const target = `${emblemOutput}/${stem(master)}-${width * scale}w.webp`;
      run('ffmpeg', ['-v', 'error', '-y', '-i', master, '-vf', `scale=${width * scale}:-1:flags=lanczos`, '-c:v', 'libwebp', '-quality', '90', '-pix_fmt', 'yuva420p', ...bitexact, target]);
      outputs[id].push({ target, budget: emblemBudget, recipe: 'scripts/assets/build-media.mjs emblems' });
    }
  }
  return outputs;
}

async function main() {
  const requested = process.argv.slice(2);
  const jobs = requested.length ? requested : [...Object.keys(loops), 'emblems'];
  for (const job of jobs) if (!loops[job] && job !== 'emblems') throw new Error(`Unknown job "${job}". Use: ${[...Object.keys(loops), 'emblems'].join(', ')}.`);

  const outputs = {};
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'stex-media-'));
  try {
    for (const job of jobs) Object.assign(outputs, job === 'emblems' ? await buildEmblems() : await buildLoopJob(job, loops[job], temporary));
  } finally { await rm(temporary, { recursive: true, force: true }); }

  const manifest = await readManifest();
  let overBudget = false;
  for (const [id, files] of Object.entries(outputs)) {
    const asset = manifest.assets.find((entry) => entry.id === id);
    if (!asset) throw new Error(`Manifest has no ${id} record.`);
    asset.derivatives = [];
    for (const { target, budget, recipe, crop } of files) {
      const codec = /\.(webm|mp4)$/.test(target) ? codecs(target) : null;
      const record = { path: target, ...(await fileRecord(target)), ...dimensions(target), budgetBytes: budget, recipe, ...(crop ? { crop } : {}), ...(codec ? { codecs: codec } : {}) };
      asset.derivatives.push(record);
      if (record.bytes > budget) overBudget = true;
      console.log(`${record.bytes > budget ? 'OVER' : 'ok  '}  ${String(record.bytes).padStart(9)} / ${String(budget).padStart(9)}  ${target}`);
    }
    for (const record of [...asset.derivatives]) {
      const prefix = Object.keys(copies).find((key) => record.path.startsWith(key));
      if (!prefix) continue;
      const copy = `${copies[prefix]}${record.path.slice(prefix.length)}`;
      await mkdir(path.dirname(path.join(repositoryRoot, copy)), { recursive: true });
      await copyFile(path.join(repositoryRoot, record.path), path.join(repositoryRoot, copy));
      asset.derivatives.push({ ...record, path: copy, recipe: `Byte-identical copy of ${record.path} (${record.recipe}), served from the application's own origin`, copyOf: record.path });
      console.log(`copy  ${copy}`);
    }
  }
  await writeManifest(manifest);
  if (overBudget) { console.error('A derivative is over its byte budget.'); process.exit(1); }
}

await main();
