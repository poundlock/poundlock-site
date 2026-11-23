import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as facts from '../src/facts.js';
import { render } from '../src/sections/hero.js';
import { designSize, SCALE, MIN_W, MAX_W, MIN_H, COMPACT_W } from '../tools/stage/size.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(path.join(ROOT, ...parts), 'utf8');
const demo = JSON.parse(read('src', 'copy', 'hero-demo.json'));
const zh = JSON.parse(read('src', 'copy', 'zh.json'));
// 英文页的演示另有一份（终端里的字也是英文的）
const demoEn = JSON.parse(read('src', 'copy', 'hero-demo.en.json'));
const en = JSON.parse(read('src', 'copy', 'en.json'));
const config = { repoUrl: 'https://github.com/poundlock/poundlock-skills' };

test('首屏演示的八段和官网的阶段、角色对得上', () => {
  assert.deepEqual(demo.stages.map((s) => s.id), facts.stages.map((s) => s.id));
  for (const stage of demo.stages) {
    assert.equal(stage.name, zh.lock.stages[stage.id].name, `${stage.id} 的名字和过闸那一节的不一样`);
    const allowed = facts.stages.find((s) => s.id === stage.id).roles.map((role) => zh.lock.roles[role].name);
    for (const who of stage.who.split('、')) assert.ok(allowed.includes(who), `${stage.id} 写的「${who}」不是这一段的角色`);
  }
});

test('首屏演示的两条需求：被拦的和改写的是实现那一段的两个不同角色，门禁的原话说的是被拦的那个', () => {
  assert.equal(demo.reqs.length, 2);
  const implementers = facts.stages.find((s) => s.id === 'S5').roles.map((role) => zh.lock.roles[role].name);
  for (const req of demo.reqs) {
    assert.ok(req.command.startsWith('/poundlock:at '), `命令「${req.command}」不是 /poundlock:at 开头`);
    assert.ok(implementers.includes(req.writer) && implementers.includes(req.owner), `${req.writer} / ${req.owner} 不是实现那一段的角色`);
    assert.notEqual(req.writer, req.owner);
    assert.ok(req.gateSays.startsWith(req.writer), `门禁的原话「${req.gateSays}」说的不是 ${req.writer}`);
  }
  assert.notEqual(demo.reqs[0].command, demo.reqs[1].command, '两条需求一样，循环时会重复敲同一条命令');
});

test('英文页的演示：八段、角色和英文页过闸那一节的叫法一样，两条需求的结构和中文那份一样', () => {
  assert.deepEqual(demoEn.stages.map((s) => s.id), facts.stages.map((s) => s.id));
  for (const stage of demoEn.stages) {
    assert.equal(stage.name, en.lock.stages[stage.id].name, `${stage.id} 的名字和英文页过闸那一节的不一样`);
    const allowed = facts.stages.find((s) => s.id === stage.id).roles.map((role) => en.lock.roles[role].name);
    for (const who of stage.who.split(', ')) assert.ok(allowed.includes(who), `${stage.id} 写的「${who}」不是这一段的角色`);
  }
  const implementers = facts.stages.find((s) => s.id === 'S5').roles.map((role) => en.lock.roles[role].name);
  assert.equal(demoEn.reqs.length, 2);
  for (const req of demoEn.reqs) {
    assert.ok(req.command.startsWith('/poundlock:at '));
    assert.ok(implementers.includes(req.writer) && implementers.includes(req.owner));
    assert.notEqual(req.writer, req.owner);
    assert.ok(req.gateSays.startsWith(req.writer));
  }
  assert.deepEqual(Object.keys(demoEn).sort(), Object.keys(demo).sort(), '英文那份和中文那份的键不一样');
  // 英文页不带中文字体：英文那份里不能有中文字
  assert.ok(!/[一-鿿]/.test(JSON.stringify(demoEn)), '英文页的演示里还有中文');
});

test('首屏演示的文案没有空的', () => {
  const walk = (value, at) => {
    if (typeof value === 'string') return assert.ok(value.trim().length > 0, `${at} 是空的`);
    for (const [key, item] of Object.entries(value)) walk(item, `${at}.${key}`);
  };
  walk(demo, 'hero-demo');
  walk(demoEn, 'hero-demo.en');
});

test('首屏：有演示的文案就留演示的位置，文案原样写在 data-demo-copy 里（data-copy 是复制按钮用的）；没有就退回图标，不留空位', () => {
  const t = { hero: { h1: '十个角色，按顺序把你的需求做完', sub: '副标题', note: '', ctaStar: '点星' } };
  const page = String(render({ t, config, heroDemo: demo }));
  const attr = page.match(/data-demo-copy="([^"]*)"/);
  assert.ok(attr, '没有 data-demo-copy');
  const decoded = attr[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  assert.deepEqual(JSON.parse(decoded), demo);
  assert.ok(!/class="hero hero--no-demo"/.test(page));

  const bare = String(render({ t, config }));
  assert.ok(!bare.includes('data-hero-demo'), '没有文案时还留着演示的位置');
  assert.ok(/class="hero hero--no-demo"/.test(bare), '没有文案时首屏没有标 hero--no-demo（会按演示的版式排、却没有演示）');
});

test('设计尺寸：字放大到 1.45 倍为止，舞台缩放以后正好填满留给它的地方', () => {
  // 宽屏版式（1920 × 955 上右栏那一块，609 见方）：设计宽停在下限，按宽度缩放
  const wide = designSize(609, 609);
  assert.equal(wide.width, MIN_W);
  assert.equal(wide.height, Math.round((609 * MIN_W) / 609));
  // 高屏版式（1878 × 1503 上的那一块）：字到 1.45 倍，终端变宽、变高
  const tall = designSize(1200, 1032);
  assert.equal(tall.width, Math.round(1200 / SCALE));
  assert.ok(Math.abs((tall.height * 1200) / tall.width - 1032) < 2, '缩放以后高度对不上留给它的地方');
  // 很宽：设计宽停在上限，再宽字才继续放大
  assert.equal(designSize(4000, 1500).width, MAX_W);
  // 小：不比下限窄；扁：不比下限矮
  assert.equal(designSize(500, 400).width, MIN_W);
  assert.equal(designSize(1400, 200).height, MIN_H);
  // 手机那一版（宽 358）：设计高按那块地方的长宽比
  assert.equal(designSize(350, 364).compactHeight, Math.round((364 * COMPACT_W) / 350));
  assert.equal(designSize(358, 372).compactHeight, 372);
  // 量不到尺寸（还没排版）：按原来的 720 × 540
  assert.deepEqual(designSize(0, 0), { width: 720, height: 540, compactHeight: 372 });
});

test('打包好的演示带着 Stageshow 的版权声明，许可证文件在源码旁边', () => {
  const license = read('tools', 'stage', 'kit', 'LICENSE');
  assert.match(license, /MIT License/);
  assert.match(license, /Benji Taylor/);
  for (const file of ['hero-demo.js', 'hero-demo.css']) {
    const head = read('src', 'assets', 'stage', file).slice(0, 200);
    assert.match(head, /Stageshow.*MIT License, Copyright \(c\) 2026 Benji Taylor/, `${file} 开头没有版权声明`);
  }
  assert.ok(existsSync(path.join(ROOT, 'tools', 'stage', 'package-lock.json')), 'tools/stage 没有锁文件，npm ci 装不出同样的依赖');
});
