import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lockStateAt } from '../src/scripts/lock-state.js';
import { CHAMBER_METRES, LIMITS, filmSchedule, frameAtTable, stepCost } from '../src/scripts/film-schedule.js';

const table = filmSchedule();
const states = table.map((progress) => ({ progress, ...lockStateAt(progress) }));
const pairs = states.slice(1).map((b, i) => [states[i], b]);
const SLACK = 1e-6;

test('取帧表从 0 到 1，严格递增', () => {
  assert.equal(table[0], 0);
  assert.equal(table[table.length - 1], 1);
  for (const [a, b] of pairs) assert.ok(b.progress > a.progress, `${a.progress} 之后是 ${b.progress}`);
});

test('相邻两帧，船最多前进 0.4 米', () => {
  for (const [a, b] of pairs) {
    const metres = (b.boat - a.boat) * CHAMBER_METRES;
    assert.ok(metres <= 0.4 + SLACK, `进度 ${a.progress} 到 ${b.progress} 船前进了 ${metres.toFixed(3)} 米`);
  }
});

test('相邻两帧，水位、闸门、天色、进度都不超各自的上限', () => {
  for (const [a, b] of pairs) {
    const where = `进度 ${a.progress} 到 ${b.progress}`;
    a.water.forEach((w, i) => assert.ok(Math.abs(b.water[i] - w) <= LIMITS.rise + SLACK, `${where} 第 ${i} 室水位变了 ${Math.abs(b.water[i] - w)}`));
    a.gates.forEach((g, i) => assert.ok(Math.abs(b.gates[i] - g) <= LIMITS.gate + SLACK, `${where} 第 ${i} 道门变了 ${Math.abs(b.gates[i] - g)}`));
    assert.ok(Math.abs(b.day - a.day) <= LIMITS.day + SLACK, `${where} 天色变了 ${Math.abs(b.day - a.day)}`);
    assert.ok(b.progress - a.progress <= LIMITS.gap + SLACK, `${where} 进度差超了`);
  }
});

test('取帧不浪费：每一步至少有一项用到了上限的九成（最后一步除外）', () => {
  pairs.slice(0, -1).forEach(([a, b]) => {
    assert.ok(stepCost(a, b) >= 0.9, `进度 ${a.progress} 到 ${b.progress} 只用了 ${stepCost(a, b).toFixed(3)}`);
  });
});

test('帧数在七百到一千一之间，船在走的帧占一半以上', () => {
  assert.ok(table.length >= 700 && table.length <= 1100, `一共 ${table.length} 帧`);
  const moving = pairs.filter(([a, b]) => (b.boat - a.boat) * CHAMBER_METRES > 0.2).length;
  assert.ok(moving > table.length / 2, `船在走的 ${moving} 帧，一共 ${table.length} 帧`);
});

test('stepCost：一样的状态是 0；船正好前进一个上限是 1；各项里取最大的', () => {
  const base = { progress: 0.3, ...lockStateAt(0.3) };
  assert.equal(stepCost(base, base), 0);
  const moved = { ...base, boat: base.boat + LIMITS.travel / CHAMBER_METRES };
  assert.ok(Math.abs(stepCost(base, moved) - 1) < 1e-9);
  const gates = base.gates.slice();
  gates[2] += LIMITS.gate * 2;
  assert.ok(Math.abs(stepCost(base, { ...moved, gates }) - 2) < 1e-9);
});

test('frameAtTable：表上的点取到自己，夹在中间取近的，正中间往后取，越界夹住', () => {
  // 用二进制里表示得准的数：正中间那一条比的是两边的差相等。
  const t = [0, 0.25, 0.75, 1];
  assert.equal(frameAtTable(t, 0), 0);
  assert.equal(frameAtTable(t, 0.25), 1);
  assert.equal(frameAtTable(t, 0.75), 2);
  assert.equal(frameAtTable(t, 1), 3);
  assert.equal(frameAtTable(t, 0.1), 0);
  assert.equal(frameAtTable(t, 0.2), 1);
  assert.equal(frameAtTable(t, 0.5), 2);
  assert.equal(frameAtTable(t, 0.8), 2);
  assert.equal(frameAtTable(t, 0.9), 3);
  assert.equal(frameAtTable(t, -3), 0);
  assert.equal(frameAtTable(t, 7), 3);
  assert.equal(frameAtTable([0], 0.5), 0);
});

test('frameAtTable 对真的取帧表：每一帧自己的进度查回来是自己', () => {
  table.forEach((progress, index) => assert.equal(frameAtTable(table, progress), index));
});
