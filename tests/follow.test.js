import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFollower } from '../src/scripts/follow.js';
import { FOLLOW } from '../src/scripts/lock.js';

const DT = 1 / 120;

function run(follower, targetAt, seconds) {
  const out = [];
  for (let i = 1; i <= Math.round(seconds / DT); i++) {
    const t = i * DT;
    out.push({ t, x: follower.step(targetAt(t), DT), v: follower.velocity });
  }
  return out;
}

test('createFollower：第一步和 snap 直接到位，速度清零', () => {
  const f = createFollower(FOLLOW);
  assert.equal(f.step(0.3, DT), 0.3);
  f.step(0.5, DT);
  assert.equal(f.step(0.8, DT, true), 0.8);
  assert.equal(f.velocity, 0);
});

test('createFollower：目标跳一下，画面单调地追上去、不越过，0.4 秒内走完九成五', () => {
  const f = createFollower(FOLLOW);
  f.step(0, DT);
  const path = run(f, () => 1, 1);
  for (let i = 1; i < path.length; i++) assert.ok(path[i].x >= path[i - 1].x - 1e-12, '往回走了');
  assert.ok(path.every((p) => p.x <= 1 + 1e-12), '越过了目标');
  const at = path.find((p) => p.x >= 0.95).t;
  assert.ok(at < 0.42, `走完九成五用了 ${at.toFixed(3)} 秒`);
  // 起步是缓的：头一帧走的远小于一阶追法的那一大截（一阶的头一帧走 1 - e^(-ω·dt)）
  assert.ok(path[0].x < (1 - Math.exp(-FOLLOW * DT)) / 3, `头一帧就走了 ${path[0].x.toFixed(4)}`);
});

test('createFollower：匀速滚的时候落后 2/ω 秒，停下以后不越过目标', () => {
  const f = createFollower(FOLLOW);
  f.step(0, DT);
  const speed = 0.2; // 每秒 0.2 的进度
  const moving = run(f, (t) => speed * t, 2);
  const last = moving[moving.length - 1];
  const lag = (speed * last.t - last.x) / speed;
  assert.ok(Math.abs(lag - 2 / FOLLOW) < 0.01, `落后 ${lag.toFixed(3)} 秒`);
  const end = speed * 2;
  const after = run(f, () => end, 1);
  assert.ok(after.every((p) => p.x <= end + 1e-12), '停下以后越过了目标');
  assert.ok(Math.abs(after[after.length - 1].x - end) < 1e-3);
});

test('createFollower：方向反过来时不在目标两边来回晃', () => {
  const f = createFollower(FOLLOW);
  f.step(0, DT);
  run(f, (t) => 0.5 * t, 1); // 往前滚得正快
  const back = f.value - 0.01; // 突然退回到画面后面一点点
  const path = run(f, () => back, 1);
  assert.ok(path.every((p) => p.x >= back - 1e-12), '越过了退回去的目标');
});

test('createFollower：滚轮一格一格地滚，画面一路在动，不是一顿一顿的', () => {
  // 每 0.15 秒来一格（一格 0.016 的进度，差不多是滚轮的 100px），看中间一段的速度最低掉到平均的多少
  const tick = 0.15;
  const step = 0.016;
  const target = (t) => Math.floor(t / tick + 1) * step;
  const f = createFollower(FOLLOW);
  f.step(0, DT);
  const path = run(f, target, 2).filter((p) => p.t > 0.75 && p.t < 1.95);
  const mean = step / tick;
  const min = Math.min(...path.map((p) => p.v));
  // 一阶追法在两格之间速度掉到平均的两成以下（e^(-12 × 0.15) ≈ 0.17 倍的峰值）；二阶要一直在平均的一半以上
  assert.ok(min > mean * 0.5, `两格之间速度掉到了平均的 ${(min / mean).toFixed(2)}`);
});
