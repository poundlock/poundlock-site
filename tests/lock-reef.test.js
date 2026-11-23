import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { momentumStep, MOMENTUM_RISE, MOMENTUM_FALL, REEF_FOLLOW, cameraX, presence, visibleTiles, aboveAt, effectsAt, waterAt, readReef, createFishBehavior } from '../src/scripts/lock-reef.js';
import { FOLLOW } from '../src/scripts/lock.js';

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
