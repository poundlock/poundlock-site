import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFpsWatchdog, prefersReducedMotion, whenVisible } from '../src/scripts/motion.js';

// 用假的时钟喂帧：每隔 stepMs 一帧，喂够 totalMs。
function feed(watchdog, clock, stepMs, totalMs) {
  for (let elapsed = 0; elapsed < totalMs; elapsed += stepMs) {
    clock.t += stepMs;
    watchdog.tick();
  }
}

function setup(options = {}) {
  const clock = { t: 0 };
  let degraded = 0;
  const watchdog = createFpsWatchdog({ onDegrade: () => degraded++, now: () => clock.t, ...options });
  return { clock, watchdog, count: () => degraded };
}

test('帧率够就不降级', () => {
  const { clock, watchdog, count } = setup();
  feed(watchdog, clock, 16.7, 3000);
  assert.equal(count(), 0);
});

test('帧率不够降级一次，之后不再重复', () => {
  const { clock, watchdog, count } = setup();
  feed(watchdog, clock, 50, 2100);
  assert.equal(count(), 1);
  feed(watchdog, clock, 50, 2000);
  assert.equal(count(), 1);
});

test('刚开始的一两帧慢不算', () => {
  const { clock, watchdog, count } = setup();
  feed(watchdog, clock, 200, 400);
  feed(watchdog, clock, 16.7, 3000);
  assert.equal(count(), 0);
});

test('stop 之后不再调', () => {
  const { clock, watchdog, count } = setup();
  watchdog.stop();
  feed(watchdog, clock, 50, 4000);
  assert.equal(count(), 0);
});

test('标签页切走再回来的那一长帧不算掉帧', () => {
  const { clock, watchdog, count } = setup();
  feed(watchdog, clock, 16.7, 1000);
  clock.t += 60000;
  watchdog.tick();
  feed(watchdog, clock, 16.7, 3000);
  assert.equal(count(), 0);
});

test('连着几帧都隔一秒以上，是真的卡，也降级', () => {
  const { clock, watchdog, count } = setup();
  feed(watchdog, clock, 1500, 6000);
  assert.equal(count(), 1);
});

test('prefersReducedMotion 读系统设置', () => {
  const win = (matches) => ({ matchMedia: (query) => ({ matches: query === '(prefers-reduced-motion: reduce)' && matches }) });
  assert.equal(prefersReducedMotion(win(true)), true);
  assert.equal(prefersReducedMotion(win(false)), false);
  assert.equal(prefersReducedMotion({}), false);
});

test('whenVisible 在可见性变化时调对应的回调，解绑后不再调', () => {
  const listeners = [];
  const doc = {
    hidden: false,
    addEventListener: (type, fn) => listeners.push([type, fn]),
    removeEventListener: (type, fn) => {
      const i = listeners.findIndex(([t, f]) => t === type && f === fn);
      if (i >= 0) listeners.splice(i, 1);
    },
  };
  const calls = [];
  const off = whenVisible(doc, { onShow: () => calls.push('show'), onHide: () => calls.push('hide') });
  doc.hidden = true;
  listeners.forEach(([, fn]) => fn());
  doc.hidden = false;
  listeners.forEach(([, fn]) => fn());
  assert.deepEqual(calls, ['hide', 'show']);
  off();
  assert.equal(listeners.length, 0);
});
