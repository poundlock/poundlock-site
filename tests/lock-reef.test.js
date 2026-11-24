import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { momentumStep, MOMENTUM_RISE, MOMENTUM_FALL, REEF_FOLLOW, cameraX, presence, visibleTiles, aboveAt, effectsAt, waterAt, readReef, createFishBehavior, createLoadQueue, reefUrl, tierOf, HALF_MAX, stopXs, aheadTiles } from '../src/scripts/lock-reef.js';
import { FOLLOW, stopsOf } from '../src/scripts/lock.js';

const DT = 1 / 120;

// 和 tools/reef/journey.py 一样的排法：八段、每段 5 米、交界带半宽 1.2 米
const M = {
  viewH: 1.6,
  xStart: 1.6,
  xEnd: 38.4,
  sceneLen: 5,
  blend: 1.2,
  scenes: ['coral', 'seagrass', 'kelp', 'canyon', 'lock', 'jelly', 'river', 'shallow'].map((key, i) => ({ key, low: '#000000', high: i === 0 ? '#ffffff' : '#000000' })),
  layers: { mid: { scale: 1, tiles: 23, x0: -0.32, tileM: 1.8204 }, far: { scale: 0.4, tiles: 11, x0: -3.2, tileM: 4.551 } },
};

test('过闸的弹簧比别的画面软：停下时有惯性地滑停', () => {
  assert.ok(REEF_FOLLOW < FOLLOW);
});

test('momentumStep：滚动一来很快就起，停了以后慢慢泄，带方向', () => {
  assert.ok(MOMENTUM_RISE < MOMENTUM_FALL);
  let m = 0;
  for (let t = 0; t < 0.3; t += DT) m = momentumStep(m, 1, DT);
  assert.ok(m > 0.8, `0.3 秒才起到 ${m.toFixed(2)}`);
  let k = 1;
  for (let t = 0; t < 0.5; t += DT) k = momentumStep(k, 0, DT);
  assert.ok(k > 0.6, `停了 0.5 秒就只剩 ${k.toFixed(2)}`);
  for (let t = 0.5; t < 3; t += DT) k = momentumStep(k, 0, DT);
  assert.ok(k < 0.1, `停了 3 秒还剩 ${k.toFixed(2)}`);
  let n = 0;
  for (let t = 0; t < 0.5; t += DT) n = momentumStep(n, -1, DT);
  assert.ok(n < -0.9);
  assert.equal(momentumStep(0.4, 1, 0), 0.4);
});

test('镜头从起点走到终点，进度超出 0 到 1 时停在两头', () => {
  assert.equal(cameraX(0, M), M.xStart);
  assert.equal(cameraX(1, M), M.xEnd);
  assert.equal(cameraX(-0.5, M), M.xStart);
  assert.equal(cameraX(2, M), M.xEnd);
});

test('每段在自己中间是 1，交界带里和下一段此消彼长，加起来处处是 1', () => {
  assert.equal(presence(0, 2.5, M), 1);
  assert.equal(presence(1, 2.5, M), 0);
  for (let x = -2; x <= 42; x += 0.37) {
    const sum = M.scenes.reduce((s, _, k) => s + presence(k, x, M), 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `x=${x} 处加起来是 ${sum}`);
  }
  // 交界正中各一半
  assert.ok(Math.abs(presence(0, 5, M) - 0.5) < 1e-9);
  // 第一段往左、最后一段往右一直是它
  assert.equal(presence(0, -10, M), 1);
  assert.equal(presence(7, 60, M), 1);
});

test('视口里露出的块：远景慢（一屏装得下的米数多），两头不越界', () => {
  const [a, b] = visibleTiles(M.layers.mid, 20, 1.25, M.viewH);
  const [fa, fb] = visibleTiles(M.layers.far, 20, 1.25, M.viewH);
  assert.ok(b - a <= 2 && b >= a);
  assert.ok(fb - fa <= 2);
  assert.deepEqual(visibleTiles(M.layers.mid, M.xStart, 2.4, M.viewH)[0], 0);
  assert.ok(visibleTiles(M.layers.mid, M.xEnd, 2.4, M.viewH)[1] <= M.layers.mid.tiles - 1);
  // 最宽的视口在两头也盖得住（长条图按 2.4 的宽高比留了边）
  const half = (M.viewH * 2.4) / 2;
  assert.ok(M.layers.mid.x0 <= M.xStart - half + 1e-6);
  assert.ok(M.layers.mid.x0 + M.layers.mid.tiles * M.layers.mid.tileM >= M.xEnd + half - 1e-6);
});

