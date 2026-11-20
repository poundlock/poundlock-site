// 用 Playwright 逐引擎、逐语言、逐视口核对生成出来的页面，并截图。
//   node tools/browser-check.js [--engines chromium,webkit,firefox] [--only <名字>[,<名字>]] [--out .shots]
// 任何一条核对不过就以非零退出，并列出是哪条。截图存到 --out（不进仓库）。
// Playwright 不在 package.json 里：npm install --no-save playwright@1.65.1 && npx playwright install chromium webkit firefox
//
// 说明：下面的 page.evaluate、page.$$eval 是 Playwright 的接口，把写死在这个文件里的函数放到
// 本机起的、自己生成的页面里运行，不是对字符串做 eval，也不接受外来的输入。

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
    else if (argv[i] === '--perf') args.perf = true;
  }
  return args;
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

// 把过闸那一节滚到它滚动范围的某个比例（0 是画面刚停住，1 是马上要放开）。
function scrollLockTo(page, fraction) {
  return page.evaluate((f) => {
    document.documentElement.style.scrollBehavior = 'auto';
    const track = document.querySelector('[data-lock-track]');
    const top = track.getBoundingClientRect().top + window.scrollY;
    const range = track.offsetHeight - window.innerHeight;
    window.scrollTo(0, Math.round(top + range * f));
  }, fraction);
}

