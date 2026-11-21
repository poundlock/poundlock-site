// 把渲染出来的母版画面（PNG，正式的是 3840×2880）压成页面用的几档画面，写进 src/assets/film/，并写清单 manifest.json。
//   node tools/film/encode.mjs --from .shots/film/master4k [--stride 8] [--tiers mid,phone] [--webp-quality 72]
//
// 母版的帧号就是取帧表（src/scripts/film-schedule.js）里的帧号。--stride 8 是「每隔八帧取一帧」：
// 整段还没渲完（渲染是先稀后密的）或者只想先看个大概时用，压出来的是一段完整、只是稀一些的影片。
//
// 压出来两类东西：
//   视频（主路）  H.264，几档各一个目录。关键帧每 8 帧一个，不用 B 帧，每一帧都能单独定位：
//                 一档分成若干段，每段两个文件——k00.bin 是这一段的关键帧，p00.bin 是其余的帧——外加 index.json 记每一帧多大。
//                 页面先下所有段的关键帧（够拖着看个大概），再补其余的；用 WebCodecs 让显卡解码。
//       uhd    3840×2160  从母版中间裁成 16:9，不缩——给 4K 的宽屏
//       wide   2880×2160  整幅母版缩小——给一般的大屏、比 16:9 高的窗口
//       mid    1920×1440  整幅母版缩小——给小一些的屏
//       phone  1344×1680  以船为中心裁成 4:5 再缩小——给手机（窄屏版式里画面只占上面一截）
//   图片（后备）  WebP，浏览器走不了视频那一路时用：wide 1920×1440 每隔 3 帧一张，tall（手机）864×1080 每隔 6 帧一张。
// 要用 ffmpeg（带 libx264、libwebp）和 ffprobe。
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, linkSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { filmSchedule, subsample } from '../../src/scripts/film-schedule.js';
import { accessUnits, avcDescription, codecString, parameterSets, splitAnnexB, toAvcc } from './pack.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const value = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : fallback;
};

const GOP = 8; // 每隔几帧一个关键帧
const SEGMENT_GOPS = 12; // 一段几组（96 帧上下，差不多是过一室）
const MAX_FILE = 100e6; // GitHub 单个文件的上限
// 船在母版画面宽度上的位置：镜头的画幅只留了原画面的左边 82%（tools/film/lockfilm/world.py 的 FRAME_KEEP），改那里要一起改。
const FOCUS_X = 0.5 / 0.82;
const REFERENCE_WIDTH = 3840; // 各档的尺寸是照这么宽的母版写的；母版小（预演的小图）就按比例缩

const from = path.resolve(value('--from', '.shots/film/master4k'));
const stride = Number(value('--stride', '1'));
const wanted = value('--tiers', '');
const webpQuality = Number(value('--webp-quality', '72'));
const out = path.resolve(value('--out', path.join(ROOT, 'src', 'assets', 'film')));

const run = (program, argv, what) => {
  const result = spawnSync(program, argv, { stdio: ['ignore', 'inherit', 'inherit'] });
  if (result.status !== 0) throw new Error(`${what}时出错了（${program} 退出码 ${result.status}）`);
};
const even = (n) => Math.max(2, Math.round(n / 2) * 2);
const mb = (bytes) => (bytes / 1e6).toFixed(1);
const round = (n) => Math.round(n * 1e4) / 1e4;

// ---- 这次用哪些帧 ----
const table = filmSchedule();
const picked = subsample(table.length, stride);
const frameFile = (index) => path.join(from, `f${String(index).padStart(4, '0')}.png`);
const missing = picked.filter((index) => !existsSync(frameFile(index)));
if (missing.length) {
  throw new Error(`${from} 里缺 ${missing.length} 帧（头一个是 f${String(missing[0]).padStart(4, '0')}.png）。还没渲完的话加 --stride 8 之类先压稀的`);
}
const progress = picked.map((index) => table[index]);
const count = picked.length;

// 帧号不连续（--stride）的时候 ffmpeg 没法按序号读：在旁边建一个连号的目录，硬链接过去（不占地方）。
const sequence = path.join(path.dirname(from), `.encode-seq-${process.pid}`);
rmSync(sequence, { recursive: true, force: true });
mkdirSync(sequence, { recursive: true });
picked.forEach((index, j) => {
  const target = path.join(sequence, `s${String(j).padStart(5, '0')}.png`);
  try {
    linkSync(frameFile(index), target);
  } catch {
    copyFileSync(frameFile(index), target);
  }
});
const input = ['-start_number', '0', '-framerate', '30', '-i', path.join(sequence, 's%05d.png')];