test('出水只在最后一截：之前是 0，到终点是 1', () => {
  assert.equal(aboveAt(M.xEnd - 3, M), 0);
  assert.equal(aboveAt(M.xEnd, M), 1);
  assert.ok(aboveAt(M.xEnd - 0.8, M) > 0 && aboveAt(M.xEnd - 0.8, M) < 1);
});

test('各段的效果不一样：闸室冒气泡、深水有水母、浅水有水面，珊瑚礁没有水母', () => {
  const at = (k) => effectsAt(k * M.sceneLen + 2.5, M);
  assert.ok(at(4).bubbles > at(0).bubbles * 3);
  assert.ok(at(5).jelly > 0.9 && at(0).jelly === 0);
  assert.ok(at(7).surface > 0.9 && at(3).surface === 0);
  assert.ok(at(3).school >= at(0).school);
});

test('水色按段插值：第一段中间就是第一段的颜色', () => {
  const w = waterAt(2.5, M);
  assert.deepEqual(w.high.map((v) => Math.round(v * 255)), [255, 255, 255]);
  const mid = waterAt(5, M);
  assert.ok(Math.abs(mid.high[0] - 0.5) < 1e-9);
});

test('readReef：画布上没有清单或写坏了就是没有', () => {
  assert.equal(readReef(null), null);
  assert.equal(readReef({ dataset: {} }), null);
  assert.equal(readReef({ dataset: { reef: '{' } }), null);
  assert.ok(readReef({ dataset: { reef: JSON.stringify(M) } }));
});

test('仓库里的清单和 tools/reef/journey.py 的排法、文件对得上', () => {
  const file = 'src/assets/reef/manifest.json';
  if (!existsSync(file)) return;
  const m = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(m.scenes.length, 8);
  for (const name of ['far', 'mid']) {
    const layer = m.layers[name];
    for (let i = 0; i < layer.tiles; i++) {
      const stem = `src/assets/reef/${name}/${String(i).padStart(2, '0')}`;
      assert.ok(existsSync(`${stem}.webp`), `${stem}.webp 不在`);
      if (layer.aux) assert.ok(existsSync(`${stem}-aux.webp`), `${stem}-aux.webp 不在`);
    }
  }
  assert.ok(existsSync('src/assets/reef/back.webp'));
  for (const act of ['idle', 'swim']) assert.ok(existsSync(`src/assets/reef/fish/${act}.webp`));
});

test('每块长条图都有一张小的预览图（tools/reef/downsize.py），清单写着 preview', () => {
  const file = 'src/assets/reef/manifest.json';
  if (!existsSync(file)) return;
  const m = JSON.parse(readFileSync(file, 'utf8'));
  assert.ok(m.preview, '清单里没有 preview：重跑 python -I tools/reef/downsize.py');
  for (const name of ['far', 'mid', 'above']) {
    const layer = m.layers[name];
    if (!layer) continue;
    for (let i = 0; i < layer.tiles; i++) {
      const lo = `src/assets/reef/${name}/${String(i).padStart(2, '0')}-lo.webp`;
      assert.ok(existsSync(lo), `${lo} 不在`);
      assert.ok(statSync(lo).size < 80 * 1024, `${lo} 有 ${Math.round(statSync(lo).size / 1024)} KB，预览图太大`);
    }
  }
});

test('鱼游来游去、窜来窜去，不越过左边那条线（宽屏上说明那一栏的右边），也不越过右边', () => {
  for (const seed of [3, 7, 11]) {
    const step = createFishBehavior(seed);
    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < 60 * 120; i++) {
      const pose = step(1 / 60, { momentum: i % 900 < 60 ? -0.08 : 0, aspect: 1.25, left: 0.11 });
      if (i > 120) {
        minX = Math.min(minX, pose.x);
        maxX = Math.max(maxX, pose.x);
      }
    }
    assert.ok(minX >= 0.1, `种子 ${seed}：鱼游到了 ${minX.toFixed(3)}，越过了左边 0.11`);
    assert.ok(maxX <= 0.33, `种子 ${seed}：鱼游到了 ${maxX.toFixed(3)}，出了右边`);
  }
});