async function expectStagesVisible(page, t) {
  for (const stage of Object.values(t.lock.stages)) {
    const visible = await page.locator('[data-stage]').getByText(stage.name, { exact: true }).first().isVisible();
    expect(visible, `阶段「${stage.name}」看不见`);
  }
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
    // 接口给了数：每个放数字的位置都显示出来。
    name: 'stars-ok',
    viewports: ['1440'],
    async run({ page, url }) {
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForFunction(() => [...document.querySelectorAll('[data-star-count]')].every((el) => !el.hidden), null, { timeout: 5000 });
      const texts = await page.$$eval('[data-star-count]', (els) => els.map((el) => el.textContent));
      expect(texts.length >= 2 && texts.every((text) => text === '1.2k'), `星标数显示的是 ${JSON.stringify(texts)}`);
    },
  },
  {
    // 接口不给数（仓库还没公开时就是 404）：只显示按钮，不留数字，不抛错。
    name: 'stars-fail',
    viewports: ['1440'],
    stars: 'fail',
    async run({ page, url, uncaught }) {
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForTimeout(800);
      const hidden = await page.$$eval('[data-star-count]', (els) => els.map((el) => el.hidden));
      expect(hidden.length >= 2 && hidden.every(Boolean), `接口 404 时星标数的 hidden 是 ${JSON.stringify(hidden)}`);
      expect(uncaught.length === 0, `有未捕获的异常：${uncaught.join(' | ')}`);
    },
  },
  {
    // 动效库没加载出来：整页退回静态，文字和按钮照常。
    name: 'no-anime',
    viewports: ['1440'],
    async setup({ context }) {
      await context.route('**/anime.esm.min.js', (route) => route.fulfill({ status: 404, body: 'not found' }));
    },
    async run({ page, url, uncaught, t }) {
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForFunction(() => document.documentElement.classList.contains('motion-reduced'), null, { timeout: 5000 });
      expect(await page.isVisible('#hero h1'), '主标题看不见');
      expect((await page.locator('#hero .btn').count()) === 2, '首屏的两个按钮不全');
      expect(await page.isVisible(`#hero a[data-star]`), '点星按钮看不见');
      expect((await page.innerText('#hero h1')).replace(/\s+/g, '') === t.hero.h1.replace(/\s+/g, ''), '主标题的字不对');
      expect(uncaught.length === 0, `有未捕获的异常：${uncaught.join(' | ')}`);
    },
  },
  {
    // 系统要求减少动效：水面是静态的，页面标着 motion-reduced。
    name: 'reduced',
    viewports: ['1440', '360'],
    context: { reducedMotion: 'reduce' },
    async run({ page, url, shot }) {
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForTimeout(500);
      const state = await page.evaluate(() => ({
        reduced: document.documentElement.classList.contains('motion-reduced'),
        ok: document.documentElement.classList.contains('motion-ok'),
        water: document.querySelector('[data-water]')?.dataset.mode,
      }));
      expect(state.reduced && !state.ok, `html 的类不对：${JSON.stringify(state)}`);
      expect(state.water === 'static', `水面的 data-mode 是 ${state.water}`);
      await shot('top');
    },
  },
  {
    // 过闸：滚到这一节滚动范围的几个位置，拍数对得上。
    name: 'lock-beats',
    async run({ page, url, shot }) {
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForSelector('[data-lock][data-lock-live]', { timeout: 8000 });
      // 取每一拍里面一点的位置，不取正好在两拍交界上的（滚动位置是整数像素，交界上会四舍五入到前一拍）。
      // 0.955 是水面正退到一半的时候，顺带截一张。
      const expected = { 0: '0', 0.28: '2', 0.53: '4', 0.78: '6', 0.955: '7', 1: '7' };
      for (const [fraction, beat] of Object.entries(expected)) {
        await scrollLockTo(page, Number(fraction));
        await page.waitForTimeout(1100);
        const got = await page.getAttribute('[data-lock]', 'data-beat');
        expect(got === beat, `滚到 ${fraction} 时 data-beat 是 ${got}，应当是 ${beat}`);
        await shot(`p${Math.round(Number(fraction) * 100)}`);
      }
    },
  },
  {
    // 在过闸中间刷新：场景停在对应的那一拍。
    name: 'lock-reload',
    viewports: ['1440', '360'],
    async run({ page, url }) {
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForSelector('[data-lock][data-lock-live]', { timeout: 8000 });
      await scrollLockTo(page, 0.6);
      await page.waitForTimeout(300);
      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector('[data-lock][data-lock-live]', { timeout: 8000 });
      await page.waitForTimeout(600);
      const state = await page.evaluate(() => ({
        beat: document.querySelector('[data-lock]').dataset.beat,
        rise: Number(getComputedStyle(document.documentElement).getPropertyValue('--rise')),
      }));
      expect(state.beat === '4', `刷新后 data-beat 是 ${state.beat}，应当是 4`);
      expect(state.rise > 0.5 && state.rise < 0.7, `刷新后 --rise 是 ${state.rise}`);
    },
  },
  {
    // 带着锚点直接进到后面的节：过闸算已经走完。
    name: 'lock-hash',
    viewports: ['1440'],
    async run({ page, url }) {
      await page.goto(`${url}#install`, { waitUntil: 'load' });
      await page.waitForSelector('[data-lock][data-lock-live]', { timeout: 8000 });
      await page.waitForTimeout(600);
      const rise = await page.evaluate(() => Number(getComputedStyle(document.documentElement).getPropertyValue('--rise')));
      expect(rise === 1, `从 #install 进来时 --rise 是 ${rise}`);
    },
  },
  {
    // 滚到一半改窗口大小：不溢出，重新滚到一半还是第五拍。
    name: 'lock-resize',
    viewports: ['1440'],
    async run({ page, url }) {
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForSelector('[data-lock][data-lock-live]', { timeout: 8000 });
      for (const size of [{ width: 1440, height: 900 }, { width: 820, height: 1180 }, { width: 360, height: 740 }]) {
        await page.setViewportSize(size);
        await scrollLockTo(page, 0.53);
        // 无头的 WebKit 出帧很慢（一秒一两帧），所以等到拍数对上为止，最多等 4 秒，不用固定的等待。
        await page
          .waitForFunction(() => document.querySelector('[data-lock]').dataset.beat === '4', null, { timeout: 4000, polling: 100 })
          .catch(() => {});
        const state = await page.evaluate(() => ({
          beat: document.querySelector('[data-lock]').dataset.beat,
          y: Math.round(window.scrollY),
          progress: document.querySelector('[data-lock]').style.getPropertyValue('--lock-progress'),
          overflow: document.documentElement.scrollWidth > window.innerWidth,
        }));
        expect(state.beat === '4', `${size.width} 宽时 data-beat 是 ${state.beat}（scrollY ${state.y}，--lock-progress ${state.progress}）`);
        expect(!state.overflow, `${size.width} 宽时横向溢出`);
      }
    },
  },
  {
    // 减少动效：这一节是静态的，八个阶段都看得见。
    name: 'lock-reduced',
    viewports: ['1440', '360'],
    context: { reducedMotion: 'reduce' },
    async run({ page, url, t, shot }) {
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForTimeout(400);
      const position = await page.evaluate(() => getComputedStyle(document.querySelector('.lock__stage')).position);
      expect(position !== 'sticky', `减少动效时 .lock__stage 的 position 是 ${position}`);
      await expectStagesVisible(page, t);
      await page.evaluate(() => document.getElementById('lock').scrollIntoView());
      await shot('static');
    },
  },
  {
    // 禁用脚本：八个阶段、十个角色都读得到。
    name: 'lock-nojs',
    viewports: ['1440'],
    context: { javaScriptEnabled: false },
    async run({ page, url, t }) {
      await page.goto(url, { waitUntil: 'load' });
      await expectStagesVisible(page, t);
      for (const role of Object.values(t.lock.roles)) {
        // 只看清单里带 data-role 的那些（水面以上那一层是装饰用的副本，静态版式里不显示）。
        const chip = page.locator('[data-role], [data-role-node]').filter({ hasText: role.name }).first();
        expect(await chip.isVisible(), `角色「${role.name}」看不见`);
      }
    },
  },
  {
    // 过闸的模块坏了（一导入就抛错）：别的照常，这一节还读得通。
    name: 'lock-broken',
    viewports: ['1440'],
    async setup({ context }) {
      await context.route('**/scripts/lock.js', (route) =>
        route.fulfill({ status: 200, contentType: 'text/javascript', body: 'throw new Error("故意弄坏的 lock.js");' }),
      );
    },
    async run({ page, url, t, uncaught }) {
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForFunction(() => [...document.querySelectorAll('[data-star-count]')].every((el) => !el.hidden), null, { timeout: 5000 });
      await page.waitForTimeout(500);
      expect(uncaught.length === 0, `有未捕获的异常：${uncaught.join(' | ')}`);
      // 模块没起来时，这一节停在第一拍的样子：第一段的名字看得见，其余的在 HTML 里。
      expect(await page.getByText(t.lock.stages.S1.name, { exact: true }).first().isVisible(), '第一段的名字看不见');
      const html = await page.content();
      for (const stage of Object.values(t.lock.stages)) expect(html.includes(stage.name), `HTML 里没有「${stage.name}」`);
    },
  },
  {
    // 闯闸：六个办法挨个点，每点一个，右边换成那道门禁说的话，对应的门禁亮起来；六个点完出收尾那句。
    name: 'breach-click',
    viewports: ['1440', '360'],
    async run({ page, url, t, shot }) {
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForSelector('#breach[data-breach-live]', { timeout: 8000 });
      expect(!(await page.isVisible('[data-breach-all]')), '还没点就显示了收尾那句');
      const attempts = await page.$$eval('button[data-attempt]', (els) => els.map((el) => ({ id: el.dataset.attempt, gate: el.dataset.gateRef })));
      expect(attempts.length === 6, `办法有 ${attempts.length} 个`);
      let lit = 0;
      for (const attempt of attempts) {
        await page.click(`button[data-attempt="${attempt.id}"]`);
        await page.waitForTimeout(250);
        lit++;
        const state = await page.evaluate(() => ({
          out: document.querySelector('[data-breach-out]').textContent,
          lit: document.querySelectorAll('[data-gate][data-lit]').length,
        }));
        expect(state.out.includes(t.breach.gates[attempt.gate].name), `点了 ${attempt.id}，右边没有出现「${t.breach.gates[attempt.gate].name}」`);
        expect(state.out.includes(t.breach.attempts[attempt.id].says), `点了 ${attempt.id}，右边不是它那句话`);
        expect(state.lit === lit, `点了 ${lit} 个，亮着的门禁是 ${state.lit} 个`);
        if (lit === 3) await shot('mid');
      }
      expect(await page.isVisible('[data-breach-all]'), '六个都点完了，收尾那句没出来');
      await page.waitForTimeout(900);
      await shot('done');
    },
  },
  {
    // 只用键盘：Tab 到办法上按 Enter，结果一样；焦点看得见。
    name: 'breach-keys',
    viewports: ['1440'],
    async run({ page, url, t }) {
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForSelector('#breach[data-breach-live]', { timeout: 8000 });
      await page.focus('button[data-attempt]');
      for (let i = 0; i < 6; i++) {
        const focus = await page.evaluate(() => {
          const el = document.activeElement;
          const style = getComputedStyle(el);
          return { attempt: el.dataset.attempt, outline: style.outlineStyle, width: parseFloat(style.outlineWidth) };
        });
        expect(Boolean(focus.attempt), `第 ${i + 1} 次 Tab 之后焦点不在办法上`);
        expect(focus.outline !== 'none' && focus.width >= 2, `焦点样式看不见：${JSON.stringify(focus)}`);
        await page.keyboard.press('Enter');
        await page.keyboard.press('Tab');
      }
      await page.waitForTimeout(200);
      expect((await page.locator('[data-gate][data-lit]').count()) === 6, '键盘走完，亮着的门禁不是 6 个');
      expect(await page.isVisible('[data-breach-all]'), '键盘走完，收尾那句没出来');
      expect((await page.textContent('[data-breach-out]')).length > 0, '右边是空的');
      void t;
    },
  },
  {
    // 减少动效：点了直接是关上的样子，话照样出来。
    name: 'breach-reduced',
    viewports: ['1440'],
    context: { reducedMotion: 'reduce' },
    async run({ page, url, t }) {
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForSelector('#breach[data-breach-live]', { timeout: 8000 });
      await page.click('button[data-attempt="edit-contract"]');
      const state = await page.evaluate(() => ({
        out: document.querySelector('[data-breach-out]').textContent,
        closed: document.querySelector('.breach__svg').dataset.closed,
      }));
      expect(state.out.includes(t.breach.gates.contract.name), '减少动效时点了没有出话');
      expect(state.closed === 'true', '减少动效时闸门没有直接关上');
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
  // errors：控制台的 error 加未捕获的异常；uncaught：只有未捕获的异常（故意让请求失败的核对只看它）。
  const errors = [];
  const uncaught = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => {
    errors.push(`未捕获：${error.message}`);
    uncaught.push(error.message);
  });
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
    await check.run({ page, context, url: baseUrl + lang.path, lang, viewport, engine, shot, errors, uncaught, t: copy[lang.code], expect });
    return { label, ok: true };
  } catch (error) {
    await shot('FAILED').catch(() => {});
    return { label, ok: false, message: error.message.split('\n')[0] };
  } finally {
    await context.close();
  }
}

