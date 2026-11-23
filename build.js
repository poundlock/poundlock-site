// 生成脚本：把页面模板和文案生成成静态站点。不带任何依赖。
//   node build.js            生成到 dist/（先清空 dist/）
//   build({ outDir, ... })   给测试和部署脚本用；它只往 outDir 里写，从不删东西

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './site.config.js';
import { renderPage } from './src/page.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(ROOT, 'src');

// 样式按这个次序拼成 assets/site.css（相对 src/styles/）。
const STYLES = ['tokens.css', 'base.css', 'layout.css', 'sections/header.css', 'sections/hero.css', 'sections/pain.css', 'sections/lock.css', 'sections/breach.css', 'sections/contract.css', 'sections/roster.css', 'sections/limits.css', 'sections/install.css', 'sections/footer.css'];

// 原样复制的目录：[src/ 下的来源, 输出里 assets/ 下的去处]。来源不在就跳过。
const COPIES = [
  ['scripts', 'scripts'],
  ['vendor', 'vendor'],
  ['assets', ''],
];

// 过闸那一节的画面清单（tools/reef/encode.py 写的）。没有这个文件，页面就不带这一路画面。
async function loadReef() {
  const file = path.join(SRC, 'assets', 'reef', 'manifest.json');
  return existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : null;
}

async function loadCopy(code) {
  return JSON.parse(await readFile(path.join(SRC, 'copy', `${code}.json`), 'utf8'));
}

// reef：不传就读 src/assets/reef/manifest.json；传 null 是有意不带过闸的那一路画面（页面用平面的图）。
export async function build({ outDir = 'dist', siteUrl = config.siteUrl, version = 'dev', commit = '', reef } = {}) {
  const out = path.resolve(ROOT, outDir);
  const assets = path.join(out, 'assets');
  await mkdir(assets, { recursive: true });

  const css = await Promise.all(STYLES.map((name) => readFile(path.join(SRC, 'styles', name), 'utf8')));
  await writeFile(path.join(assets, 'site.css'), css.join('\n'));

  for (const [from, to] of COPIES) {
    const source = path.join(SRC, from);
    if (existsSync(source)) await cp(source, path.join(assets, to), { recursive: true });
  }

  const reefManifest = reef === undefined ? await loadReef() : reef;
  // 首屏演示里终端的字：插件本身是中文的，中英两页用同一份
  const heroDemo = await loadCopy('hero-demo');
  const pages = [];
  for (const lang of config.langs) {
    const ctx = {
      lang,
      t: await loadCopy(lang.code),
      heroDemo,
      base: lang.path ? '../'.repeat(lang.path.split('/').filter(Boolean).length) : '',
      config: { ...config, siteUrl },
      version,
      reef: reefManifest,
    };
    const dir = path.join(out, lang.path);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'index.html'), renderPage(ctx));
    pages.push(`${lang.path}index.html`);
  }

  await writeFile(path.join(out, 'version.json'), JSON.stringify({ version, commit, builtAt: new Date().toISOString() }) + '\n');
  await writeFile(path.join(out, '.nojekyll'), '');
  return { pages };
}

function isMain() {
  if (!process.argv[1]) return false;
  const here = fileURLToPath(import.meta.url);
  const entry = path.resolve(process.argv[1]);
  return process.platform === 'win32' ? here.toLowerCase() === entry.toLowerCase() : here === entry;
}

if (isMain()) {
  const dist = path.join(ROOT, 'dist');
  await rm(dist, { recursive: true, force: true });
  const { pages } = await build({ outDir: dist });
  console.log(`已生成 ${pages.length} 页到 ${dist}`);
}
