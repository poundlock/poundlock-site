// 过闸的影片，主路：H.264，用浏览器的 VideoDecoder（WebCodecs）让显卡解码，解出来的帧画到画布上，滚到哪画哪一帧。
// 影片是 tools/film/encode.mjs 压的：按屏幕分几档，每档按段切开，一段两个文件——关键帧一份、其余帧一份——外加一份索引，
// 所以每一帧都能单独定位。先下的是关键帧（每 8 帧一个，够拖着看个大概），其余的滚进来以后补齐。
// 走不了这一路（没有 VideoDecoder、这一档解不了、解出来的画面不对、迟迟不出画面）就调 onFail，由 lock.js 换成图片那一路。
// pickTier、prepareIndex、locate、planDecode、pickEvictions、downloadOrder、probeMatches 是纯函数，Node 里能直接测。

import { frameAtTable } from './film-schedule.js';
import { DAY_AT, coverRect } from './lock-film.js';

const ORDER = ['mid', 'wide', 'uhd']; // 从小到大；手机那一档单算
const ENOUGH = 1.05; // 铺满画布时放大不超过这么多，就算这一档够用

// 挑哪一档：铺满画布时不用放大的最小一档；都不够就用放大得最少的。手机只用手机那一档。cap：最大只到这一档。
export function pickTier(tiers, canvasW, canvasH, { phone = false, anchor = [0.5, 0.5], cap = null } = {}) {
  if (!tiers) return null;
  if (phone && tiers.phone) return 'phone';
  const limit = cap && ORDER.includes(cap) ? ORDER.indexOf(cap) : ORDER.length - 1;
  const names = ORDER.filter((name, i) => tiers[name] && i <= limit);
  if (!names.length) return Object.keys(tiers)[0] ?? null;
  let best = null;
  let least = Infinity;
  for (const name of names) {
    const tier = tiers[name];
    const focus = Array.isArray(tier.focus) ? tier.focus : [0.5, 0.5];
    const scale = coverRect(tier.width, tier.height, canvasW, canvasH, anchor[0], anchor[1], focus[0], focus[1]).w / tier.width;
    if (scale <= ENOUGH) return name;
    if (scale < least) {
      least = scale;
      best = name;
    }
  }
  return best;
}

// 给索引里每一段算好每一帧在文件里从哪开始（前缀和）。
export function prepareIndex(index) {
  const starts = (sizes) => {
    const out = [0];
    for (const size of sizes) out.push(out[out.length - 1] + size);
    return out;
  };
  return { ...index, segments: index.segments.map((segment) => ({ ...segment, keyStarts: starts(segment.keySizes), restStarts: starts(segment.restSizes) })) };
}

// 第 frame 帧在哪一段、是不是关键帧、在那个文件里从哪到哪。
export function locate(index, frame) {
  if (!(frame >= 0 && frame < index.count)) return null;
  const span = index.segments[0].count;
  const at = Math.min(index.segments.length - 1, Math.floor(frame / span));
  const segment = index.segments[at];
  const j = frame - segment.first;
  if (j % index.gop === 0) {
    const k = j / index.gop;
    return { segment: at, key: true, offset: segment.keyStarts[k], size: segment.keySizes[k] };
  }
  const r = j - Math.floor(j / index.gop) - 1;
  return { segment: at, key: false, offset: segment.restStarts[r], size: segment.restSizes[r] };
}

// 下一步解哪一组（返回那一组关键帧的帧号；没有要解的返回 null）。
// 一组是从关键帧起的 gop 帧，要整组从头解。先解要画的那一帧所在的组，再按滚动的方向备前面的、身后的。
// size(g)：这一组现在能解几帧（数据到了几帧）；have(g)：已经解好放着的有几帧；budget：缓存一共放得下几帧。
export function planDecode({ target, direction, gop, count, budget, size, have }) {
  const here = Math.floor(target / gop) * gop;
  const forward = direction >= 0 ? 1 : -1;
  let room = budget;
  for (const step of [0, forward, -forward, 2 * forward, -2 * forward, 3 * forward]) {
    const g = here + step * gop;
    if (g < 0 || g >= count) continue;
    const frames = size(g);
    if (frames <= 0) continue;
    room -= frames;
    if (room < 0) break;
    if (have(g) < frames) return g;
  }
  return null;
}

