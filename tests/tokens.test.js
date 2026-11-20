import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../build.js';
import { contrast } from '../tools/contrast.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STYLES = path.join(ROOT, 'src', 'styles');
const tokens = () => readFileSync(path.join(STYLES, 'tokens.css'), 'utf8');

let out;
let siteCss;

before(async () => {
  out = mkdtempSync(path.join(tmpdir(), 'poundlock-site-tokens-'));
  await build({ outDir: out, siteUrl: 'https://example.test/x/' });
  siteCss = readFileSync(path.join(out, 'assets', 'site.css'), 'utf8');
});

after(() => rmSync(out, { recursive: true, force: true }));

// 取 :root 里的一个颜色变量；值要直接是六位十六进制色值。
function color(name) {
  const root = tokens().match(/:root\s*\{([\s\S]*?)\n\}/);
  assert.ok(root, 'tokens.css 里没有 :root');
  const value = root[1].match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`));
  assert.ok(value, `:root 里的 ${name} 要直接写六位十六进制色值`);
  return value[1];
}

test('contrast：黑白是 21，同色是 1', () => {
  assert.equal(Math.round(contrast('#000000', '#FFFFFF') * 100) / 100, 21);
  assert.equal(contrast('#13212B', '#13212B'), 1);
  assert.equal(contrast('#FFFFFF', '#000000'), contrast('#000000', '#FFFFFF'));
});

test('调色板的变量都在，而且是色值', () => {
  for (const name of [
    '--scene-0', '--scene-1', '--scene-glow',
    '--water-lo-0', '--mint-lo', '--water-mid-0', '--mint-mid', '--water-hi-0', '--mint-hi',
    '--blue-lo-0', '--blue-lo', '--blue-mid-0', '--blue-mid', '--blue-hi-0', '--blue-hi',
    '--zd-bg', '--zd-fg', '--zd-muted', '--zd-accent', '--zd-line', '--zd-raise', '--stage-glow', '--wave', '--tint', '--shade',
    '--zl-bg', '--zl-bg-2', '--zl-fg', '--zl-muted', '--zl-accent', '--zl-line',
    '--btn-d-0', '--btn-d-1', '--btn-d-fg', '--btn-d-glow', '--btn-l-0', '--btn-l-1', '--btn-l-fg', '--btn-l-glow',
    '--chip-d-0', '--chip-d-1', '--chip-d-fg', '--chip-l-0', '--chip-l-1', '--chip-l-fg',
  ]) {
    color(name);
  }
});

test('色值只写在 tokens.css 里', () => {
  // 各节的样式、SVG、脚本里不直接写色值（遮罩用的纯黑不算），换配色才只用改一个文件。
  const files = [
    ...['base.css', 'layout.css'].map((name) => path.join(STYLES, name)),
    ...['header', 'hero', 'pain', 'lock', 'breach'].map((name) => path.join(STYLES, 'sections', `${name}.css`)),
    ...['hero', 'lock', 'lock-scene', 'breach'].map((name) => path.join(ROOT, 'src', 'sections', `${name}.js`)),
  ];
  for (const file of files) {
    const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const found = (text.match(/#[0-9a-fA-F]{6}\b|rgba?\([^)]*\)/g) ?? []).filter((value) => !/^rgba?\(0,\s*0,\s*0/.test(value));
    assert.deepEqual(found, [], `${path.basename(file)} 里写死了颜色`);
  }
});

test('字体文件在仓库里', () => {
  const css = readFileSync(path.join(STYLES, 'base.css'), 'utf8') + tokens();
  const urls = [...css.matchAll(/@font-face\s*\{[^}]*?url\(["']?([^"')]+)["']?\)/g)].map((m) => m[1]);
  assert.ok(urls.length >= 3, `只找到 ${urls.length} 个 @font-face`);
  for (const url of urls) {
    assert.ok(!/^(https?:)?\/\//.test(url) && !url.startsWith('/'), `${url} 不是相对地址`);
    assert.ok(url.endsWith('.woff2'), `${url} 不是 woff2`);
    // 样式拼成 assets/site.css，url 相对它解析。
    assert.ok(existsSync(path.resolve(out, 'assets', url)), `${url} 指向的文件不在生成结果里`);
  }
});

test('深浅两种段都接上了语义色', () => {
  const css = tokens();
  for (const [selector, prefix] of [['[data-zone="deep"]', '--zd-'], ['[data-zone="light"]', '--zl-']]) {
    const at = css.indexOf(selector);
    assert.ok(at >= 0, `没有 ${selector} 的规则`);
    const block = css.slice(at, css.indexOf('}', at));
    for (const name of ['bg', 'fg', 'muted', 'accent', 'line']) {
      assert.ok(block.includes(`--${name}: var(${prefix}${name});`), `${selector} 里的 --${name} 没接到 ${prefix}${name}`);
    }
  }
  assert.ok(css.includes('[data-zone="rise"]'), '过闸那一节的段没有定义');
});

test('有减少动效的规则', () => {
  assert.match(siteCss, /prefers-reduced-motion/);
});

test('对比度到 AA', () => {
  const check = (fg, bg, what) => {
    const ratio = contrast(color(fg), color(bg));
    assert.ok(ratio >= 4.5, `${what}：${fg} 在 ${bg} 上只有 ${ratio.toFixed(2)}`);
  };
  // 深色段：字、次要的字、强调，在平的底上和面板亮的那一端上都要过。
  for (const bg of ['--zd-bg', '--zd-raise']) for (const fg of ['--zd-fg', '--zd-muted', '--zd-accent']) check(fg, bg, '深色段');
  // 首屏的字压在水面上：水面两端的颜色上都要过。
  for (const bg of ['--scene-0', '--scene-1']) for (const fg of ['--zd-fg', '--zd-muted']) check(fg, bg, '首屏');
  // 浅色段。
  for (const bg of ['--zl-bg', '--zl-bg-2']) for (const fg of ['--zl-fg', '--zl-muted', '--zl-accent']) check(fg, bg, '浅色段');
  // 按钮和小标签上的字。
  check('--btn-d-fg', '--btn-d-0', '深色段的主按钮');
  check('--btn-d-fg', '--btn-d-1', '深色段的主按钮');
  check('--btn-l-fg', '--btn-l-0', '浅色段的主按钮');
  check('--btn-l-fg', '--btn-l-1', '浅色段的主按钮');
  check('--chip-d-fg', '--chip-d-0', '深色段的小标签');
  check('--chip-d-fg', '--chip-d-1', '深色段的小标签');
  check('--chip-l-fg', '--chip-l-0', '浅色段的小标签');
  check('--chip-l-fg', '--chip-l-1', '浅色段的小标签');
});

test('中文字体的子集盖得住文案里的每个字', () => {
  const chars = new Set(readFileSync(path.join(ROOT, 'src', 'assets', 'fonts', 'zh-chars.txt'), 'utf8'));
  const copy = readFileSync(path.join(ROOT, 'src', 'copy', 'zh.json'), 'utf8');
  const missing = [...new Set(JSON.stringify(Object.values(JSON.parse(copy))))].filter(
    (ch) => /[⺀-鿿＀-￯　-〿]/.test(ch) && !chars.has(ch),
  );
  assert.deepEqual(missing, [], `这些字不在子集里，要重新裁字体：${missing.join('')}`);
});
