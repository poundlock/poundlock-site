// 原话、团队、安装三节的结构：样式和脚本靠这些钩子，读屏和没有脚本的访客靠这些内容。
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
const load = (code) => JSON.parse(readFileSync(path.join(ROOT, 'src', 'copy', `${code}.json`), 'utf8'));

let out;
const pages = {};

before(async () => {
  out = mkdtempSync(path.join(tmpdir(), 'poundlock-site-sections-'));
  await build({ outDir: out, siteUrl: 'https://example.test/x/', film: null });
  pages.zh = { t: load('zh'), text: readFileSync(path.join(out, 'index.html'), 'utf8') };
  pages.en = { t: load('en'), text: readFileSync(path.join(out, 'en', 'index.html'), 'utf8') };
});

after(() => rmSync(out, { recursive: true, force: true }));

// 一节的 HTML（从它的开始标签到下一节的开始标签之前）。
function section(text, id) {
  const start = text.search(new RegExp(`<(?:section|footer)\\b[^>]*\\bid="${id}"`));
  assert.ok(start >= 0, `没有 ${id} 这一节`);
  const rest = text.slice(start + 1);
  const next = rest.search(/<(?:section|footer)\b[^>]*\bid="/);
  return next < 0 ? text.slice(start) : text.slice(start, start + 1 + next);
}

const all = (text, pattern) => [...text.matchAll(pattern)];

// 谁派谁，反过来：每个角色由谁派。
const parentsOf = (role) => Object.entries(facts.dispatch).filter(([, list]) => list.includes(role)).map(([from]) => from);
const tierOf = (role) => (role === 'pm' ? 0 : parentsOf(role).includes('pm') ? 1 : 2);

for (const code of ['zh', 'en']) {
  test(`${code}：原话里被验收条目引到的每一段都标了出来，通过没通过和事实一致`, () => {
    const { t, text } = pages[code];
    const html = section(text, 'contract');
    const marks = all(html, /<mark class="contract__cite" data-verdict="(\w+)">([^<]*)<\/mark>/g);
    assert.deepEqual(marks.map((m) => m[1]), facts.contractDemo);
    assert.deepEqual(marks.map((m) => m[2]), t.contract.clauses.map((clause) => escapeHtml(clause.quote)));
    // 标出来的几段连同没标的字，拼回去就是原话，一个字不多不少。
    const quote = /<blockquote[^>]*>([\s\S]*?)<\/blockquote>/.exec(html)[1];
    assert.equal(quote.replace(/<[^>]+>/g, '').trim(), escapeHtml(t.contract.words));
    // 原话是跟在哪条命令后面写的。
    assert.match(html, new RegExp(`<code class="contract__cmd">${facts.firstRun[1].replace('/', '\\/')}</code>`));
  });

  test(`${code}：没通过的那一条引出返工，返工的说明和验收清单在一起`, () => {
    const { t, text } = pages[code];
    const html = section(text, 'contract');
    const check = /<div class="contract__check">([\s\S]*)<\/div>\s*<\/div>\s*<\/section>/.exec(html);
    assert.ok(check, '验收清单外面没有 contract__check');
    assert.ok(check[1].includes(escapeHtml(t.contract.reworkNote)), '返工的说明不在验收清单那一栏里');
    assert.equal(all(html, /<li class="clause" data-verdict="fail"/g).length, facts.contractDemo.filter((v) => v === 'fail').length);
  });

  test(`${code}：团队那张图——每个角色在第几层、由谁派，和花名册一致`, () => {
    const { t, text } = pages[code];
    const html = section(text, 'roster');
    const nodes = all(html, /<li class="role"[^>]*data-role-node="(\w+)"[^>]*data-tier="(\d)"[^>]*>([\s\S]*?)<\/li>/g);
    assert.deepEqual(nodes.map((n) => n[1]), facts.roles);
    for (const [, role, tier, body] of nodes) {
      assert.equal(Number(tier), tierOf(role), `${role} 的层`);
      const parents = parentsOf(role);
      if (!parents.length) {
        assert.doesNotMatch(body, /role__from/, `${role} 没有上级，不该写「由谁派」`);
        continue;
      }
      const from = /<span class="role__from">([^<]*)<\/span>/.exec(body);
      assert.ok(from, `${role} 没写由谁派`);
      for (const parent of parents) assert.ok(from[1].includes(escapeHtml(t.lock.roles[parent].name)), `${role} 的「由谁派」里没有 ${parent}`);
    }
  });

  test(`${code}：团队那张图——花名册里的每一条派发关系都画了一条线，不多不少`, () => {
    const html = section(pages[code].text, 'roster');
    const edges = all(html, /<path[^>]*data-edge="([^"]+)"/g).map((m) => m[1].replace('&gt;', '>'));
    const want = Object.entries(facts.dispatch).flatMap(([from, list]) => list.map((to) => `${from}>${to}`));
    assert.deepEqual([...edges].sort(), [...want].sort());
  });

  test(`${code}：安装命令能复制——两条命令各占一行，按钮带着两种结果的字`, () => {
    const { t, text } = pages[code];
    const html = section(text, 'install');
    const scope = /<div class="install__cmd" data-copy-scope>([\s\S]*?)<\/div>/.exec(html);
    assert.ok(scope, '命令和按钮外面没有 data-copy-scope');
    const pre = /<pre[^>]*data-copy-source[^>]*><code>([\s\S]*?)<\/code><\/pre>/.exec(scope[1]);
    assert.ok(pre, '没有 pre[data-copy-source]');
    assert.deepEqual(pre[1].split('\n'), facts.install.map(escapeHtml));
    const button = /<button[^>]*data-copy[^>]*>/.exec(scope[1]);
    assert.ok(button, '没有 button[data-copy]');
    assert.ok(button[0].includes(`data-label-copied="${escapeHtml(t.install.copied)}"`));
    assert.ok(button[0].includes(`data-label-fallback="${escapeHtml(t.install.copyFallback)}"`));
  });
}

test('六节的样式都拼进了 site.css', () => {
  const css = readFileSync(path.join(out, 'assets', 'site.css'), 'utf8');
  for (const selector of ['.contract__grid', '.roster__tree', '.limits__list', '.install__cmd', '.end__closing']) {
    assert.ok(css.includes(selector), `site.css 里没有 ${selector}`);
  }
});