// 缓存超了丢哪些帧：整组整组地丢（丢一半的组回头还得整组重解），离要画的那一组最远的先丢，身后的比前面的先丢。要画的那一组不丢。
export function pickEvictions(cached, { target, direction, gop, budget }) {
  if (cached.length <= budget) return [];
  const here = Math.floor(target / gop) * gop;
  const forward = direction >= 0 ? 1 : -1;
  const groups = new Map();
  for (const frame of cached) {
    const g = Math.floor(frame / gop) * gop;
    if (g === here) continue;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(frame);
  }
  const score = (g) => (Math.abs(g - here) / gop) * ((g - here) * forward < 0 ? 1.5 : 1);
  const order = [...groups.keys()].sort((a, b) => score(b) - score(a));
  const drop = [];
  let left = cached.length;
  for (const g of order) {
    if (left <= budget) break;
    drop.push(...groups.get(g));
    left -= groups.get(g).length;
  }
  return drop.sort((a, b) => a - b);
}

// 各段的文件按什么先后下：访客所在的那一段（关键帧、其余帧）、滚动方向上的下一段，然后别的段的关键帧由近到远，最后别的段的其余帧。
export function downloadOrder(segments, current, direction) {
  const forward = direction >= 0 ? 1 : -1;
  const near = [current, current + forward].filter((s) => s >= 0 && s < segments);
  const others = [];
  for (let s = 0; s < segments; s++) if (!near.includes(s)) others.push(s);
  others.sort((a, b) => Math.abs(a - current) - Math.abs(b - current) || (b - a) * forward);
  const both = (s) => [{ segment: s, kind: 'key' }, { segment: s, kind: 'rest' }];
  return [...near.flatMap(both), ...others.map((s) => ({ segment: s, kind: 'key' })), ...others.map((s) => ({ segment: s, kind: 'rest' }))];
}

// 解出来的头一帧，缩成 4×4 以后的颜色，和压片时记下的差得不多才算解对了（挡的是整个发绿、全黑、花屏这种）。
export function probeMatches(expected, actual, tolerance = 28) {
  if (!expected) return true;
  if (!actual || actual.length !== expected.length) return false;
  let total = 0;
  for (let i = 0; i < expected.length; i++) total += Math.abs(expected[i] - actual[i]);
  return total / expected.length <= tolerance;
}

// 各档缓存几帧解好的画面。一帧 2880×2160 的画面约 25 MB、3840×2160 约 33 MB，都在显存里：
// 缓存两组（16 帧）左右，大屏那两档占四百 MB 上下，普通电脑也放得下。往回滚到缓存外，现解一组只要二三十毫秒。
const BUDGET = { uhd: 12, wide: 16, mid: 24, phone: 24 };
const PARALLEL = 2; // 同时下几个文件
const PATIENCE = 15000; // 开了一档这么久还没画出头一帧（索引没到、数据没到、解不出来），就算这一路走不通
const SLOW_GROUP = 450; // 解一组花了这么多毫秒算慢
const PHONE_MAX = 600;

const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

