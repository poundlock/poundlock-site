// 用 Playwright 逐引擎、逐语言、逐视口核对生成出来的页面，并截图。
//   node tools/browser-check.js [--engines chromium,webkit,firefox] [--only <名字>[,<名字>]] [--out .shots]
// 任何一条核对不过就以非零退出，并列出是哪条。截图存到 --out（不进仓库）。
// Playwright 不在 package.json 里：npm install --no-save playwright@1.65.1 && npx playwright install chromium webkit firefox

import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../build.js';
import { startServer } from './serve.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const VIEWPORTS = [
  { name: '360', width: 360, height: 740 },
  { name: '820', width: 820, height: 1180 },
  { name: '1440', width: 1440, height: 900 },
];

export const LANGS = [
  { code: 'zh', path: '' },
  { code: 'en', path: 'en/' },
];

const SECTION_IDS = ['hero', 'pain', 'lock', 'breach', 'contract', 'roster', 'limits', 'install', 'end'];

function parseArgs(argv) {
  const args = { engines: ['chromium'], only: null, out: '.shots' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--engines') args.engines = argv[++i].split(',');
    else if (argv[i] === '--only') args.only = argv[++i].split(',');
    else if (argv[i] === '--out') args.out = argv[++i];
  }
  return args;
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

// 每条核对：{ name, viewports?（默认全部）, context?（给 newContext 的额外选项）, stars?（'ok' | 'fail'）, run(env) }
// env = { page, url, lang, viewport, engine, shot(name), t（这门语言的文案）, expect }
export const CHECKS = [
  {
    name: 'console',
    async run({ page, url, errors }) {
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForTimeout(600);
      expect(errors.length === 0, `控制台有错误：${errors.join(' | ')}`);
    },
  },
  {
    name: 'overflow',
    async run({ page, url }) {
      await page.goto(url, { waitUntil: 'load' });
      const { scrollWidth, innerWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect(scrollWidth <= innerWidth, `横向溢出：scrollWidth ${scrollWidth} > innerWidth ${innerWidth}`);
    },
  },
  {
    name: 'shots',
    async run({ page, url, shot }) {
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForTimeout(800);
      await shot('top');
      for (const id of SECTION_IDS.slice(1)) {
        await page.evaluate((sectionId) => {
          document.documentElement.style.scrollBehavior = 'auto';
          document.getElementById(sectionId).scrollIntoView({ block: 'start' });
        }, id);
        await page.waitForTimeout(350);
        await shot(id);
      }
    },
  },
];

async function runCheck(browser, engine, check, lang, viewport, baseUrl, outDir, copy) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    ...(check.context ?? {}),
  });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(`未捕获：${error.message}`));
  await context.route('https://api.github.com/**', (route) =>
    check.stars === 'fail'
      ? route.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"Not Found"}' })
      : route.fulfill({ status: 200, contentType: 'application/json', body: '{"stargazers_count":1234}' }),
  );
  if (check.setup) await check.setup({ context, page });
  const label = `${engine}/${lang.code}/${viewport.name}/${check.name}`;
  const shot = (name) =>
    page.screenshot({ path: path.join(outDir, `${engine}-${lang.code}-${viewport.name}-${check.name}-${name}.png`) });
  try {
    await check.run({ page, context, url: baseUrl + lang.path, lang, viewport, engine, shot, errors, t: copy[lang.code], expect });
    return { label, ok: true };
  } catch (error) {
    await shot('FAILED').catch(() => {});
    return { label, ok: false, message: error.message.split('\n')[0] };
  } finally {
    await context.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let playwright;
  try {
    playwright = await import('playwright');
  } catch {
    console.error('找不到 playwright：先运行 npm install --no-save playwright@1.65.1 && npx playwright install chromium webkit firefox');
    process.exit(2);
  }
  const outDir = path.resolve(ROOT, args.out);
  await mkdir(outDir, { recursive: true });
  const dist = path.join(ROOT, 'dist');
  await build({ outDir: dist });
  const copy = {};
  for (const lang of LANGS) copy[lang.code] = JSON.parse(await readFile(path.join(ROOT, 'src', 'copy', `${lang.code}.json`), 'utf8'));

  const server = await startServer({ port: 0, dir: 'dist' });
  const baseUrl = `http://127.0.0.1:${server.address().port}/`;
  const checks = CHECKS.filter((check) => !args.only || args.only.includes(check.name));
  const results = [];
  try {
    for (const engine of args.engines) {
      const browser = await playwright[engine].launch();
      try {
        for (const check of checks) {
          if (check.engines && !check.engines.includes(engine)) continue;
          for (const lang of LANGS) {
            if (check.langs && !check.langs.includes(lang.code)) continue;
            for (const viewport of VIEWPORTS) {
              if (check.viewports && !check.viewports.includes(viewport.name)) continue;
              results.push(await runCheck(browser, engine, check, lang, viewport, baseUrl, outDir, copy));
            }
          }
        }
      } finally {
        await browser.close();
      }
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`核对 ${results.length} 项，通过 ${results.length - failed.length}，不过 ${failed.length}。截图在 ${outDir}`);
  for (const result of failed) console.log(`不过：${result.label}：${result.message}`);
  process.exit(failed.length ? 1 : 0);
}

function isMain() {
  if (!process.argv[1]) return false;
  const here = fileURLToPath(import.meta.url);
  const entry = path.resolve(process.argv[1]);
  return process.platform === 'win32' ? here.toLowerCase() === entry.toLowerCase() : here === entry;
}

if (isMain()) await main();
