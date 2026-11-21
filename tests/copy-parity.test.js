import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as facts from '../src/facts.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (code) => JSON.parse(readFileSync(path.join(ROOT, 'src', 'copy', `${code}.json`), 'utf8'));
const zh = load('zh');
const en = load('en');

// 每个叶子一条：[键路径, 值]。数组带下标，所以数组长度不同时键路径也不同。
function leaves(value, prefix = '') {
  if (Array.isArray(value)) return value.flatMap((item, i) => leaves(item, `${prefix}[${i}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) => leaves(item, prefix ? `${prefix}.${key}` : key));
  }
  return [[prefix, value]];
}

const zhLeaves = leaves(zh);
const enLeaves = leaves(en);

test('中英的键路径和数组长度一致', () => {
  assert.deepEqual(zhLeaves.map(([key]) => key).sort(), enLeaves.map(([key]) => key).sort());
});

test('没有空文案', () => {
  for (const [code, list] of [['zh', zhLeaves], ['en', enLeaves]]) {
    for (const [key, value] of list) {
      assert.equal(typeof value, 'string', `${code}:${key} 不是字符串`);
      if (code === 'zh' && key === 'hero.note') continue;
      assert.ok(value.trim().length > 0, `${code}:${key} 是空的`);
    }
  }
});

test('键和 facts 对得上', () => {
  for (const t of [zh, en]) {
    assert.deepEqual(Object.keys(t.lock.stages), facts.stages.map((s) => s.id));
    assert.deepEqual(Object.keys(t.lock.roles).sort(), [...facts.roles].sort());
    assert.deepEqual(Object.keys(t.breach.attempts), facts.breach.map((b) => b.id));
    assert.deepEqual(Object.keys(t.breach.gates), facts.gates);
    assert.equal(t.contract.clauses.length, facts.contractDemo.length);
    assert.equal(t.install.firstRunSteps.length, facts.firstRun.length);
  }
});

test('定下来的首屏文案', () => {
  assert.equal(zh.hero.h1, '十个角色，按顺序把你的需求做完');
  assert.equal(zh.hero.note, '');
  // 标题末尾不带句号（和中文那句一致）：通扫时去掉的，字没动。
  assert.equal(en.hero.h1, 'Ten roles finish your requirement, in order');
  assert.equal(en.hero.note, 'The plugin itself runs in Chinese.');
});

test('文案红线', () => {
  for (const [key, value] of zhLeaves) {
    assert.ok(!value.includes('保证'), `zh:${key} 写了「保证」`);
    assert.ok(!value.includes('永不'), `zh:${key} 写了「永不」`);
    if (value.includes('沙箱')) assert.ok(value.includes('不是沙箱'), `zh:${key} 提到沙箱，但不是「不是沙箱」`);
  }
  for (const [key, value] of enLeaves) {
    assert.ok(!/guarantee/i.test(value), `en:${key} 写了 guarantee`);
    if (/sandbox/i.test(value)) assert.ok(/not a sandbox/i.test(value), `en:${key} 提到 sandbox，但不是 not a sandbox`);
  }
});

test('版本下限写在文案里时和 facts 一致', () => {
  for (const t of [zh, en]) {
    const text = JSON.stringify(t);
    assert.ok(text.includes(facts.floors.claudeCode));
    assert.ok(text.includes(facts.floors.node));
  }
});
