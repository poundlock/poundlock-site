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
const STYLES = [];

// 原样复制的目录：[src/ 下的来源, 输出里 assets/ 下的去处]。来源不在就跳过。
const COPIES = [
  ['scripts', 'scripts'],
  ['vendor', 'vendor'],
  ['assets', ''],
];

async function loadCopy(code) {
  return JSON.parse(await readFile(path.join(SRC, 'copy', `${code}.json`), 'utf8'));
}

export async function build({ outDir = 'dist', siteUrl = config.siteUrl, version = 'dev', commit = '' } = {}) {
  const out = path.resolve(ROOT, outDir);
  const assets = path.join(out, 'assets');
  await mkdir(assets, { recursive: true });

  const css = await Promise.all(STYLES.map((name) => readFile(path.join(SRC, 'styles', name), 'utf8')));
  await writeFile(path.join(assets, 'site.css'), css.join('\n'));

  for (const [from, to] of COPIES) {
    const source = path.join(SRC, from);
    if (existsSync(source)) await cp(source, path.join(assets, to), { recursive: true });
  }

  const pages = [];
  for (const lang of config.langs) {
    const ctx = {
      lang,
      t: await loadCopy(lang.code),
      base: lang.path ? '../'.repeat(lang.path.split('/').filter(Boolean).length) : '',
      config: { ...config, siteUrl },
      version,
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
