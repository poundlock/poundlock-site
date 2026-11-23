import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from '../build.js';

const SITE_URL = 'https://example.test/x/';
const REPO_URL = 'https://github.com/poundlock/poundlock-skills';
const REPO_API = 'https://api.github.com/repos/poundlock/poundlock-skills';
const W3 = 'http://www.w3.org/';

let out;
let pages;

before(async () => {
  out = mkdtempSync(path.join(tmpdir(), 'poundlock-site-build-'));
  await build({ outDir: out, siteUrl: SITE_URL, version: '20261120', commit: 'abc' });
  pages = [
    { file: 'index.html', dir: out, text: readFileSync(path.join(out, 'index.html'), 'utf8') },
    { file: 'en/index.html', dir: path.join(out, 'en'), text: readFileSync(path.join(out, 'en', 'index.html'), 'utf8') },
  ];
});

const urlsIn = (text) => text.match(/https?:\/\/[^\s"'`<>)]+/g) ?? [];

test('生成两页和附带的文件', () => {
  for (const rel of [
    'index.html',
    'en/index.html',
    'version.json',
    '.nojekyll',
    'assets/site.css',
    'assets/scripts/main.js',
    'assets/logo/poundlock-tile.svg',
    'assets/social-preview.png',
  ]) {
    assert.ok(existsSync(path.join(out, rel)), `缺 ${rel}`);
  }
});

test('lang 属性', () => {
  assert.match(pages[0].text, /<html lang="zh-CN"/);
  assert.match(pages[1].text, /<html lang="en"/);
});

test('本地资源是相对地址而且文件在', () => {
  for (const page of pages) {
    const refs = [...page.text.matchAll(/\s(?:src|href)="([^"]*)"/g)].map((m) => m[1]);
    assert.ok(refs.length > 0, `${page.file} 里没找到 src 或 href`);
    for (const ref of refs) {
      if (/^(https?:|#|mailto:|data:)/.test(ref)) continue;
      assert.ok(!ref.startsWith('/'), `${page.file}：${ref} 以 / 开头`);
      let target = path.resolve(page.dir, ref.replace(/[?#].*$/, ''));
      if (ref === '' || ref.replace(/[?#].*$/, '').endsWith('/') || ref.replace(/[?#].*$/, '') === '') {
        target = path.join(target, 'index.html');
      }
      assert.ok(existsSync(target), `${page.file}：${ref} 指向的文件不存在`);
    }
  }
});

test('绝对地址只有站点自己和 GitHub', () => {
  for (const page of pages) {
    for (const url of urlsIn(page.text)) {
      assert.ok(
        [SITE_URL, REPO_URL, REPO_API, W3].some((prefix) => url.startsWith(prefix)),
        `${page.file}：不该出现 ${url}`,
      );
    }
  }
});

test('canonical 与 hreflang', () => {
  assert.ok(pages[0].text.includes(`<link rel="canonical" href="${SITE_URL}">`));
  assert.ok(pages[1].text.includes(`<link rel="canonical" href="${SITE_URL}en/">`));
  for (const page of pages) {
    assert.ok(page.text.includes(`<link rel="alternate" hreflang="zh-CN" href="${SITE_URL}">`), `${page.file} 缺 zh-CN`);
    assert.ok(page.text.includes(`<link rel="alternate" hreflang="en" href="${SITE_URL}en/">`), `${page.file} 缺 en`);
    assert.ok(page.text.includes(`<link rel="alternate" hreflang="x-default" href="${SITE_URL}">`), `${page.file} 缺 x-default`);
    assert.ok(page.text.includes(`<meta property="og:image" content="${SITE_URL}assets/social-preview.png">`), `${page.file} 缺 og:image`);
    assert.ok(page.text.includes('<meta name="twitter:card" content="summary_large_image">'), `${page.file} 缺 twitter:card`);
  }
});

test('html 上带取星标数的接口地址', () => {
  for (const page of pages) assert.ok(page.text.includes(`data-repo-api="${REPO_API}"`), page.file);
});

test('脚本和样式里没有第三方地址', () => {
  const scriptsDir = path.join(out, 'assets', 'scripts');
  const files = [
    path.join(out, 'assets', 'site.css'),
    ...readdirSync(scriptsDir).filter((name) => name.endsWith('.js')).map((name) => path.join(scriptsDir, name)),
  ];
  for (const file of files) {
    for (const url of urlsIn(readFileSync(file, 'utf8'))) {
      assert.ok([REPO_API, W3].some((prefix) => url.startsWith(prefix)), `${path.basename(file)}：不该出现 ${url}`);
    }
  }
});

test('version.json', () => {
  const info = JSON.parse(readFileSync(path.join(out, 'version.json'), 'utf8'));
  assert.equal(info.version, '20261120');
  assert.equal(info.commit, 'abc');
  assert.equal(typeof info.builtAt, 'string');
});

test('build 不删输出目录里原有的东西', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'poundlock-site-keep-'));
  const { writeFileSync } = await import('node:fs');
  writeFileSync(path.join(dir, 'keep.txt'), 'x');
  await build({ outDir: dir, siteUrl: SITE_URL });
  assert.ok(existsSync(path.join(dir, 'keep.txt')));
});

// 过闸那一节画布上的画面清单（一条鱼游过八段景的长条图；没有就是 null）。
function reefOf(text) {
  const tag = /<canvas[^>]*data-lock-canvas[^>]*>/.exec(text);
  assert.ok(tag, '页面里没有过闸的画布');
  const data = /data-reef="([^"]*)"/.exec(tag[0]);
  return data ? JSON.parse(data[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&')) : null;
}

test('带过闸的画面：画布上写着清单，地址相对各页自己', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'poundlock-site-reef-'));
  const reef = { viewH: 1.6, scenes: [{ key: 'coral', low: '#000000', high: '#ffffff' }], layers: { mid: { scale: 1, tiles: 2, x0: 0, tileM: 1.8 } } };
  await build({ outDir: dir, siteUrl: SITE_URL, reef });
  for (const [file, base] of [['index.html', 'assets/reef/'], ['en/index.html', '../assets/reef/']]) {
    const data = reefOf(readFileSync(path.join(dir, file), 'utf8'));
    assert.ok(data, `${file} 的画布上没有清单`);
    assert.equal(data.base, base);
    assert.deepEqual(data.layers, reef.layers);
  }
});

test('不带过闸的画面：画布上没有清单，页面用平面的那张图', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'poundlock-site-noreef-'));
  await build({ outDir: dir, siteUrl: SITE_URL, reef: null });
  for (const file of ['index.html', 'en/index.html']) assert.equal(reefOf(readFileSync(path.join(dir, file), 'utf8')), null);
});

test('不指定时，带不带过闸的画面看 src/assets/reef/manifest.json 在不在；在的话清单里的每一块都在', () => {
  const manifest = path.resolve('src', 'assets', 'reef', 'manifest.json');
  for (const page of pages) {
    const data = reefOf(page.text);
    if (!existsSync(manifest)) {
      assert.equal(data, null);
      continue;
    }
    assert.ok(data, `${page.file} 没带上过闸的画面`);
    for (const [name, layer] of Object.entries(data.layers)) {
      const files = readdirSync(path.join(out, 'assets', 'reef', name));
      for (let k = 0; k < layer.tiles; k++) assert.ok(files.includes(`${String(k).padStart(2, '0')}.webp`), `${name} 缺第 ${k} 块`);
    }
  }
});
