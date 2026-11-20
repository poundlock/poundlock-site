import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beatAt, progressOf } from '../src/scripts/lock.js';
import { geometry, renderScene } from '../src/sections/lock-scene.js';

test('beatAt', () => {
  assert.equal(beatAt(0), 0);
  assert.equal(beatAt(0.124), 0);
  assert.equal(beatAt(0.125), 1);
  assert.equal(beatAt(0.25), 2);
  assert.equal(beatAt(0.5), 4);
  assert.equal(beatAt(0.6), 4);
  assert.equal(beatAt(0.75), 6);
  assert.equal(beatAt(0.999), 7);
  assert.equal(beatAt(1), 7);
  assert.equal(beatAt(-1), 0);
  assert.equal(beatAt(2), 7);
  assert.equal(beatAt(0.5, 4), 2);
});

test('progressOf：这一节还没到是 0，滚过了是 1，中间按比例', () => {
  // 轨道高 5000，视口高 1000：能滚的范围是 4000。
  assert.equal(progressOf({ top: 300, height: 5000 }, 1000), 0);
  assert.equal(progressOf({ top: 0, height: 5000 }, 1000), 0);
  assert.equal(progressOf({ top: -2000, height: 5000 }, 1000), 0.5);
  assert.equal(progressOf({ top: -4000, height: 5000 }, 1000), 1);
  assert.equal(progressOf({ top: -9000, height: 5000 }, 1000), 1);
});

test('progressOf：轨道不比视口高（静态版式）时，按有没有滚过去算', () => {
  assert.equal(progressOf({ top: 200, height: 800 }, 1000), 0);
  assert.equal(progressOf({ top: -900, height: 800 }, 1000), 1);
});

test('八个闸室的水位一级比一级高', () => {
  assert.equal(geometry.slabs.length, 8);
  // SVG 的 y 向下，所以水位高就是 y 小。
  assert.ok(geometry.river > geometry.slabs[0].level, '河面要比第一级低');
  for (let i = 1; i < 8; i++) {
    assert.ok(geometry.slabs[i].level < geometry.slabs[i - 1].level, `第 ${i + 1} 级没有比第 ${i} 级高`);
  }
});

test('闸室之间隔一道闸缝的宽度', () => {
  for (let i = 1; i < 8; i++) assert.equal(geometry.slabs[i].x - (geometry.slabs[i - 1].x + geometry.slabs[i - 1].width), 14);
});

test('水面以上那一张用另一套颜色，id 不和水下那一张撞', () => {
  const deep = String(renderScene());
  const light = String(renderScene({ tone: 'light' }));
  const ids = (svg) => [...svg.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(ids(deep).length, 16, '八个渐变加八个裁剪');
  assert.equal(ids(light).length, 16);
  assert.equal(ids(deep).filter((id) => ids(light).includes(id)).length, 0);
  // 色值不写在图里，只写调色板的变量名：水下那一张用 --water-* / --mint-*，水面以上用 --blue-*。
  assert.ok(light.includes('var(--blue-hi)') && !light.includes('--water-hi-0'));
  assert.ok(deep.includes('var(--water-hi-0)') && !deep.includes('--blue-hi'));
  assert.doesNotMatch(deep + light, /#[0-9A-Fa-f]{6}/, '场景里不该写死色值');
});

test('水尺上相邻两级的刻度隔得开', () => {
  for (let i = 1; i < 8; i++) assert.ok(geometry.slabs[i - 1].level - geometry.slabs[i].level >= 18, `第 ${i}、${i + 1} 级只隔 ${geometry.slabs[i - 1].level - geometry.slabs[i].level}`);
});

test('实现那一段的闸室比别的宽，里面分五道', () => {
  const widths = geometry.slabs.map((slab) => slab.width);
  assert.ok(widths[4] > Math.max(...widths.filter((_, i) => i !== 4)));
  assert.equal(String(renderScene()).split('class="slab__lane"').length - 1, 4, '五道之间是四条分隔线');
});

test('场景的 SVG 里八个闸室都在，并带着脚本要读的数', () => {
  const svg = String(renderScene());
  for (let i = 0; i < 8; i++) assert.ok(svg.includes(`data-slab="${i}"`), `缺第 ${i + 1} 个闸室`);
  assert.equal(svg.split('class="slab__water"').length - 1, 8);
  assert.equal(svg.split('class="gate"').length - 1, 7, '七道缝里各一道闸门');
  assert.ok(svg.includes('class="boat"'));
  assert.ok(svg.includes(`data-river="${geometry.river}"`));
  assert.ok(svg.includes(`data-start-x="${geometry.startX}"`));
  assert.ok(svg.includes(`data-empty="${geometry.empty}"`));
  assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(svg), '场景里不该有外部地址');
});
