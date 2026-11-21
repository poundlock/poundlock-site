import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coarseCount, coverRect, frameAt, loadOrder, nearestLoaded, pickSet } from '../src/scripts/lock-film.js';

test('frameAt：进度 0 是第一帧，1 是最后一帧，出界的夹住', () => {
  assert.equal(frameAt(0, 240), 0);
  assert.equal(frameAt(1, 240), 239);
  assert.equal(frameAt(0.5, 240), 120);
  assert.equal(frameAt(-3, 240), 0);
  assert.equal(frameAt(7, 240), 239);
  assert.equal(frameAt(0.5, 1), 0);
});

test('loadOrder：每一帧都排到，而且只排一次', () => {
  for (const count of [1, 2, 7, 120, 240]) {
    const order = loadOrder(count);
    assert.equal(order.length, count);
    assert.deepEqual([...order].sort((a, b) => a - b), Array.from({ length: count }, (_, i) => i));
  }
});

test('loadOrder：先稀后密——头十六分之一就铺满整段，第一帧最先', () => {
  const order = loadOrder(240);
  assert.equal(order[0], 0);
  const early = order.slice(0, 16).sort((a, b) => a - b);
  // 最先到的十六帧里，相邻两帧之间隔得不超过十六帧，最后一段也照顾到了。
  for (let i = 1; i < early.length; i++) assert.ok(early[i] - early[i - 1] <= 16, `早到的帧之间隔了 ${early[i] - early[i - 1]} 帧`);
  assert.ok(239 - early[early.length - 1] <= 16);
  // 到一半的时候，任何一帧离已经到的帧都不超过两帧。
  const half = new Set(order.slice(0, 120));
  for (let i = 0; i < 240; i++) assert.ok(half.has(i) || half.has(i - 1) || half.has(i + 1) || half.has(i - 2) || half.has(i + 2), `第 ${i} 帧附近没有到的`);
});

test('nearestLoaded：要的那一帧到了就用它，没到用最近的一帧，一帧都没到是 -1', () => {
  const loaded = new Set([0, 16, 32]);
  const has = (i) => loaded.has(i);
  assert.equal(nearestLoaded(16, has, 240), 16);
  assert.equal(nearestLoaded(20, has, 240), 16);
  assert.equal(nearestLoaded(25, has, 240), 32);
  assert.equal(nearestLoaded(239, has, 240), 32);
  assert.equal(nearestLoaded(5, () => false, 240), -1);
});

test('coverRect：画面铺满视口，画面的中心落在指定的位置', () => {
  for (const [fw, fh, vw, vh, ax, ay] of [
    [1920, 1080, 1440, 900, 0.5, 0.5],
    [1920, 1080, 1440, 900, 0.62, 0.5],
    [1920, 1080, 2560, 1080, 0.62, 0.5],
    [1080, 1440, 390, 500, 0.5, 0.45],
    [1080, 1440, 820, 1180, 0.6, 0.5],
  ]) {
    const r = coverRect(fw, fh, vw, vh, ax, ay);
    assert.ok(r.x <= 0.5 && r.y <= 0.5, `左上没盖住：${JSON.stringify(r)}`);
    assert.ok(r.x + r.w >= vw - 0.5 && r.y + r.h >= vh - 0.5, `右下没盖住：${JSON.stringify(r)}`);
    assert.ok(Math.abs(r.w / r.h - fw / fh) < 1e-6, '画面被拉变形了');
    assert.ok(Math.abs(r.x + r.w / 2 - ax * vw) < 0.5, '中心的横向位置不对');
  }
});

test('coverRect：竖向放不下「中心落在指定位置」时，贴边，不露底', () => {
  // 画面只比视口高一点，中心要求落在 0.3：照做会在底下露出一条，这时改成贴底。
  const r = coverRect(1920, 1080, 1920, 1000, 0.5, 0.3);
  assert.ok(r.y <= 0.5 && r.y + r.h >= 1000 - 0.5, JSON.stringify(r));
});

test('pickSet：横屏用横版，手机竖屏用竖版，够宽的竖屏还是横版；只有一版就用那一版', () => {
  const sets = { wide: { width: 1920, height: 1080 }, tall: { width: 1080, height: 1440 } };
  assert.equal(pickSet(sets, 1440, 900), 'wide');
  assert.equal(pickSet(sets, 390, 844), 'tall');
  assert.equal(pickSet(sets, 1000, 1000), 'wide');
  // 竖着的平板、竖着摆的大屏：虽然是竖的，但够宽，用横版（竖版是给手机缩过的，放大了发虚）。
  assert.equal(pickSet(sets, 820, 1180), 'wide');
  assert.equal(pickSet(sets, 1080, 1920), 'wide');
  assert.equal(pickSet(sets, 600, 900), 'tall');
  assert.equal(pickSet({ wide: sets.wide }, 390, 844), 'wide');
  assert.equal(pickSet({}, 390, 844), null);
});

test('coarseCount：头一遍稀的有几帧——每隔十六帧一帧，加上最后一帧', () => {
  assert.equal(coarseCount(240), 16);
  assert.equal(coarseCount(120), 9);
  assert.equal(coarseCount(1), 1);
  assert.equal(coarseCount(10), 2);
  // 就是 loadOrder 的头这么多个：全是十六的倍数，或者最后一帧。
  for (const count of [240, 120, 33]) {
    const head = loadOrder(count).slice(0, coarseCount(count));
    assert.ok(head.every((i) => i % 16 === 0 || i === count - 1), `${count} 帧时头一遍里混进了别的帧：${head}`);
    assert.ok(head.includes(0) && head.includes(count - 1));
  }
});
