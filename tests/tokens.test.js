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

// 图标的配色（主仓库 design/logo/README.md）。
const LOGO_COLORS = [
  '#11606A', '#08323F', '#7FE7D6', '#FFFFFF', '#D3F6EC', '#9AF0DD', '#4FD0BB', '#3CC4B0', '#128C84',
  '#F8F4EB', '#EAE3D5', '#2B7AAB', '#17507C', '#3A9AA6', '#226F86', '#49B6A4', '#23877E', '#13212B', '#F0F6FC',
];

let out;
let siteCss;

before(async () => {
  out = mkdtempSync(path.join(tmpdir(), 'poundlock-site-tokens-'));
  await build({ outDir: out, siteUrl: 'https://example.test/x/' });
  siteCss = readFileSync(path.join(out, 'assets', 'site.css'), 'utf8');
});

after(() => rmSync(out, { recursive: true, force: true }));

// 取某个 zone 规则块里的一个变量；值要直接是十六进制色值。
function zoneColor(zone, name) {
  const block = tokens().match(new RegExp(`\\[data-zone="${zone}"\\]\\s*\\{([^}]*)\\}`));
  assert.ok(block, `tokens.css 里没有 [data-zone="${zone}"] 的规则`);
  const value = block[1].match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`));
  assert.ok(value, `[data-zone="${zone}"] 里的 ${name} 要直接写六位十六进制色值`);
  return value[1];
}

test('contrast：黑白是 21，同色是 1', () => {
  assert.equal(Math.round(contrast('#000000', '#FFFFFF') * 100) / 100, 21);
  assert.equal(contrast('#13212B', '#13212B'), 1);
  assert.equal(contrast('#FFFFFF', '#000000'), contrast('#000000', '#FFFFFF'));
});

test('原始色照图标的配色', () => {
  const css = tokens().toLowerCase();
  for (const color of LOGO_COLORS) assert.ok(css.includes(color.toLowerCase()), `tokens.css 里没有 ${color}`);
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

test('三个 zone 都定义了语义色', () => {
  for (const zone of ['deep', 'rise', 'light']) {
    for (const name of ['--bg', '--fg', '--muted', '--accent', '--line']) zoneColor(zone, name);
  }
});

test('有减少动效的规则', () => {
  assert.match(siteCss, /prefers-reduced-motion/);
});

test('对比度到 AA', () => {
  const grounds = { deep: ['#11606A', '#08323F'], light: ['#F8F4EB', '#EAE3D5'] };
  for (const [zone, backgrounds] of Object.entries(grounds)) {
    assert.ok(backgrounds.map((c) => c.toLowerCase()).includes(zoneColor(zone, '--bg').toLowerCase()), `${zone} 的 --bg 要是它的底色之一`);
    for (const name of ['--fg', '--muted', '--accent']) {
      for (const background of backgrounds) {
        const ratio = contrast(zoneColor(zone, name), background);
        assert.ok(ratio >= 4.5, `${zone} 的 ${name} 在 ${background} 上只有 ${ratio.toFixed(2)}`);
      }
    }
  }
});

test('中文字体的子集盖得住文案里的每个字', () => {
  const chars = new Set(readFileSync(path.join(ROOT, 'src', 'assets', 'fonts', 'zh-chars.txt'), 'utf8'));
  const copy = readFileSync(path.join(ROOT, 'src', 'copy', 'zh.json'), 'utf8');
  const missing = [...new Set(JSON.stringify(Object.values(JSON.parse(copy))))].filter(
    (ch) => /[⺀-鿿＀-￯　-〿]/.test(ch) && !chars.has(ch),
  );
  assert.deepEqual(missing, [], `这些字不在子集里，要重新裁字体：${missing.join('')}`);
});