// --perf：量帧率。无头模式的 WebGL 是软件渲染，数字不作数，所以用本机的 Chrome 有头模式（会弹出一个窗口）。
// CPU 降速 4 倍，在首屏停 5 秒、再匀速滚过整页，记每一帧的间隔。标准：没有连续三帧以上超过 50ms。
async function perf(playwright, baseUrl) {
  const browser = await playwright.chromium.launch({ channel: 'chrome', headless: false });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.route('https://api.github.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"stargazers_count":1234}' }),
    );
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await page.goto(baseUrl, { waitUntil: 'load' });
    await page.waitForTimeout(3200);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const measure = (scroll) =>
      page.evaluate(
        ({ durationMs, doScroll }) =>
          new Promise((resolve) => {
            const gaps = [];
            const total = document.documentElement.scrollHeight - window.innerHeight;
            const start = performance.now();
            let last = start;
            document.documentElement.style.scrollBehavior = 'auto';
            const step = (now) => {
              gaps.push(now - last);
              last = now;
              const progress = (now - start) / durationMs;
              if (doScroll) window.scrollTo(0, total * Math.min(progress, 1));
              if (progress < 1) requestAnimationFrame(step);
              else resolve(gaps.slice(1));
            };
            requestAnimationFrame(step);
          }),
        { durationMs: scroll ? 14000 : 5000, doScroll: scroll },
      );
    const report = (name, gaps) => {
      let run = 0;
      let worstRun = 0;
      for (const gap of gaps) {
        run = gap > 50 ? run + 1 : 0;
        worstRun = Math.max(worstRun, run);
      }
      const sorted = [...gaps].sort((a, b) => a - b);
      const fps = 1000 / (gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length);
      console.log(
        `${name}：平均 ${fps.toFixed(1)} 帧/秒，95 分位帧间隔 ${sorted[Math.floor(sorted.length * 0.95)].toFixed(1)}ms，` +
          `最长一帧 ${sorted[sorted.length - 1].toFixed(1)}ms，连续超过 50ms 的帧最多 ${worstRun} 个`,
      );
      return worstRun < 3;
    };
    const heroOk = report('首屏停 5 秒', await measure(false));
    const water = await page.evaluate(() => document.querySelector('[data-water]')?.dataset.mode);
    console.log(`水面：${water}`);
    const scrollOk = report('匀速滚过整页', await measure(true));
    return heroOk && scrollOk;
  } finally {
    await browser.close();
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
  if (args.perf) {
    let ok = false;
    try {
      ok = await perf(playwright, baseUrl);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
    console.log(ok ? '帧率：过' : '帧率：不过（有连续三帧以上超过 50ms）');
    process.exit(ok ? 0 : 1);
  }

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