try {
  const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', frameFile(picked[0])], { encoding: 'utf8' });
  const [masterW, masterH] = probe.stdout.trim().split(',').map(Number);
  if (!masterW || !masterH) throw new Error('读不出母版的尺寸');
  const k = masterW / REFERENCE_WIDTH;
  console.log(`母版 ${masterW}×${masterH}，这次压 ${count} 帧（取帧表一共 ${table.length} 帧${stride > 1 ? `，每隔 ${stride} 帧取一帧` : ''}）`);

  // 颜色：母版是 sRGB 的图，压成 BT.709 的 YUV，并在码流里写明（传递函数标 sRGB），浏览器解出来才和原图一个样。
  const COLOR = 'out_color_matrix=bt709:out_range=tv';
  const TAGS = ['-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'iec61966-2-1', '-color_range', 'tv'];
  const uhdH = even((masterW * 9) / 16);
  const phoneCropW = even(masterH * 0.8);
  const phoneCropX = Math.min(masterW - phoneCropW, Math.max(0, even(FOCUS_X * masterW - phoneCropW / 2)));
  const phoneCrop = `crop=${phoneCropW}:${masterH}:${phoneCropX}:0`;
  const resize = (width, height) => `scale=${width}:${height}:flags=lanczos`;
  // geometry：从母版到这一档的画面，只管裁和缩（还是 RGB）。
  const TIERS = [
    { name: 'uhd', width: masterW, height: uhdH, geometry: `crop=${masterW}:${uhdH}:0:${even((masterH - uhdH) / 2)}`, focus: [FOCUS_X, 0.5], crf: 23 },
    { name: 'wide', width: even(2880 * k), height: even(2160 * k), geometry: resize(even(2880 * k), even(2160 * k)), focus: [FOCUS_X, 0.5], crf: 22 },
    { name: 'mid', width: even(1920 * k), height: even(1440 * k), geometry: resize(even(1920 * k), even(1440 * k)), focus: [FOCUS_X, 0.5], crf: 22 },
    { name: 'phone', width: even(1344 * k), height: even(1680 * k), geometry: `${phoneCrop},${resize(even(1344 * k), even(1680 * k))}`, focus: [0.5, 0.5], crf: 24 },
  ].filter((tier) => !wanted || wanted.split(',').includes(tier.name));
  const SETS = [
    { name: 'wide', width: even(1920 * k), height: even(1440 * k), step: 3, focus: [FOCUS_X, 0.5] },
    { name: 'tall', width: even(864 * k), height: even(1080 * k), pre: `${phoneCrop},`, step: 6, focus: [0.5, 0.5] },
  ];

  if (!wanted) rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const manifest = { version: 2, frames: count, gop: GOP, progress, tiers: {}, sets: {} };

  // ---- 视频 ----
  for (const tier of TIERS) {
    const dir = path.join(out, tier.name);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const raw = path.join(sequence, `${tier.name}.h264`);
    const filter = `${tier.geometry},scale=${COLOR},format=yuv420p`;
    run(
      'ffmpeg',
      ['-y', '-loglevel', 'error', ...input, '-vf', filter, '-c:v', 'libx264', '-preset', 'slow', '-profile:v', 'high', '-crf', String(tier.crf), '-g', String(GOP), '-keyint_min', String(GOP), '-sc_threshold', '0', '-bf', '0', '-x264-params', 'aud=1', ...TAGS, '-f', 'h264', raw],
      `压 ${tier.name} 这一档`,
    );
    const units = accessUnits(splitAnnexB(new Uint8Array(readFileSync(raw))));
    if (units.length !== count) throw new Error(`${tier.name}：应当有 ${count} 帧，压出来 ${units.length} 帧`);
    units.forEach((unit, i) => {
      if (unit.key !== (i % GOP === 0)) throw new Error(`${tier.name}：第 ${i} 帧${unit.key ? '不该是' : '应当是'}关键帧`);
    });
    const { sps, pps } = parameterSets(units[0].nals);
    const frames = units.map((unit) => toAvcc(unit.nals));
    const segments = [];
    let bytes = 0;
    for (let first = 0, n = 0; first < count; first += GOP * SEGMENT_GOPS, n++) {
      const slice = frames.slice(first, first + GOP * SEGMENT_GOPS);
      const tag = String(n).padStart(2, '0');
      const keys = slice.filter((_, i) => i % GOP === 0);
      const rest = slice.filter((_, i) => i % GOP !== 0);
      const write = (name, list) => {
        const data = Buffer.concat(list);
        if (data.length > MAX_FILE) throw new Error(`${tier.name}/${name} 有 ${mb(data.length)} MB，超过单个文件的上限：把一段分小些`);
        writeFileSync(path.join(dir, name), data);
        bytes += data.length;
      };
      write(`k${tag}.bin`, keys);
      write(`p${tag}.bin`, rest);
      segments.push({ first, count: slice.length, key: `k${tag}.bin`, rest: `p${tag}.bin`, keySizes: keys.map((f) => f.length), restSizes: rest.map((f) => f.length) });
    }
    // 每个关键帧缩成 4×4 的颜色（每格 RGB 三个数）：页面解出头一帧以后拿它核一下，挡的是解出来发绿、全黑、花屏。
    const probeFile = path.join(sequence, `${tier.name}.probe`);
    run(
      'ffmpeg',
      ['-y', '-loglevel', 'error', ...input, '-vf', `select='not(mod(n\\,${GOP}))',${tier.geometry},scale=4:4:flags=area`, '-fps_mode', 'vfr', '-f', 'rawvideo', '-pix_fmt', 'rgb24', probeFile],
      `给 ${tier.name} 这一档记关键帧的颜色`,
    );
    const probes = readFileSync(probeFile);
    if (probes.length !== Math.ceil(count / GOP) * 48) throw new Error(`${tier.name}：关键帧的颜色应当有 ${Math.ceil(count / GOP) * 48} 个数，出来 ${probes.length} 个`);
    const index = {
      codec: codecString(sps),
      width: tier.width,
      height: tier.height,
      gop: GOP,
      count,
      description: Buffer.from(avcDescription(sps, pps)).toString('base64'),
      probes: probes.toString('base64'),
      segments,
    };
    writeFileSync(path.join(dir, 'index.json'), JSON.stringify(index) + '\n');
    const keyBytes = segments.reduce((sum, s) => sum + s.keySizes.reduce((a, b) => a + b, 0), 0);
    manifest.tiers[tier.name] = { dir: tier.name, width: tier.width, height: tier.height, focus: tier.focus.map(round), codec: index.codec, bytes, keyBytes };
    console.log(`${tier.name}：${tier.width}×${tier.height}，${segments.length} 段，共 ${mb(bytes)} MB（关键帧 ${mb(keyBytes)} MB），平均一帧 ${(bytes / count / 1e3).toFixed(0)} KB，${index.codec}`);
  }

  // ---- 后备的图片 ----
  if (!wanted) {
    for (const set of SETS) {
      const dir = path.join(out, set.name);
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      const kept = subsample(count, set.step);
      const select = `select='not(mod(n\\,${set.step}))+eq(n\\,${count - 1})'`;
      run(
        'ffmpeg',
        ['-y', '-loglevel', 'error', ...input, '-vf', `${select},${set.pre ?? ''}scale=${set.width}:${set.height}:flags=lanczos`, '-fps_mode', 'vfr', '-c:v', 'libwebp', '-quality', String(webpQuality), '-compression_level', '6', '-start_number', '0', path.join(dir, 'f%04d.webp')],
        `压 ${set.name} 这一套图片`,
      );
      const files = readdirSync(dir).sort();
      if (files.length !== kept.length) throw new Error(`${set.name}：应当有 ${kept.length} 张，出来 ${files.length} 张`);
      const bytes = files.reduce((sum, name) => sum + statSync(path.join(dir, name)).size, 0);
      manifest.sets[set.name] = { dir: set.name, ext: 'webp', step: set.step, count: files.length, width: set.width, height: set.height, focus: set.focus.map(round), bytes };
      console.log(`${set.name}（图片）：${set.width}×${set.height}，${files.length} 张，共 ${mb(bytes)} MB`);
    }
    writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest) + '\n');
    console.log(`清单写在 ${path.join(out, 'manifest.json')}`);
  } else {
    console.log('只压了指定的几档，清单没有动');
  }
} finally {
  rmSync(sequence, { recursive: true, force: true });
}
