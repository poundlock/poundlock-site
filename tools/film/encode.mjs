// 把渲染出来的母版画面（PNG，1920×1440）压成页面用的两套 WebP，写进 src/assets/film/，并写清单 manifest.json。
//   node tools/film/encode.mjs --from .shots/film/master [--quality 72]
//
// 母版是 4:3 的，一次渲染裁出两套：
//   wide  横版，取中间的 1920×1080，每一帧都要——给横着的视口
//   tall  竖版，取中间的 1080×1440 再缩到 864×1152，隔一帧取一帧——给手机，省一半流量
// 要用 ffmpeg（带 libwebp）。
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const value = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : fallback;
};

const from = path.resolve(value('--from', '.shots/film/master'));
const quality = Number(value('--quality', '72'));
const out = path.join(ROOT, 'src', 'assets', 'film');

const frames = readdirSync(from).filter((name) => /^f\d{4}\.png$/.test(name)).sort();
if (!frames.length) throw new Error(`${from} 里没有 f0000.png 这样的画面`);
frames.forEach((name, i) => {
  if (name !== `f${String(i).padStart(4, '0')}.png`) throw new Error(`画面不连续：第 ${i} 个是 ${name}`);
});

// 母版多大（正式的是 1920×1440；预演的小图也能压，用来先把页面接通）。
const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path.join(from, frames[0])], { encoding: 'utf8' });
const [masterW, masterH] = probe.stdout.trim().split(',').map(Number);
if (!masterW || !masterH) throw new Error('读不出母版的尺寸');
const even = (n) => Math.round(n / 2) * 2;
const wideH = even((masterW * 9) / 16);
const tallW = even((masterH * 3) / 4);
const tallScale = Math.min(1, 864 / tallW);
const SETS = [
  { name: 'wide', filter: `crop=${masterW}:${wideH}:0:${even((masterH - wideH) / 2)}`, width: masterW, height: wideH, step: 1 },
  {
    name: 'tall',
    filter: `crop=${tallW}:${masterH}:${even((masterW - tallW) / 2)}:0,scale=${even(tallW * tallScale)}:${even(masterH * tallScale)}:flags=lanczos`,
    width: even(tallW * tallScale),
    height: even(masterH * tallScale),
    step: 2,
  },
];

const manifest = { sets: {} };
for (const set of SETS) {
  const dir = path.join(out, set.name);
  if (existsSync(dir)) rmSync(dir, { recursive: true });
  mkdirSync(dir, { recursive: true });
  const pick = set.step > 1 ? `select='not(mod(n\\,${set.step}))',` : '';
  const run = spawnSync(
    'ffmpeg',
    ['-y', '-loglevel', 'error', '-start_number', '0', '-i', path.join(from, 'f%04d.png'), '-vf', `${pick}${set.filter}`, '-fps_mode', 'vfr', '-c:v', 'libwebp', '-quality', String(quality), '-compression_level', '6', '-start_number', '0', path.join(dir, 'f%04d.webp')],
    { stdio: 'inherit' },
  );
  if (run.status !== 0) throw new Error(`ffmpeg 压 ${set.name} 这一套时出错了`);
  const files = readdirSync(dir).sort();
  const expected = Math.ceil(frames.length / set.step);
  if (files.length !== expected) throw new Error(`${set.name}：应当有 ${expected} 帧，出来 ${files.length} 帧`);
  const bytes = files.reduce((sum, name) => sum + statSync(path.join(dir, name)).size, 0);
  manifest.sets[set.name] = { dir: set.name, ext: 'webp', count: files.length, width: set.width, height: set.height };
  console.log(`${set.name}：${files.length} 帧，共 ${(bytes / 1e6).toFixed(1)} MB，平均一帧 ${(bytes / files.length / 1e3).toFixed(0)} KB`);
}
writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`清单写在 ${path.join(out, 'manifest.json')}`);
