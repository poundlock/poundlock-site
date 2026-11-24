import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { hashOf, versionAssets } from '../src/lib/versions.js';

// 一个小站点：两页、一份样式（引用字体）、三个脚本（main 引 a 和 b、a 也引 b，还拿 new URL 引样式）
function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'poundlock-site-versions-'));
  const put = (rel, text) => {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text);
  };
  put('index.html', '<link rel="stylesheet" href="assets/site.css"><script type="module" src="assets/scripts/main.js"></script><a href="#top">x</a><a href="en/">en</a><a href="https://example.test/assets/site.css">abs</a>');
  put('en/index.html', '<link rel="stylesheet" href="../assets/site.css"><img src="../assets/logo.svg">');
  put('assets/site.css', '@font-face { src: url("fonts/a.woff2") format("woff2"); } .x { background: url(data:image/png;base64,AAAA); }');
  put('assets/fonts/a.woff2', 'FONT');
  put('assets/logo.svg', '<svg/>');
  put('assets/scripts/main.js', "import { a } from './a.js';\nconst more = ['./b.js', 'initB'];\nconst css = new URL('../site.css', import.meta.url);\nconst gone = './nope.js';\n");
  put('assets/scripts/a.js', "import { b } from './b.js';\nexport const a = b;\n");
  put('assets/scripts/b.js', 'export const b = 1;\n');
  return dir;
}
const read = (dir, rel) => readFileSync(path.join(dir, rel), 'utf8');
const V = /\?v=([0-9a-f]{10})/;

test('versionAssets：页面里引用的本地资源都带上按内容算的版本号，外部地址、锚点、目录不动', async () => {
  const dir = fixture();
  await versionAssets(dir, ['index.html', 'en/index.html']);
  const zh = read(dir, 'index.html');
  const css = read(dir, 'assets/site.css');
  assert.ok(zh.includes(`href="assets/site.css?v=${hashOf(css)}"`), zh);
  assert.ok(zh.includes(`src="assets/scripts/main.js?v=${hashOf(read(dir, 'assets/scripts/main.js'))}"`), zh);
  assert.ok(zh.includes('href="#top"') && zh.includes('href="en/"') && zh.includes('href="https://example.test/assets/site.css"'));
  const en = read(dir, 'en/index.html');
  assert.ok(en.includes(`href="../assets/site.css?v=${hashOf(css)}"`));
  assert.ok(en.includes(`src="../assets/logo.svg?v=${hashOf('<svg/>')}"`));
});

test('versionAssets：样式里的字体、脚本里的 import 和相对路径字符串都带上版本号；指向不存在的文件不动', async () => {
  const dir = fixture();
  await versionAssets(dir, ['index.html']);
  assert.ok(read(dir, 'assets/site.css').includes(`url("fonts/a.woff2?v=${hashOf('FONT')}")`));
  assert.ok(read(dir, 'assets/site.css').includes('url(data:image/png;base64,AAAA)'));
  const main = read(dir, 'assets/scripts/main.js');
  const b = hashOf(read(dir, 'assets/scripts/b.js'));
  assert.ok(main.includes(`from './a.js?v=${hashOf(read(dir, 'assets/scripts/a.js'))}'`), main);
  assert.ok(main.includes(`['./b.js?v=${b}'`), main);
  assert.ok(main.includes(`new URL('../site.css?v=${hashOf(read(dir, 'assets/site.css'))}'`), main);
  assert.ok(main.includes("'./nope.js'"));
  // 同一个模块不管谁引用，地址都一样（不然浏览器会把它当成两个模块各跑一遍）
  assert.ok(read(dir, 'assets/scripts/a.js').includes(`from './b.js?v=${b}'`));
});

test('versionAssets：一个文件变了，它和引用它的文件版本号都跟着变，别的不变', async () => {
  const one = fixture();
  await versionAssets(one, ['index.html']);
  const two = fixture();
  writeFileSync(path.join(two, 'assets/scripts/b.js'), 'export const b = 2;\n');
  await versionAssets(two, ['index.html']);
  const ver = (dir, re) => re.exec(read(dir, 'index.html'))[1];
  assert.notEqual(ver(one, /main\.js\?v=([0-9a-f]+)/), ver(two, /main\.js\?v=([0-9a-f]+)/));
  assert.equal(ver(one, /site\.css\?v=([0-9a-f]+)/), ver(two, /site\.css\?v=([0-9a-f]+)/));
  assert.notEqual(V.exec(read(one, 'assets/scripts/a.js'))[1], V.exec(read(two, 'assets/scripts/a.js'))[1]);
});

test('versionAssets：脚本互相引用成环时报错（算不出版本号），不悄悄生成错的', async () => {
  const dir = fixture();
  writeFileSync(path.join(dir, 'assets/scripts/b.js'), "import { a } from './a.js';\nexport const b = a;\n");
  await assert.rejects(versionAssets(dir, ['index.html']), /环/);
});
