import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../build.js';
import { escapeHtml } from '../src/lib/html.js';
import * as facts from '../src/facts.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_URL = 'https://github.com/poundlock/poundlock-skills';
const load = (code) => JSON.parse(readFileSync(path.join(ROOT, 'src', 'copy', `${code}.json`), 'utf8'));

let out;
const pages = {};

before(async () => {
  out = mkdtempSync(path.join(tmpdir(), 'poundlock-site-pages-'));
  await build({ outDir: out, siteUrl: 'https://example.test/x/' });
  pages.zh = { t: load('zh'), text: readFileSync(path.join(out, 'index.html'), 'utf8') };
  pages.en = { t: load('en'), text: readFileSync(path.join(out, 'en', 'index.html'), 'utf8') };
});

after(() => rmSync(out, { recursive: true, force: true }));

const count = (text, needle) => text.split(needle).length - 1;
const openingTag = (text, id) => text.match(new RegExp(`<(?:section|footer)\\b[^>]*\\bid="${id}"[^>]*>`))?.[0];

for (const code of ['zh', 'en']) {
  test(`${code}：内容都在 HTML 里`, () => {
    const { t, text } = pages[code];
    const has = (value, what) => assert.ok(text.includes(escapeHtml(value)), `${what}：${value}`);
    for (const stage of facts.stages) has(t.lock.stages[stage.id].name, '阶段名');
    for (const role of facts.roles) has(t.lock.roles[role].name, '角色名');
    for (const role of facts.roles) has(t.lock.roles[role].job, '角色管什么');
    for (const gate of facts.gates) has(t.breach.gates[gate].name, '门禁名');
    for (const { id } of facts.breach) {
      has(t.breach.attempts[id].label, '偷懒的办法');
      has(t.breach.attempts[id].says, '门禁说的话');
    }
    for (const command of facts.install) has(command, '安装命令');
    for (const command of facts.firstRun) has(command, '第一次用的命令');
    has(facts.floors.claudeCode, 'Claude Code 的版本下限');
    has(facts.floors.node, 'Node 的版本下限');
    for (const stage of facts.stages) for (const artifact of stage.artifacts) has(artifact, '产物名');
    has(t.hero.h1, '主标题');
    has(t.breach.demoBadge, '演示的标注');
  });

  test(`${code}：钩子的数目`, () => {
    const { text } = pages[code];
    assert.equal(count(text, ' data-stage="'), 8);
    for (const stage of facts.stages) assert.equal(count(text, ` data-stage="${stage.id}"`), 1, stage.id);
    assert.equal(count(text, ' data-attempt="'), 6);
    assert.equal(count(text, ' data-gate="'), 6);
    assert.equal(count(text, ' data-role-node="'), 10);
    assert.equal(count(text, ' data-lock'), 1);
    assert.equal(count(text, ' data-breach-out'), 1);
    assert.equal(count(text, ' data-breach-all'), 1);
    assert.equal(count(text, ' data-copy-source'), count(text, ' data-copy '), '复制源和复制按钮要成对');
    const edges = Object.entries(facts.dispatch).flatMap(([from, list]) => list.map((to) => `${from}&gt;${to}`));
    for (const edge of edges) assert.equal(count(text, ` data-edge="${edge}"`), 1, edge);
    const stars = text.match(/<a\b[^>]*\sdata-star\b[^>]*>/g) ?? [];
    assert.ok(stars.length >= 2, `星标链接只有 ${stars.length} 个`);
    for (const tag of stars) assert.ok(tag.includes(`href="${REPO_URL}"`), tag);
    assert.equal(count(text, ' data-star-count'), stars.length, '每个星标链接里都要有放数字的位置');
  });

  test(`${code}：各节的 zone`, () => {
    const { text } = pages[code];
    const zones = { hero: 'deep', pain: 'deep', lock: 'rise', breach: 'light', contract: 'light', roster: 'light', limits: 'light', install: 'light', end: 'deep' };
    for (const [id, zone] of Object.entries(zones)) {
      const tag = openingTag(text, id);
      assert.ok(tag, `找不到 #${id}`);
      assert.ok(tag.includes(`data-zone="${zone}"`), `#${id} 的 zone 应当是 ${zone}：${tag}`);
    }
  });

  test(`${code}：页面里没有邮箱地址`, () => {
    assert.doesNotMatch(pages[code].text, /[\w.+-]+@[\w-]+\.[\w.]+/);
  });

  test(`${code}：页面里没有 emoji`, () => {
    assert.doesNotMatch(pages[code].text, /\p{Extended_Pictographic}/u);
  });
}

test('英文页说明运行时是中文', () => {
  assert.ok(pages.en.text.includes(escapeHtml(pages.en.t.hero.note)));
});

test('语言切换指向另一页', () => {
  assert.match(pages.zh.text, /<a\b[^>]*\shref="en\/"[^>]*\sdata-lang-switch/);
  assert.match(pages.en.text, /<a\b[^>]*\shref="\.\.\/"[^>]*\sdata-lang-switch/);
});