// 下载排队用的假 start：记下开始了哪几个，由测试决定哪个下完
function fakeStarts() {
  const started = [];
  const finish = {};
  const signals = {};
  const start = (key, url, signal) => {
    started.push(key);
    signals[key] = signal;
    return new Promise((resolve) => {
      finish[key] = resolve;
    });
  };
  return { started, finish, signals, start };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test('下载排队：同时最多 max 个，优先级数字小的先下，一样的按先来后到', async () => {
  const f = fakeStarts();
  const q = createLoadQueue({ start: f.start, max: 2 });
  q.begin();
  q.add('fish', 'f', 3);
  q.add('mid:00', 'm', 1);
  q.add('mid:00-lo', 'l', 0);
  q.add('far:00', 'r', 1);
  q.sweep();
  assert.deepEqual(f.started, ['mid:00-lo', 'mid:00']);
  assert.ok(q.has('fish') && q.has('mid:00'));
  f.finish['mid:00-lo']();
  await settle();
  assert.deepEqual(f.started, ['mid:00-lo', 'mid:00', 'far:00']);
  assert.ok(!q.has('mid:00-lo'));
});

test('下载排队：这一轮没再要、还没开始下的丢掉（滚过去的块不下），fixed 的留着；新一轮按新的优先级排', async () => {
  const f = fakeStarts();
  const q = createLoadQueue({ start: f.start, max: 1 });
  q.begin();
  q.add('busy', 'b', 0);
  q.add('back', 'k', 0, true);
  q.add('mid:05', 'a', 5);
  q.add('mid:06', 'c', 5);
  q.sweep();
  assert.deepEqual(f.started, ['busy']);
  q.begin();
  q.add('mid:06', 'c', 1);
  q.sweep();
  assert.ok(!q.has('mid:05'), '滚过去了还留在队里');
  assert.ok(q.has('back'));
  f.finish.busy();
  await settle();
  assert.deepEqual(f.started, ['busy', 'back']);
  f.finish.back();
  await settle();
  assert.deepEqual(f.started, ['busy', 'back', 'mid:06']);
});

test('下载排队：同一轮里同一个要了两次取优先级高的；下失败了也空出位子', async () => {
  const f = fakeStarts();
  const q = createLoadQueue({
    start: (key, url, signal) => (key === 'bad' ? Promise.reject(new Error('404')) : f.start(key, url, signal)),
    max: 1,
  });
  q.begin();
  q.add('bad', 'x', 0);
  q.add('a', 'a', 5);
  q.add('a', 'a', 2);
  q.add('b', 'b', 3);
  q.sweep();
  await settle();
  assert.deepEqual(f.started, ['a']);
});

test('下载排队：abort 清空排着的、停掉在下的', async () => {
  const f = fakeStarts();
  const q = createLoadQueue({ start: f.start, max: 2 });
  q.begin();
  for (const key of ['a', 'b', 'c']) q.add(key, key, 0);
  q.sweep();
  q.abort();
  assert.ok(f.signals.a && f.signals.a.aborted && f.signals.b.aborted);
  assert.ok(!q.has('c'));
  f.finish.a();
  f.finish.b();
  await settle();
  assert.deepEqual(f.started, ['a', 'b']);
  assert.deepEqual(q.keys(), []);
});

test('reefUrl：清单里带了这个文件的版本号就加在地址后面，没带就照原样', () => {
  assert.equal(reefUrl({ base: 'assets/reef/' }, 'mid/00.webp'), 'assets/reef/mid/00.webp');
  assert.equal(reefUrl({ base: '../assets/reef/', v: { 'mid/00.webp': 'abc123' } }, 'mid/00.webp'), '../assets/reef/mid/00.webp?v=abc123');
  assert.equal(reefUrl({ v: {} }, 'back.webp'), 'back.webp');
});

test('下载排队：往前备的（低优先级）占不满位子，滚到新一段时眼前要用的不用等它们下完', async () => {
  const f = fakeStarts();
  const q = createLoadQueue({ start: f.start, capacity: (prio) => (prio >= 5 ? 2 : 4) });
  q.begin();
  for (const key of ['n1', 'n2', 'n3']) q.add(key, key, 5);
  q.sweep();
  assert.deepEqual(f.started, ['n1', 'n2'], '往前备的占了两个以上的位子');
  q.begin();
  q.add('v-lo', 'v', 0);
  q.add('v', 'v', 1);
  q.add('n3', 'n3', 5);
  q.sweep();
  assert.deepEqual(f.started, ['n1', 'n2', 'v-lo', 'v']);
});

test('下载排队：滚过去 staleMs 还没下完的停掉（带宽让给眼前的），又要回来的和 fixed 的不停', async () => {
  const f = fakeStarts();
  let now = 0;
  const q = createLoadQueue({ start: f.start, max: 4, staleMs: 1500, clock: () => now });
  q.begin();
  q.add('passed', 'p', 5);
  q.add('back', 'b', 0, true);
  q.add('kept', 'k', 1);
  q.sweep();
  assert.deepEqual(f.started, ['back', 'kept', 'passed']);
  now = 1000;
  q.begin();
  q.add('kept', 'k', 1);
  q.sweep();
  assert.ok(!f.signals.passed.aborted, '才滚过去一秒就停了');
  now = 2000;
  q.begin();
  q.add('kept', 'k', 1);
  q.sweep();
  assert.ok(f.signals.passed.aborted, '滚过去两秒了还在下');
  assert.ok(!f.signals.kept.aborted && !f.signals.back.aborted);
});

test('tierOf：画布不到 HALF_MAX 像素高用半分辨率的，大屏用原图；清单里没有半分辨率的一律原图', () => {
  const m = { half: { scale: 0.5 } };
  assert.equal(tierOf(m, 713), '-md');
  assert.equal(tierOf(m, HALF_MAX), '-md');
  assert.equal(tierOf(m, HALF_MAX + 1), '');
  assert.equal(tierOf(m, 1410), '');
  assert.equal(tierOf({}, 713), '');
  // 半分辨率的长条图 900 像素高：放大不超过三分之一
  assert.ok(HALF_MAX / 900 <= 1.34);
});

test('stopXs：滚轮的每个停点镜头在哪，和 lock.js 的停点对得上', () => {
  const xs = stopXs(M);
  const stops = stopsOf(M);
  assert.equal(xs.length, stops.length);
  for (let i = 0; i < xs.length; i++) assert.ok(Math.abs(xs[i] - cameraX(stops[i], M)) < 1e-9, `第 ${i} 个停点`);
});

test('aheadTiles：往下一段走，要备的是眼前那几块之后、一直到下一段眼前的那几块，近的在前', () => {
  const xs = stopXs(M);
  const aspect = 2;
  for (let k = 0; k < xs.length - 1; k++) {
    const [a, b] = visibleTiles(M.layers.mid, xs[k], aspect, M.viewH);
    const [na, nb] = visibleTiles(M.layers.mid, xs[k + 1], aspect, M.viewH);
    const got = aheadTiles(M.layers.mid, xs[k], xs[k + 1], aspect, M.viewH);
    const want = [];
    for (let i = b + 1; i <= nb; i++) want.push(i);
    assert.deepEqual(got, want, `第 ${k} 段往下`);
    // 下一段眼前的都在：要么现在就在眼前，要么在备的里面
    for (let i = na; i <= nb; i++) assert.ok((i >= a && i <= b) || got.includes(i), `第 ${k} 段往下漏了第 ${i} 块`);
  }
  // 往回走：近的在前
  const back = aheadTiles(M.layers.mid, xs[4], xs[3], aspect, M.viewH);
  assert.ok(back.length > 0);
  for (let i = 1; i < back.length; i++) assert.ok(back[i] < back[i - 1]);
  // 到头了（没有下一个停点）不备
  assert.deepEqual(aheadTiles(M.layers.mid, xs[7], null, aspect, M.viewH), []);
  // 远景走得慢：下一段眼前的远景多半现在就在眼前，备得少
  assert.ok(aheadTiles(M.layers.far, xs[2], xs[3], aspect, M.viewH).length <= 1);
});

test('仓库里每块长条图都有半分辨率的，鱼和水母也有，清单写着 half', () => {
  const file = 'src/assets/reef/manifest.json';
  if (!existsSync(file)) return;
  const m = JSON.parse(readFileSync(file, 'utf8'));
  assert.ok(m.half, '清单里没有 half：重跑 python -I tools/reef/downsize.py');
  for (const name of ['far', 'mid', 'above']) {
    const layer = m.layers[name];
    if (!layer) continue;
    for (let i = 0; i < layer.tiles; i++) {
      const stem = `src/assets/reef/${name}/${String(i).padStart(2, '0')}`;
      assert.ok(existsSync(`${stem}-md.webp`), `${name} 第 ${i} 块没有半分辨率的`);
      if (layer.aux) assert.ok(existsSync(`${stem}-aux-md.webp`), `${name} 第 ${i} 块没有半分辨率那套的辅助图`);
    }
  }
  for (const sprite of ['fish/idle', 'fish/swim', 'jelly']) assert.ok(existsSync(`src/assets/reef/${sprite}-md.webp`), `${sprite}-md.webp 不在`);
});
