import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASES, lockStateAt } from '../src/scripts/lock-state.js';
import { beatAt } from '../src/scripts/lock.js';

// 把整段滚动细细地走一遍。
const SAMPLES = Array.from({ length: 2001 }, (_, i) => i / 2000);
const N = 8;

test('开场：船在第一道闸外面的河里，第一道闸开着，其余都关着，各室都在低水位', () => {
  const s = lockStateAt(0);
  assert.equal(s.boat, -0.5);
  assert.equal(s.level, 0);
  assert.deepEqual(s.water, Array(N).fill(0));
  assert.equal(s.gates.length, N + 1);
  assert.equal(s.gates[0], 0);
  assert.deepEqual(s.gates.slice(1), Array(N).fill(1));
  assert.equal(s.day, 0);
});

test('收尾：八室都注满，最后一道闸开了，船驶出去了，天亮了', () => {
  const s = lockStateAt(1);
  assert.deepEqual(s.water, Array(N).fill(1));
  assert.equal(s.gates[N], 0);
  assert.ok(s.boat > N, `船停在 ${s.boat}`);
  assert.equal(s.level, N);
  assert.equal(s.day, 1);
});

test('船只往前走，水位只升不降', () => {
  let prev = lockStateAt(0);
  for (const p of SAMPLES) {
    const s = lockStateAt(p);
    assert.ok(s.boat >= prev.boat - 1e-9, `p=${p} 时船往回走了`);
    assert.ok(s.level >= prev.level - 1e-9, `p=${p} 时船的水位降了`);
    for (let i = 0; i < N; i++) assert.ok(s.water[i] >= prev.water[i] - 1e-9, `p=${p} 时第 ${i + 1} 室的水位降了`);
    assert.ok(s.day >= prev.day - 1e-9);
    prev = s;
  }
});

test('船不会穿过一道关着的闸门', () => {
  for (const p of SAMPLES) {
    const s = lockStateAt(p);
    for (let g = 0; g <= N; g++) {
      // 闸门 g 在位置 g；船身前后各占 0.2。
      if (Math.abs(s.boat - g) < 0.2) assert.equal(s.gates[g], 0, `p=${p} 时船正过第 ${g + 1} 道闸，它却没全开（${s.gates[g]}）`);
    }
  }
});

test('身后的闸门没关严，水不升；船没进来，水也不升', () => {
  for (const p of SAMPLES) {
    const s = lockStateAt(p);
    for (let i = 0; i < N; i++) {
      if (s.water[i] > 0 && s.water[i] < 1) {
        assert.equal(s.gates[i], 1, `p=${p} 时第 ${i + 1} 室在升水，身后的闸门却没关严（${s.gates[i]}）`);
        assert.ok(s.boat > i + 0.2 && s.boat < i + 0.8, `p=${p} 时第 ${i + 1} 室在升水，船却在 ${s.boat}`);
      }
    }
  }
});

test('两边水位不平的闸门开不了', () => {
  for (const p of SAMPLES) {
    const s = lockStateAt(p);
    for (let g = 1; g <= N; g++) {
      // 闸门 g 的下游是第 g 室（下标 g-1）：它没注满，这道门就得关严。
      if (s.water[g - 1] < 1) assert.equal(s.gates[g], 1, `p=${p} 时第 ${g} 室还没注满，上游的闸门却动了`);
    }
  }
});

test('船的水位就是它所在那一室的水位', () => {
  for (const p of SAMPLES) {
    const s = lockStateAt(p);
    const chamber = Math.min(N - 1, Math.floor(s.boat));
    const expected = s.boat < 0 ? 0 : s.boat >= N ? N : chamber + s.water[chamber];
    assert.ok(Math.abs(s.level - expected) < 1e-9, `p=${p}：船在 ${s.boat}，水位 ${s.level}，应当是 ${expected}`);
  }
});

test('每一拍里船都进到了对应的那一室', () => {
  // 一拍过了一半以后，船在这一拍的闸室里；拍数和页面上显示的那一段对得上。
  for (let i = 0; i < N; i++) {
    const p = (i + 0.6) / N;
    assert.equal(beatAt(p), i);
    const s = lockStateAt(p);
    if (i < N - 1) assert.equal(Math.floor(s.boat), i, `第 ${i + 1} 拍过半时船在 ${s.boat}`);
  }
});

test('天亮只发生在最后一拍', () => {
  assert.equal(lockStateAt((N - 1) / N).day, 0);
  assert.equal(lockStateAt((N - 0.6) / N).day, 0);
  assert.ok(lockStateAt((N - 0.2) / N).day > 0);
});

test('进度超出 0 到 1 时夹住', () => {
  assert.deepEqual(lockStateAt(-3), lockStateAt(0));
  assert.deepEqual(lockStateAt(7), lockStateAt(1));
});

test('船走动的最快处不超过平均速度的 1.7 倍', () => {
  // 滚同样一小段，船前进多少：走动那一段里最快的地方和平均比。差得太多，滚一下画面就猛地窜出去。
  for (const chamber of [0, 3, 6]) {
    const from = chamber / N;
    const to = (chamber + PHASES.move[1]) / N;
    const steps = 400;
    let peak = 0;
    for (let k = 0; k < steps; k++) {
      const a = lockStateAt(from + ((to - from) * k) / steps).boat;
      const b = lockStateAt(from + ((to - from) * (k + 1)) / steps).boat;
      peak = Math.max(peak, b - a);
    }
    const total = lockStateAt(to).boat - lockStateAt(from).boat;
    assert.ok(Math.abs(total - 1) < 1e-9, `第 ${chamber + 1} 室走动一段应当正好前进一室，实际 ${total}`);
    assert.ok(peak / (total / steps) <= 1.7, `第 ${chamber + 1} 室最快处是平均的 ${(peak / (total / steps)).toFixed(2)} 倍`);
  }
});