// film = { base, frames, gop, progress[], tiers: { uhd: { dir, width, height, focus }, … } }
// 返回 { kind: 'video', frame(progress, now, snap), fill(), destroy() }；这一路肯定走不了返回 null。
export function mountVideo(root, canvas, film, { onFail } = {}) {
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  const supported = typeof win.VideoDecoder === 'function' && typeof win.EncodedVideoChunk === 'function' && typeof win.createImageBitmap === 'function';
  if (!supported || !film || !film.tiers || !Object.keys(film.tiers).length || !Array.isArray(film.progress)) return null;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return null;

  const table = film.progress;
  let session = null; // 现在用的这一档的全部状态；换档就整个换掉
  let cap = null;
  let anchor = { x: 0.5, y: 0.5 };
  let wanted = 0;
  let direction = 1;
  let drawn = -1;
  let shown = null;
  let last = null;
  let filled = false;
  let dead = false;
  let booting = true; // 还在 mountVideo 里面：这时候不行就直接返回 null，不调 onFail（调用方还没拿到返回值）

  const fail = () => {
    if (dead) return;
    dead = true;
    close(session);
    if (!booting && onFail) onFail();
  };

  const close = (s) => {
    if (!s || s.dead) return;
    s.dead = true;
    s.abort.abort();
    win.clearTimeout(s.watchdog);
    try {
      if (s.decoder && s.decoder.state !== 'closed') s.decoder.close();
    } catch {
      // 已经关了。
    }
    for (const bitmap of s.cache.values()) bitmap.close();
    s.cache.clear();
  };

  // ---- 数据 ----
  const frameData = (s, frame) => {
    const where = locate(s.index, frame);
    if (!where) return null;
    const data = s.data[where.segment];
    const whole = where.key ? data.key : data.rest;
    if (whole) return whole.subarray(where.offset, where.offset + where.size);
    return s.singles.get(frame) ?? null;
  };
  // 这一组现在能解几帧：从关键帧起连着的、数据到了的。
  const groupSize = (s, g) => {
    let n = 0;
    while (n < s.index.gop && g + n < s.index.count && frameData(s, g + n)) n++;
    return n;
  };
  const groupHave = (s, g) => {
    let n = 0;
    for (let i = g; i < g + s.index.gop; i++) if (s.cache.has(i)) n++;
    return n;
  };
  const segmentOf = (s, frame) => locate(s.index, Math.min(s.index.count - 1, Math.max(0, frame))).segment;

  const fetchBytes = async (s, url, range) => {
    const response = await win.fetch(url, { signal: s.abort.signal, headers: range ? { Range: `bytes=${range[0]}-${range[0] + range[1] - 1}` } : undefined });
    if (!response.ok) throw new Error(`${url} ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    // 服务器不认 Range、把整个文件给回来了：自己切。
    return range && response.status !== 206 ? bytes.subarray(range[0], range[0] + range[1]) : bytes;
  };

  const pump = (s) => {
    if (s.dead || !filled || s.allStarted) return;
    while (s.active < PARALLEL) {
      const next = downloadOrder(s.index.segments.length, segmentOf(s, wanted), direction).find((item) => !s.started.has(`${item.kind}${item.segment}`));
      if (!next) {
        s.allStarted = true;
        return;
      }
      s.started.add(`${next.kind}${next.segment}`);
      s.active++;
      const segment = s.index.segments[next.segment];
      fetchBytes(s, `${s.base}${next.kind === 'key' ? segment.key : segment.rest}`)
        .then((bytes) => {
          if (s.dead) return;
          s.data[next.segment][next.kind] = bytes;
          s.active--;
          schedule(s);
          pump(s);
        })
        .catch(() => {
          if (s.dead) return;
          s.active--;
          s.failures++;
          // 下不来的文件过一会儿再试；一直下不来、手里又一帧都没有，这一路就不走了。
          if (s.failures >= 4 && !s.ready) fail();
          else win.setTimeout(() => {
            s.started.delete(`${next.kind}${next.segment}`);
            s.allStarted = false;
            pump(s);
          }, 1500);
        });
    }
  };

  // 还没开始整段下的时候（访客还没滚进来、或者刚挂上），只取要画的那一帧附近的那个关键帧。
  const poster = (s) => {
    const g = Math.floor(wanted / s.index.gop) * s.index.gop;
    if (s.dead || s.singles.has(g) || frameData(s, g) || s.posting === g) return;
    const where = locate(s.index, g);
    s.posting = g;
    fetchBytes(s, `${s.base}${s.index.segments[where.segment].key}`, [where.offset, where.size])
      .then((bytes) => {
        if (s.dead) return;
        s.singles.set(g, bytes);
        s.posting = -1;
        schedule(s);
      })
      .catch(() => {
        if (s.dead) return;
        s.posting = -1;
        s.failures++;
        if (s.failures >= 4 && !s.ready) fail();
      });
  };

  // ---- 解码 ----
  const paint = (s, force) => {
    if (s.dead || !s.cache.size) return;
    let best = -1;
    for (const frame of s.cache.keys()) if (best < 0 || Math.abs(frame - wanted) < Math.abs(best - wanted)) best = frame;
    if (best < 0 || (best === drawn && !force)) return;
    const focus = s.focus;
    const rect = coverRect(s.tier.width, s.tier.height, canvas.width, canvas.height, anchor.x, anchor.y, focus[0], focus[1]);
    ctx.drawImage(s.cache.get(best), rect.x, rect.y, rect.w, rect.h);
    drawn = best;
    canvas.dataset.frame = String(best);
    if (!root.hasAttribute('data-lock-film-ready')) root.setAttribute('data-lock-film-ready', '');
  };

  // 解出来的头一帧核一下颜色：缩成 4×4，和压片时记下的比。
  const probeOk = (s, frame, bitmap) => {
    const probes = s.index.probes;
    if (!probes || frame % s.index.gop !== 0) return true;
    const at = (frame / s.index.gop) * 48;
    if (at + 48 > probes.length) return true;
    try {
      const small = doc.createElement('canvas');
      small.width = 64;
      small.height = 64;
      const c = small.getContext('2d', { willReadFrequently: true });
      c.imageSmoothingQuality = 'high';
      c.drawImage(bitmap, 0, 0, 64, 64);
      const pixels = c.getImageData(0, 0, 64, 64).data;
      const actual = [];
      for (let cy = 0; cy < 4; cy++) {
        for (let cx = 0; cx < 4; cx++) {
          const sum = [0, 0, 0];
          for (let y = cy * 16; y < cy * 16 + 16; y++) {
            for (let x = cx * 16; x < cx * 16 + 16; x++) {
              const p = (y * 64 + x) * 4;
              sum[0] += pixels[p];
              sum[1] += pixels[p + 1];
              sum[2] += pixels[p + 2];
            }
          }
          actual.push(sum[0] / 256, sum[1] / 256, sum[2] / 256);
        }
      }
      return probeMatches(Array.from(probes.subarray(at, at + 48)), actual);
    } catch {
      return true; // 读不了像素（极少见）：不拿这个否掉它
    }
  };

  const store = (s, frame, bitmap) => {
    if (s.dead) {
      bitmap.close();
      return;
    }
    if (!s.ready) {
      if (!probeOk(s, frame, bitmap)) {
        bitmap.close();
        fail();
        return;
      }
      s.ready = true;
      win.clearTimeout(s.watchdog);
    }
    const old = s.cache.get(frame);
    if (old) old.close();
    s.cache.set(frame, bitmap);
    for (const gone of pickEvictions([...s.cache.keys()], { target: wanted, direction, gop: s.index.gop, budget: s.budget })) {
      s.cache.get(gone).close();
      s.cache.delete(gone);
    }
    if (drawn < 0 || !s.cache.has(drawn) || Math.abs(frame - wanted) < Math.abs(drawn - wanted)) paint(s, false);
  };

  const decodeGroup = async (s, g) => {
    s.busy = true;
    const started = win.performance.now();
    const frames = [];
    for (let i = g; i < g + s.index.gop && i < s.index.count; i++) {
      const data = frameData(s, i);
      if (!data) break;
      frames.push([i, data]);
    }
    try {
      for (const [i, data] of frames) s.decoder.decode(new win.EncodedVideoChunk({ type: i === g ? 'key' : 'delta', timestamp: i * 1000, data }));
      await s.decoder.flush();
      await Promise.all(s.pending.splice(0));
    } catch {
      if (!s.dead) fail();
      return;
    }
    if (s.dead) return;
    // 一组解得太慢（没有硬解，或者这一档对这台机器太大）：连着几次就降一档。
    const took = win.performance.now() - started;
    s.slow = frames.length >= s.index.gop && took > SLOW_GROUP ? s.slow + 1 : 0;
    s.busy = false;
    if (s.slow >= 3 && s.name !== 'mid' && s.name !== 'phone') {
      cap = s.name === 'uhd' ? 'wide' : 'mid';
      layout();
      return;
    }
    schedule(s);
  };

  const schedule = (s) => {
    if (!s || s.dead || s.busy || !s.decoder) return;
    const g = planDecode({ target: wanted, direction, gop: s.index.gop, count: s.index.count, budget: s.budget, size: (at) => groupSize(s, at), have: (at) => groupHave(s, at) });
    if (g !== null) {
      decodeGroup(s, g);
    } else if (!filled) {
      poster(s);
    }
  };

  // ---- 开一档 ----
  const open = (name) => {
    const tier = film.tiers[name];
    const s = {
      name,
      tier,
      base: `${film.base}${tier.dir}/`,
      focus: Array.isArray(tier.focus) ? tier.focus : [0.5, 0.5],
      budget: BUDGET[name] ?? 24,
      index: null,
      data: [],
      singles: new Map(),
      started: new Set(),
      cache: new Map(),
      pending: [],
      decoder: null,
      abort: new win.AbortController(),
      active: 0,
      failures: 0,
      posting: -1,
      slow: 0,
      watchdog: 0,
      busy: false,
      ready: false,
      dead: false,
      allStarted: false,
    };
    s.watchdog = win.setTimeout(() => {
      if (!s.dead && !s.ready) fail();
    }, PATIENCE);
    (async () => {
      const response = await win.fetch(`${s.base}index.json`, { signal: s.abort.signal });
      if (!response.ok) throw new Error(`index ${response.status}`);
      const raw = await response.json();
      if (s.dead) return;
      if (raw.count !== table.length) throw new Error('索引的帧数和取帧表对不上');
      s.index = prepareIndex(raw);
      canvas.dataset.frames = String(raw.count);
      if (raw.probes) s.index.probes = fromBase64(raw.probes);
      s.data = s.index.segments.map(() => ({ key: null, rest: null }));
      const config = { codec: raw.codec, codedWidth: raw.width, codedHeight: raw.height, description: fromBase64(raw.description), optimizeForLatency: true };
      const support = await win.VideoDecoder.isConfigSupported(config);
      if (s.dead) return;
      if (!support || !support.supported) throw new Error('这一档解不了');
      s.decoder = new win.VideoDecoder({
        output: (frame) => {
          const index = Math.round(frame.timestamp / 1000);
          s.pending.push(
            win.createImageBitmap(frame).then(
              (bitmap) => {
                frame.close();
                store(s, index, bitmap);
              },
              () => frame.close(),
            ),
          );
        },
        error: () => {
          if (!s.dead) fail();
        },
      });
      s.decoder.configure(config);
      if (filled) pump(s);
      schedule(s);
    })().catch(() => {
      if (s.dead) return;
      // 这一档起不来：有更小的档就降下去试，没有就换图片那一路。
      const at = ORDER.indexOf(name);
      if (at > 0 && ORDER.slice(0, at).some((lower) => film.tiers[lower])) {
        cap = ORDER[at - 1];
        layout();
      } else {
        fail();
      }
    });
    return s;
  };

  // 量画布、读画面该摆在哪，照画布的大小挑一档；档变了就把原来那一档整个收掉。
  const layout = () => {
    if (dead) return;
    const ratio = Math.min(win.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const css = win.getComputedStyle(canvas);
    const read = (prop, fallback) => {
      const value = parseFloat(css.getPropertyValue(prop));
      return Number.isFinite(value) ? value : fallback;
    };
    anchor = { x: read('--film-x', 0.5), y: read('--film-y', 0.5) };
    const phone = win.innerWidth < win.innerHeight && win.innerWidth <= PHONE_MAX;
    // 不看浏览器报的网速来降档：那个数不准（这台开发机上实测每秒几十兆，它报的却不到 4）。网慢就是下得慢，先有关键帧可看。
    const name = pickTier(film.tiers, width, height, { phone, anchor: [anchor.x, anchor.y], cap });
    if (!name) {
      fail();
      return;
    }
    if (!session || session.name !== name) {
      close(session);
      drawn = -1;
      session = open(name);
      canvas.dataset.filmSet = name;
    }
    paint(session, true);
  };

  const onResize = () => layout();
  win.addEventListener('resize', onResize);
  canvas.dataset.filmKind = 'video';
  layout();
  booting = false;
  if (dead) {
    win.removeEventListener('resize', onResize);
    delete canvas.dataset.filmKind;
    return null;
  }

  return {
    kind: 'video',
    // snap：不带惯性，直接到位。
    frame(progress, now, snap = false) {
      if (dead || !session) return;
      const dt = last === null ? 0 : Math.min(0.1, (now - last) / 1000);
      last = now;
      const before = shown;
      shown = shown === null || snap ? progress : shown + (progress - shown) * (1 - Math.exp(-dt * 7));
      if (before !== null && shown !== before) direction = shown > before ? 1 : -1;
      wanted = frameAtTable(table, shown);
      canvas.dataset.want = String(wanted);
      if (session.index) {
        paint(session, false);
        schedule(session);
        if (filled) pump(session);
      }
      // 页头固定在最上面，压着这块画面：天亮以后画面顶上是亮的，它换成浅色段的样子。
      const day = shown >= DAY_AT;
      root.toggleAttribute('data-day', day);
      doc.documentElement.style.setProperty('--header-day', day ? '1' : '0');
    },
    fill() {
      if (dead || filled) return;
      filled = true;
      if (session && session.index) pump(session);
    },
    destroy() {
      dead = true;
      close(session);
      session = null;
      win.removeEventListener('resize', onResize);
      doc.documentElement.style.removeProperty('--header-day');
      root.removeAttribute('data-day');
      root.removeAttribute('data-lock-film-ready');
      delete canvas.dataset.frame;
      delete canvas.dataset.filmSet;
      delete canvas.dataset.filmKind;
      delete canvas.dataset.frames;
      delete canvas.dataset.want;
    },
  };
}
