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

// 只给点了名的核对用的视口（不进默认那三种，免得全跑再慢三分之一）：
// tall 是偏方又够高的窗口（首屏不撑满一整屏，最高 1120，终端照样在右边）；tall-narrow 是不到 1000 宽的高窗口，
// 右栏窄于 600，演示换成手机那一版、照样左右排。
export const EXTRA_VIEWPORTS = [
  { name: 'tall', width: 1600, height: 1250 },
  { name: 'tall-narrow', width: 980, height: 1200 },
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
    else if (argv[i] === '--record') args.record = true;
  }
  return args;
}

const GPU_ARGS = ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'];

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
    // 首屏的水面：有显卡的浏览器里，打开几秒以后它还在画，没有被当成「画不动」关掉。
    // 出过这个事：别的模块在页面一打开时加载，卡了一下，帧率看门狗误判，把水面换成了静态的底。
    name: 'water-live',
    engines: ['chromium'],
    viewports: ['1440', '360'],
    async run({ page, url }) {
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForTimeout(6500);
      const mode = await page.evaluate(() => document.querySelector('[data-water]').dataset.mode);
      expect(mode === 'webgl', `打开六秒多以后，水面的 data-mode 是 ${mode}`);
      // 从头到尾慢慢滚一遍再滚回来（过闸的三维场景会在中途加载），水面还得是活的。
      await page.evaluate(async () => {
        document.documentElement.style.scrollBehavior = 'auto';
        const total = document.documentElement.scrollHeight - innerHeight;
        for (let i = 0; i <= 20; i++) {
          scrollTo(0, (total * i) / 20);
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
        scrollTo(0, 0);
      });
      await page.waitForTimeout(3500);
      const after = await page.evaluate(() => document.querySelector('[data-water]').dataset.mode);
      expect(after === 'webgl', `滚了一圈回到页顶，水面的 data-mode 是 ${after}`);
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
      expect((await page.locator('#hero .btn').count()) === 1, '首屏的「点星」按钮不在');
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
    // 过闸粘住时滚轮一格走一段（lock.js 的 onWheel）：滚一下到下一段；一下子连着滚好几格也只走一段；
    // 最后一段往下、第一段往上照常滚出这一节。
    name: 'lock-wheel',
    viewports: ['1440'],
    async run({ page, url }) {
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForSelector('[data-lock][data-lock-live]', { timeout: 8000 });
      const where = () =>
        page.evaluate(() => {
          const rect = document.querySelector('[data-lock-track]').getBoundingClientRect();
          return { beat: document.querySelector('[data-lock]').dataset.beat, top: rect.top, bottom: rect.bottom - window.innerHeight };
        });
      await scrollLockTo(page, 0.002);
      await page.waitForTimeout(800);
      await page.mouse.move(720, 450);
      await page.mouse.wheel(0, 100);
      await page.waitForTimeout(1300);
      let w = await where();
      expect(w.beat === '1', `滚一格以后是第 ${w.beat} 拍，应当是 1`);
      await page.evaluate(async () => {
        for (let i = 0; i < 5; i++) {
          window.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, cancelable: true, bubbles: true }));
          await new Promise((resolve) => setTimeout(resolve, 30));
        }
      });
      await page.waitForTimeout(1300);
      w = await where();
      expect(w.beat === '2', `连着滚五格以后是第 ${w.beat} 拍，应当只走一段到 2`);
      await page.mouse.wheel(0, -100);
      await page.waitForTimeout(1300);
      w = await where();
      expect(w.beat === '1', `往上滚一格以后是第 ${w.beat} 拍，应当回到 1`);
      await scrollLockTo(page, 1);
      await page.waitForTimeout(800);
      await page.mouse.wheel(0, 100);
      await page.waitForTimeout(800);
      w = await where();
      expect(w.bottom < -20, `最后一段往下滚，页面没滚出这一节（轨道底边离视口底 ${Math.round(w.bottom)}）`);
      await scrollLockTo(page, 0);
      await page.waitForTimeout(800);
      await page.mouse.wheel(0, -100);
      await page.waitForTimeout(800);
      w = await where();
      expect(w.top > 20, `第一段往上滚，页面没滚回上一节（轨道顶离视口顶 ${Math.round(w.top)}）`);
    },
  },
  {
    // 过闸的新画面（一条鱼游过八段景，lock-reef.js）：挂上了、画布显示出来、平面那张图收起来；
    // 画面跟着滚动走（want 跟着进度）；八段的字读屏都读得到、说明不压到产物清单上；滚到头出水、页头换浅色。
    // 要 WebGL：无头的内核里 WebKit、Firefox 不一定开得了，所以只在 Chromium 上核（加了走显卡的参数）。
    name: 'lock-reef',
    engines: ['chromium'],
    viewports: ['1440', '820', '360'],
    async run({ page, url, shot, uncaught }) {
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForSelector('[data-lock][data-lock-live]', { timeout: 15000 });
      const state = () =>
        page.evaluate(() => {
          const root = document.querySelector('[data-lock]');
          const canvas = root.querySelector('[data-lock-canvas]');
          return {
            marked: root.hasAttribute('data-lock-film'),
            scene: root.dataset.lockScene ?? null,
            display: getComputedStyle(canvas).display,
            opacity: Number(getComputedStyle(canvas).opacity),
            want: Number(canvas.dataset.want),
            flat: getComputedStyle(root.querySelector('.lock__water .lock__scene')).visibility,
            day: root.hasAttribute('data-day'),
            hiddenStages: [...root.querySelectorAll('.lock__water .chamber')].filter((el) => getComputedStyle(el).visibility !== 'visible' || getComputedStyle(el).display === 'none').length,
            overlap: root.querySelector('.lock__water .chamber[data-current]').getBoundingClientRect().bottom - root.querySelector('.lock__water .lock__ledger').getBoundingClientRect().top,
            tiles: performance.getEntriesByType('resource').filter((e) => /\/assets\/reef\/mid\/\d+\.webp$/.test(e.name)).length,
          };
        });
      await scrollLockTo(page, 0.3);
      await page.waitForSelector('[data-lock][data-lock-film-ready][data-lock-scene="reef"]', { timeout: 25000 });
      await page.waitForTimeout(1500);
      let s = await state();
      expect(s.marked && s.scene === 'reef', `新画面没起来：${JSON.stringify(s)}`);
      expect(s.display === 'block' && s.opacity > 0.9, `画布没显示出来：${JSON.stringify(s)}`);
      expect(Math.abs(s.want - 0.3) < 0.02, `滚到 0.3，画面追到的是 ${s.want}`);
      expect(s.flat === 'hidden', '新画面起来了，平面那张图却没收起来');
      expect(s.tiles >= 1, '一块中景的长条图都没下');
      expect(!s.day, '才到第三拍就出水了');
      expect(s.hiddenStages === 0, `有 ${s.hiddenStages} 段被藏得读屏也读不到`);
      expect(s.overlap <= 1, `这一段的说明压到了产物清单上 ${Math.round(s.overlap)} 像素`);
      await shot('s3');
      await scrollLockTo(page, 0.56);
      await page.waitForTimeout(2500);
      s = await state();
      expect(s.overlap <= 1, `S5 的说明压到了产物清单上 ${Math.round(s.overlap)} 像素`);
      expect(Math.abs(s.want - 0.56) < 0.02, `滚到 0.56，画面追到的是 ${s.want}`);
      await shot('s5');
      await scrollLockTo(page, 1);
      await page.waitForTimeout(2500);
      s = await state();
      expect(s.scene === 'reef', `滚到头，画面成了 ${s.scene}（新画面中途退掉了）`);
      expect(s.day, '滚到头了还没出水');
      await shot('end');
      expect(uncaught.length === 0, `有未捕获的异常：${uncaught.join(' | ')}`);
    },
  },
  {
    // 没滚到过闸之前只下眼前那一两块长条图和鱼，不把十几 MB 都下了；滚进去以后再往前后备几块。
    name: 'reef-lazy',
    engines: ['chromium'],
    viewports: ['1440'],
    async run({ page, url }) {
      const got = new Set();
      page.on('request', (request) => {
        const m = /\/assets\/reef\/(mid|far|above)\/(\d+)(-aux)?\.webp$/.exec(request.url());
        if (m) got.add(`${m[1]}${m[2]}${m[3] ?? ''}`);
      });
      await page.goto(url, { waitUntil: 'load' });
      const has = await page.evaluate(() => Boolean(document.querySelector('[data-lock-canvas]').dataset.reef));
      if (!has) return;
      await page.waitForTimeout(7000);
      // 开头那一屏：中景一两块（各带一张辅助图）、远景一块
      expect(got.size >= 1 && got.size <= 6, `停在首屏七秒，下了 ${got.size} 块长条图：${[...got].join(' ')}`);
      expect(![...got].some((k) => k.startsWith('above')), '还在首屏就下了出水那一截的图');
      await scrollLockTo(page, 0.3);
      await page.waitForTimeout(5000);
      expect(got.size > 6, `滚进过闸五秒以后才下了 ${got.size} 块，没有往前后备`);
    },
  },
  {
    // 没有 WebGL（老设备、被策略关掉）：不挂新画面，退回平面的那张图，八拍照常走。
    name: 'lock-nowebgl',
    engines: ['chromium'],
    viewports: ['1440'],
    async setup({ context }) {
      await context.addInitScript(() => {
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {
          return kind === 'webgl' || kind === 'webgl2' || kind === 'experimental-webgl' ? null : original.call(this, kind, ...rest);
        };
      });
    },
    async run({ page, url, uncaught }) {
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForSelector('[data-lock][data-lock-live]', { timeout: 15000 });
      await scrollLockTo(page, 0.53);
      await page.waitForSelector('[data-lock][data-lock-scene="flat"]', { timeout: 15000 });
      const s = await page.evaluate(() => ({ marked: document.querySelector('[data-lock]').hasAttribute('data-lock-film'), flat: getComputedStyle(document.querySelector('.lock__water .lock__scene')).visibility }));
      expect(!s.marked, '没有 WebGL，却还标着画布版');
      expect(s.flat === 'visible', '平面那张图没显示出来');
      expect(uncaught.length === 0, `有未捕获的异常：${uncaught.join(' | ')}`);
    },
  },
  {
    // 过闸的长条图一块都下不来：退回平面的那张图，八拍照常走，水面照常从上往下退。
    name: 'lock-flat',
    engines: ['chromium'],
    viewports: ['1440', '360'],
    async run({ page, url, shot, uncaught }) {
      await page.route('**/assets/reef/**', (route) => route.abort());
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForSelector('[data-lock][data-lock-live]', { timeout: 15000 });
      await scrollLockTo(page, 0.53);
      await page.waitForSelector('[data-lock][data-lock-scene="flat"]', { timeout: 25000 });
      await page.waitForFunction(() => document.querySelector('[data-lock]').dataset.beat === '4', null, { timeout: 4000, polling: 100 }).catch(() => {});
      await page.waitForTimeout(900);
      const s = await page.evaluate(() => {
        const root = document.querySelector('[data-lock]');
        return {
          film: root.hasAttribute('data-lock-film'),
          beat: root.dataset.beat,
          flat: getComputedStyle(root.querySelector('.lock__water .lock__scene')).visibility,
          // 第四片（下标 3）这时应当已经注满：水那块矩形回到了原位。
          filled: root.querySelector('.lock__water .slab[data-slab="3"] .slab__water').style.transform,
        };
      });
      expect(!s.film, '长条图下不来，却还标着画布版');
      expect(s.beat === '4', `data-beat 是 ${s.beat}`);
      expect(s.flat === 'visible', '平面那张图没显示出来');
      expect(/translateY\(0(\.0+)?px\)/.test(s.filled), `第四片没注满：${s.filled}`);
      await shot('p53');
      expect(uncaught.length === 0, `有未捕获的异常：${uncaught.join(' | ')}`);
    },
  },
  {
    // 在过闸中间刷新：场景停在对应的那一拍。
    name: 'lock-reload',
    viewports: ['1440', '360'],
    async run({ page, url, engine }) {
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForSelector('[data-lock][data-lock-live]', { timeout: 8000 });
      await scrollLockTo(page, 0.6);
      await page.waitForTimeout(300);
      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector('[data-lock][data-lock-live]', { timeout: 8000 });
      await page.waitForTimeout(600);
      const state = await page.evaluate(() => ({
        beat: document.querySelector('[data-lock]').dataset.beat,
        rise: Number(getComputedStyle(document.querySelector('[data-header]')).getPropertyValue('--rise')),
      }));
      expect(state.beat === '4', `刷新后 data-beat 是 ${state.beat}，应当是 4`);
      expect(state.rise > 0.5 && state.rise < 0.7, `刷新后 --rise 是 ${state.rise}`);
      // 画面也得马上对上：访客已经在这一节里了，不该再等首屏的入场放完，更不该先闪一下平面图的开场。
      const flashed = await page.evaluate(() => {
        const root = document.querySelector('[data-lock]');
        const hasFilm = Boolean(root.querySelector('[data-lock-canvas]').dataset.reef);
        const flat = getComputedStyle(root.querySelector('.lock__water .lock__scene')).visibility;
        return { hasFilm, flat, scene: root.dataset.lockScene ?? null };
      });
      if (flashed.hasFilm) expect(flashed.flat === 'hidden', `刷新后不到一秒，平面图还露着（${flashed.flat}）`);
      // 等四秒：无头的 WebKit 里 WebGL 是软件模拟的，编着色器、画头一帧要两秒上下（真的 Safari 走显卡快得多）；
      // 要拦的是「等首屏的入场放完（3.5 秒）才挂」，那样会超过四秒。
      await page.waitForSelector('[data-lock][data-lock-scene]', { timeout: 4000 }).catch(() => {});
      const mounted = await page.evaluate(() => document.querySelector('[data-lock]').dataset.lockScene ?? null);
      expect(mounted !== null, '刷新后四秒多了，画面还没挂上');

      // 地址带着锚点（从别处点链接进来）再刷新：浏览器恢复到刷新前的位置，不能被拉回这一节的开头。
      // WebKit 不核：Safari 刷新带锚点的地址时自己就滚去锚点、不恢复原来的位置（查过，页面的脚本没有动滚动），
      // 那是这个浏览器的行为，在它上面所有网站都这样。
      if (engine === 'webkit') return;
      await page.goto(`${url}#lock`, { waitUntil: 'load' });
      await page.waitForSelector('[data-lock][data-lock-live]', { timeout: 8000 });
      await scrollLockTo(page, 0.6);
      await page.waitForTimeout(300);
      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector('[data-lock][data-lock-live]', { timeout: 8000 });
      await page.waitForTimeout(1500);
      const beat = await page.evaluate(() => document.querySelector('[data-lock]').dataset.beat);
      expect(beat === '4', `地址带着 #lock 刷新后 data-beat 是 ${beat}，应当还在第五拍（4）`);
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
      const rise = await page.evaluate(() => Number(getComputedStyle(document.querySelector('[data-header]')).getPropertyValue('--rise')));
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
          .waitForFunction(() => document.querySelector('[data-lock]').dataset.beat === '4', null, { timeout: 12000, polling: 100 })
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
      // 模块没起来时，这一节退回静态的清单：八段的名字都看得见。
      for (const stage of Object.values(t.lock.stages)) {
        expect(await page.locator('.lock__water .chamber__name', { hasText: stage.name }).first().isVisible(), `过闸的模块坏了以后，「${stage.name}」看不见`);
      }
      const sticky = await page.evaluate(() => getComputedStyle(document.querySelector('.lock__stage')).position);
      expect(sticky !== 'sticky', '过闸的模块坏了，这一节却还是粘住的舞台');
    },
  },
  {
    // 入口脚本整个没取到（断网、被拦）：过闸是静态的清单，八段都读得到；页头有底色，字不会压在浅色段上看不清。
    name: 'main-broken',
    viewports: ['1440', '360'],
    async setup({ context }) {
      await context.route('**/scripts/main.js', (route) => route.abort());
    },
    async run({ page, url, t, engine }) {
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForTimeout(600);
      for (const stage of Object.values(t.lock.stages)) {
        expect(await page.locator('.lock__water .chamber__name', { hasText: stage.name }).first().isVisible(), `入口脚本没取到，「${stage.name}」看不见`);
      }
      const state = await page.evaluate(() => ({
        sticky: getComputedStyle(document.querySelector('.lock__stage')).position,
        ground: Number(getComputedStyle(document.querySelector('.site-header'), '::before').opacity),
        marked: document.documentElement.classList.contains('script-failed'),
      }));
      expect(state.sticky !== 'sticky', '入口脚本没取到，过闸却还是粘住的舞台');
      expect(state.marked, '入口脚本没取到，<html> 上没有标 script-failed（页头的底色靠它）');
      // 底色的不透明度直接量。WebKit 不量：无头的 WebKit 读带过渡的伪元素，读出来一直是起点的值
      // （给页头加 data-scrolled 也一样读到 0），量不准；它上面只核上面那个标记。
      if (engine !== 'webkit') expect(state.ground > 0.5, `入口脚本没取到，固定的页头没有底色（不透明度 ${state.ground}）`);
    },
  },
  {
    // 矮的视口：小手机、横过来的手机、把浏览器放大到 200% 的窗口。
    // 放得下就照常演（字不能被裁、不能钻到页头底下、不能压到产物清单上）；放不下就退回静态的清单，八段都读得到。
    name: 'lock-short',
    viewports: ['360'],
    async run({ page, url, t, shot }) {
      for (const size of [
        { width: 390, height: 664, mode: 'stage' },
        { width: 375, height: 600, mode: 'stage' },
        { width: 375, height: 548, mode: 'static' },
        { width: 844, height: 390, mode: 'static' },
        { width: 720, height: 390, mode: 'static' },
        { width: 1024, height: 560, mode: 'stage' },
        { width: 1280, height: 620, mode: 'stage' },
      ]) {
        const where = `${size.width}×${size.height}`;
        await page.setViewportSize({ width: size.width, height: size.height });
        await page.goto(url, { waitUntil: 'load' });
        await page.waitForFunction(() => document.querySelector('#roster')?.dataset.rosterLive === 'true', null, { timeout: 8000 });
        await page.waitForTimeout(300);
        const mode = await page.evaluate(() => (getComputedStyle(document.querySelector('.lock__stage')).position === 'sticky' ? 'stage' : 'static'));
        expect(mode === size.mode, `${where}：过闸应当是${size.mode === 'stage' ? '粘住的舞台' : '静态的清单'}，现在是 ${mode}`);
        if (mode !== size.mode) continue;
        if (mode === 'static') {
          for (const stage of Object.values(t.lock.stages)) {
            expect(await page.locator('.lock__water .chamber__name', { hasText: stage.name }).first().isVisible(), `${where}：静态的清单里「${stage.name}」看不见`);
          }
          continue;
        }
        // 第一段、实现那一段（字最多）、业务验收那一段（带原话）。
        for (const fraction of [0.03, 0.56, 0.81]) {
          await scrollLockTo(page, fraction);
          await page.waitForTimeout(700);
          const fit = await page.evaluate(() => {
            const root = document.querySelector('[data-lock]');
            const stage = root.querySelector('.lock__stage').getBoundingClientRect();
            const header = document.querySelector('.site-header').getBoundingClientRect();
            const current = root.querySelector('.lock__water .chamber[data-current]');
            const ledger = root.querySelector('.lock__water .lock__ledger');
            const shown = getComputedStyle(ledger).display !== 'none';
            // 这一段里看得见的东西（名字、说明、角色）合起来的上下边。
            const parts = [...current.querySelectorAll('.chamber__head, .chamber__line, .chamber__roles, .chamber__note, .chamber__words')].filter((el) => el.getClientRects().length && getComputedStyle(el).display !== 'none');
            const top = Math.min(...parts.map((el) => el.getBoundingClientRect().top));
            const bottom = Math.max(...parts.map((el) => el.getBoundingClientRect().bottom));
            const floor = shown ? ledger.getBoundingClientRect().top : stage.bottom;
            return { id: current.dataset.stage, under: Math.round(header.bottom - top), over: Math.round(bottom - floor) };
          });
          expect(fit.under <= 1, `${where}：${fit.id} 的字钻到页头底下 ${fit.under} 像素`);
          expect(fit.over <= 1, `${where}：${fit.id} 的字超出了它的位置 ${fit.over} 像素（压到清单上或者被裁掉）`);
          if (fraction === 0.56) await shot(`${size.width}x${size.height}`);
        }
      }
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
      const heights = new Set();
      for (const attempt of attempts) {
        await page.click(`button[data-attempt="${attempt.id}"]`);
        await page.waitForTimeout(250);
        lit++;
        const state = await page.evaluate(() => ({
          out: document.querySelector('[data-breach-out]').textContent,
          lit: document.querySelectorAll('[data-gate][data-lit]').length,
          // 说明框看得见时（宽屏版式）它的高度；用户说「这块元素的高度随着 tab 的切换不要变」
          box: (() => {
            const wrap = document.querySelector('.breach__out-wrap');
            return wrap && getComputedStyle(wrap).display !== 'none' ? Math.round(wrap.getBoundingClientRect().height) : null;
          })(),
        }));
        if (state.box !== null) heights.add(state.box);
        expect(state.out.includes(t.breach.gates[attempt.gate].name), `点了 ${attempt.id}，右边没有出现「${t.breach.gates[attempt.gate].name}」`);
        expect(state.out.includes(t.breach.attempts[attempt.id].says), `点了 ${attempt.id}，右边不是它那句话`);
        expect(state.lit === lit, `点了 ${lit} 个，亮着的门禁是 ${state.lit} 个`);
        if (lit === 3) await shot('mid');
      }
      expect(heights.size <= 1, `点不同的办法，说明框的高度在变：${[...heights].join('、')}`);
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
    // 复制安装命令：浏览器给剪贴板时，按钮上的字换成「已复制」，剪贴板里就是那两条命令。
    name: 'copy-ok',
    engines: ['chromium'],
    viewports: ['1440', '360'],
    context: { permissions: ['clipboard-read', 'clipboard-write'] },
    async run({ page, url, t }) {
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForFunction(() => document.querySelector('#roster')?.dataset.rosterLive === 'true', null, { timeout: 8000 });
      const button = page.locator('#install button[data-copy]');
      await button.scrollIntoViewIfNeeded();
      await button.click();
      await page.waitForFunction((label) => document.querySelector('#install button[data-copy]').textContent.trim() === label, t.install.copied, { timeout: 3000 }).catch(() => {});
      const label = (await button.textContent()).trim();
      expect(label === t.install.copied, `点了复制，按钮上是「${label}」，应当是「${t.install.copied}」`);
      // Windows 的剪贴板会把换行换成回车加换行：比的时候不计这个。
      const clip = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n');
      const source = await page.locator('#install pre[data-copy-source]').textContent();
      expect(clip === source && clip.split('\n').length === 2, `剪贴板里不是那两条命令：${JSON.stringify(clip)}`);
      // 两秒后换回原来的字。
      await page.waitForTimeout(2300);
      const back = (await button.textContent()).trim();
      expect(back === t.install.copy, `两秒后按钮上是「${back}」，应当换回「${t.install.copy}」`);
    },
  },
  {
    // 浏览器不给剪贴板：把那段命令选中，按钮上的字提示访客自己复制。
    name: 'copy-fallback',
    viewports: ['1440', '360'],
    async run({ page, url, t }) {
      await page.addInitScript(() => {
        Object.defineProperty(Navigator.prototype, 'clipboard', { get: () => undefined, configurable: true });
      });
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForFunction(() => document.querySelector('#roster')?.dataset.rosterLive === 'true', null, { timeout: 8000 });
      const button = page.locator('#install button[data-copy]');
      await button.scrollIntoViewIfNeeded();
      await button.click();
      await page.waitForFunction((label) => document.querySelector('#install button[data-copy]').textContent.trim() === label, t.install.copyFallback, { timeout: 3000 }).catch(() => {});
      const label = (await button.textContent()).trim();
      expect(label === t.install.copyFallback, `没有剪贴板，按钮上是「${label}」，应当是「${t.install.copyFallback}」`);
      const picked = (await page.evaluate(() => getSelection().toString())).replace(/\r\n/g, '\n');
      const source = await page.locator('#install pre[data-copy-source]').textContent();
      expect(picked.trim() === source.trim(), `选中的不是那两条命令：${JSON.stringify(picked)}`);
    },
  },
  {
    // 团队那张图能用键盘看：聚焦到「架构师」，它亮起来，它连着的六条线（项目经理派给它的一条、它派出去的五条）也亮起来。
    name: 'roster-focus',
    viewports: ['1440'],
    async run({ page, url, shot }) {
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForFunction(() => document.querySelector('#roster')?.dataset.rosterLive === 'true', null, { timeout: 8000 });
      await page.evaluate(() => {
        document.documentElement.style.scrollBehavior = 'auto';
        document.getElementById('roster').scrollIntoView({ block: 'start' });
      });
      // 从它前面那个角色按 Tab 过来，走的是真的键盘焦点。
      await page.focus('[data-role-node="ui"]');
      await page.keyboard.press('Tab');
      const state = await page.evaluate(() => ({
        focused: document.activeElement?.dataset.roleNode,
        active: document.querySelector('[data-role-node="architect"]').hasAttribute('data-active'),
        edges: [...document.querySelectorAll('#roster [data-edge][data-active]')].map((path) => path.dataset.edge).sort(),
        linked: [...document.querySelectorAll('#roster [data-role-node][data-linked]')].map((node) => node.dataset.roleNode).sort(),
        outline: getComputedStyle(document.activeElement).outlineStyle,
        // 线画到了哪：每条亮着的线都得有长度（没被隐藏）。
        drawn: [...document.querySelectorAll('#roster [data-edge][data-active]')].every((path) => path.getBoundingClientRect().height > 10),
      }));
      expect(state.focused === 'architect', `按 Tab 以后焦点在 ${state.focused}，不在架构师上`);
      expect(state.active, '架构师聚焦了却没亮');
      const want = ['architect>android', 'architect>backend', 'architect>frontend', 'architect>ios', 'architect>ui', 'pm>architect'];
      expect(JSON.stringify(state.edges) === JSON.stringify(want), `亮着的线是 ${state.edges.join('、')}`);
      expect(JSON.stringify(state.linked) === JSON.stringify(['android', 'backend', 'frontend', 'ios', 'pm', 'ui']), `标出来的相关角色是 ${state.linked.join('、')}`);
      expect(state.outline !== 'none', '聚焦的角色上看不见焦点框');
      expect(state.drawn, '亮着的线没画出来');
      await shot('architect');
      await page.keyboard.press('Shift+Tab');
      await page.focus('body').catch(() => {});
      await page.evaluate(() => document.activeElement && document.activeElement.blur());
      const cleared = await page.evaluate(() => document.querySelectorAll('#roster [data-active]').length);
      expect(cleared === 0, `焦点移开以后还有 ${cleared} 处亮着`);
    },
  },
  {
    // 窄屏和大字号下不挤破：标了 data-fit 的字（按钮、角色名、阶段名）没有被裁掉，页面没有横向滚动。
    // 两种情形：360 宽；720 宽、根字号放大到 200%（相当于访客把浏览器的字调到最大）。
    name: 'fit',
    viewports: ['360'],
    async run({ page, url }) {
      for (const { width, height, font } of [
        { width: 360, height: 740, font: '' },
        { width: 720, height: 900, font: '200%' },
      ]) {
        await page.setViewportSize({ width, height });
        await page.goto(url, { waitUntil: 'load' });
        await page.evaluate((size) => {
          document.documentElement.style.fontSize = size;
        }, font);
        await page.waitForTimeout(400);
        const result = await page.evaluate(() => ({
          clipped: [...document.querySelectorAll('[data-fit]')]
            .filter((el) => el.getClientRects().length && el.scrollWidth > el.clientWidth + 1)
            .map((el) => `${el.textContent.trim().slice(0, 24)}（${el.scrollWidth} > ${el.clientWidth}）`),
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
        }));
        const where = `${width} 宽${font ? `、字号 ${font}` : ''}`;
        expect(result.clipped.length === 0, `${where}：这些字被裁掉了：${result.clipped.join('；')}`);
        expect(result.scrollWidth <= result.innerWidth + 1, `${where}：横向溢出，scrollWidth ${result.scrollWidth} > innerWidth ${result.innerWidth}`);
      }
    },
  },
  {
    // 只用键盘走完整页：每一个停下来的地方都在视口里、没被固定的页头盖住，而且看得见焦点。
    name: 'focus',
    engines: ['chromium', 'firefox'],
    viewports: ['1440', '360'],
    async run({ page, url }) {
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForFunction(() => document.querySelector('#roster')?.dataset.rosterLive === 'true', null, { timeout: 8000 });
      const stops = [];
      for (let i = 0; i < 80; i++) {
        await page.keyboard.press('Tab');
        // 焦点跳到视口外的东西上时，页面是平滑滚过去的：等它滚稳了再量。
        await page.evaluate(
          () =>
            new Promise((resolve) => {
              let last = -1;
              let calm = 0;
              let ticks = 0;
              const timer = setInterval(() => {
                calm = scrollY === last ? calm + 1 : 0;
                last = scrollY;
                if (calm >= 2 || ++ticks > 40) {
                  clearInterval(timer);
                  resolve();
                }
              }, 80);
            }),
        );
        const stop = await page.evaluate(() => {
          const el = document.activeElement;
          if (!el || el === document.body) return null;
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          // 元素中心那一点上，最上面的是不是它自己（或者它里面的东西）：不是，就是被别的盖住了。
          const cx = Math.min(innerWidth - 1, Math.max(0, rect.left + rect.width / 2));
          const cy = Math.min(innerHeight - 1, Math.max(0, rect.top + Math.min(rect.height, innerHeight) / 2));
          const top = document.elementFromPoint(cx, cy);
          return {
            what: (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 28),
            key: `${el.tagName}|${el.className}|${el.getAttribute('href') ?? ''}|${el.dataset.roleNode ?? ''}|${el.dataset.attempt ?? ''}`,
            inView: rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth,
            covered: !(top && (el === top || el.contains(top) || top.contains(el))),
            ring: style.outlineStyle !== 'none' || style.boxShadow !== 'none',
            // 页头里的东西：焦点框的颜色和页头的字色是不是同一个。
            header: el.closest('.site-header') ? { ring: style.outlineColor, ink: getComputedStyle(el.closest('.site-header')).color } : null,
          };
        });
        if (!stop) break;
        if (stops.length && stop.key === stops[0].key) break;
        stops.push(stop);
      }
      expect(stops.length >= 20, `按 Tab 只停了 ${stops.length} 处，页面上能点的东西不止这些`);
      const lost = stops.filter((stop) => !stop.inView).map((stop) => stop.what);
      const covered = stops.filter((stop) => stop.inView && stop.covered).map((stop) => stop.what);
      const bare = stops.filter((stop) => !stop.ring).map((stop) => stop.what);
      expect(lost.length === 0, `聚焦以后不在视口里：${lost.join('；')}`);
      expect(covered.length === 0, `聚焦以后被别的东西盖住了：${covered.join('；')}`);
      expect(bare.length === 0, `聚焦以后看不见焦点：${bare.join('；')}`);
      const pale = stops.filter((stop) => stop.header && stop.header.ring !== stop.header.ink).map((stop) => `${stop.what}（焦点框 ${stop.header.ring}，字 ${stop.header.ink}）`);
      expect(pale.length === 0, `页头里的焦点框没有跟着页头的字色走：${pale.join('；')}`);
    },
  },
  {
    // 换语言落在同一节：在「安装」那一节点页头的语言切换，到的是另一种语言的「安装」。
    name: 'lang-switch',
    viewports: ['1440', '360'],
    async run({ page, url, lang }) {
      await page.goto(`${url}#install`, { waitUntil: 'load' });
      await page.waitForFunction(() => document.querySelector('#roster')?.dataset.rosterLive === 'true', null, { timeout: 8000 });
      await page.waitForTimeout(400);
      await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.click('.site-header [data-lang-switch]')]);
      await page.waitForTimeout(600);
      const state = await page.evaluate(() => ({
        lang: document.documentElement.lang,
        hash: location.hash,
        top: Math.round(document.getElementById('install').getBoundingClientRect().top),
        height: innerHeight,
      }));
      const want = lang.code === 'zh' ? 'en' : 'zh';
      expect(state.lang.toLowerCase().startsWith(want), `从 ${lang.code} 切过去，页面的语言是 ${state.lang}`);
      expect(state.hash === '#install', `切过去以后地址上的锚点是「${state.hash}」，应当是 #install`);
      expect(state.top >= -4 && state.top < state.height * 0.5, `切过去以后「安装」这一节的顶边在 ${state.top}，不在视口上半截`);
    },
  },
  {
    // 首屏演示（tools/stage 打包的 React 终端）：挂得上、挂上时版式不跳、终端是完整的窗口（右边对齐内容区的右边线，
    // 单栏和高屏版式里左边也对齐左边线）、宽屏和高屏版式里整个终端都在首屏以内、不横向溢出、字是 hero-demo.json 里的。
    name: 'hero-demo',
    viewports: ['360', '820', '1440', 'tall', 'tall-narrow'],
    async run({ page, context, url, viewport, shot, lang }) {
      const demoFile = lang.code === 'zh' ? 'hero-demo.json' : `hero-demo.${lang.code}.json`;
      const demo = JSON.parse(await readFile(path.join(ROOT, 'src', 'copy', demoFile), 'utf8'));
      // 版式不跳：同一个页面开两次比。一次让演示的脚本一直不回来（只有样式里留好的位置），一次正常挂上。
      // 按布局位置比（offsetTop 一路加上去），不算 transform：挂上之前演示带着入场的 translateY(12px)。
      // 都等网页字体换好再量：英文页 360 宽时字体换上那一下副标题少一行，那是另一回事，原来就有。
      const layout = (target) =>
        target.evaluate(async () => {
          await document.fonts.ready;
          return ['.hero__copy', '.hero__demo', '#pain'].map((sel) => {
            const el = document.querySelector(sel);
            let top = 0;
            let left = 0;
            for (let node = el; node; node = node.offsetParent) {
              top += node.offsetTop;
              left += node.offsetLeft;
            }
            return [sel, left, top, el.offsetWidth, el.offsetHeight];
          });
        });
      const reserved = await context.newPage();
      await reserved.route('**/stage/hero-demo.js', () => {});
      await reserved.goto(url, { waitUntil: 'domcontentloaded' });
      await reserved.waitForTimeout(800);
      const before = await layout(reserved);
      await reserved.close();
      await page.goto(url, { waitUntil: 'load' });
      // 等 15 秒：无头的 WebKit 用 CPU 画水面的着色器，偶尔把整页拖慢，10 秒时有过一次没挂上（重跑都过）
      await page.waitForSelector('[data-hero-demo][data-ready]', { timeout: 15000 });
      await page.waitForTimeout(700);
      const after = await layout(page);
      expect(JSON.stringify(before) === JSON.stringify(after), `演示挂上前后版式变了：${JSON.stringify(before)} → ${JSON.stringify(after)}`);
      const m = await page.evaluate(() => {
        const box = (sel) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
        };
        return {
          noDemo: document.querySelector('.hero').classList.contains('hero--no-demo'),
          markShown: getComputedStyle(document.querySelector('.hero__mark')).display !== 'none',
          title: box('.hero__title'),
          copy: box('.hero__copy'),
          win: box('.ph-win'),
          // 内容区的两条边线：首屏去掉左右内边距（和页头的标志、右边的按钮一条线）
          lineLeft: (() => {
            const hero = document.querySelector('.hero');
            return hero.getBoundingClientRect().left + parseFloat(getComputedStyle(hero).paddingLeft);
          })(),
          lineRight: (() => {
            const hero = document.querySelector('.hero');
            return hero.getBoundingClientRect().right - parseFloat(getComputedStyle(hero).paddingRight);
          })(),
          text: document.querySelector('.ph-term')?.textContent ?? '',
          layout: document.querySelector('.ss-stage')?.dataset.layout,
          vw: document.documentElement.clientWidth,
          vh: innerHeight,
          scrollWidth: document.documentElement.scrollWidth,
        };
      });
      expect(!m.noDemo && m.win, '演示没挂上（hero 上标了 hero--no-demo，或者找不到终端窗口）');
      expect(!m.markShown, '演示挂上了，图标的三片还显示着');
      expect(m.text.includes(demo.allDone), `终端里没有「${demo.allDone}」，文案不是从 ${demoFile} 来的？`);
      // 终端是一扇完整的窗口：右边对齐内容区的右边线，不出画、不贴屏幕边
      expect(Math.abs(m.win.right - m.lineRight) <= 2, `终端的右边 ${Math.round(m.win.right)} 没对齐内容区的右边线 ${Math.round(m.lineRight)}`);
      expect(m.win.right < m.vw, `终端的右边 ${Math.round(m.win.right)} 跑出了屏幕（${m.vw}）`);
      expect(m.scrollWidth <= m.vw + 1, `横向溢出：scrollWidth ${m.scrollWidth} > ${m.vw}`);
      // 901 宽起一律左右排（高屏也是，2026-11-23 起）；右栏窄于 600 时演示用手机那一版
      const split = viewport.width >= 901;
      if (split) {
        expect(m.win.left >= m.copy.right, `宽屏版式里终端（左边 ${Math.round(m.win.left)}）压到了左边的字上（${Math.round(m.copy.right)}）`);
      } else {
        expect(Math.abs(m.win.left - m.lineLeft) <= 2, `终端的左边 ${Math.round(m.win.left)} 没对齐内容区的左边线 ${Math.round(m.lineLeft)}`);
        expect(Math.abs(m.win.left - m.title.left) <= 2, `终端的左边 ${Math.round(m.win.left)} 没对齐标题的左边 ${Math.round(m.title.left)}`);
      }
      if (split) {
        expect(m.win.bottom <= m.vh, `终端的底边在 ${Math.round(m.win.bottom)}，超出了首屏（${m.vh}），输入框被挤到了首屏外面`);
        const want = m.win.right - m.win.left >= 600 ? 'wide' : 'compact';
        expect(m.layout === want, `终端 ${Math.round(m.win.right - m.win.left)} 宽，演示应当用 ${want} 那一版，用的是 ${m.layout}`);
      }
      await shot('hero');
    },
  },
  {
    // 回车的键帽亮起来时整个落在输入框里面，不压在边框上（它的位置是量出来写死的，改了终端的内边距会走样）。
    name: 'hero-demo-keycap',
    engines: ['chromium'],
    viewports: ['1440', '360'],
    langs: ['zh'],
    async run({ page, url }) {
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForSelector('.ss-keys[data-show="true"]', { timeout: 30000 });
      await page.waitForTimeout(150);
      const m = await page.evaluate(() => {
        const box = (el) => {
          const r = el.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
        };
        return { key: box(document.querySelector('.ss-keys[data-show="true"] .ss-key')), input: box(document.querySelector('.ph-input')) };
      });
      const inside = m.key.left > m.input.left && m.key.right <= m.input.right - 2 && m.key.top >= m.input.top + 2 && m.key.bottom <= m.input.bottom - 2;
      expect(inside, `键帽 ${JSON.stringify(m.key)} 没有整个落在输入框 ${JSON.stringify(m.input)} 里面`);
    },
  },
  {
    // 演示的脚本取不到：退回图标的三片，不抛错，首屏照常。
    name: 'hero-demo-fallback',
    viewports: ['1440', '360'],
    async setup({ context }) {
      await context.route('**/stage/hero-demo.js', (route) => route.abort());
    },
    async run({ page, url, uncaught }) {
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForFunction(() => document.querySelector('.hero').classList.contains('hero--no-demo'), null, { timeout: 8000 });
      const shown = await page.evaluate(() => getComputedStyle(document.querySelector('.hero__mark')).display !== 'none');
      expect(shown, '演示的脚本取不到，图标的三片也没显示');
      expect(uncaught.length === 0, `有未捕获的异常：${uncaught.join(' | ')}`);
    },
  },
  {
    // 省流量模式：不下演示（连样式也不取），首屏是图标的三片。
    name: 'hero-demo-savedata',
    viewports: ['360'],
    engines: ['chromium'],
    async setup({ context }) {
      await context.addInitScript(() => {
        Object.defineProperty(navigator, 'connection', { configurable: true, value: { saveData: true } });
      });
    },
    async run({ page, url }) {
      const asked = [];
      page.on('request', (request) => {
        if (request.url().includes('/stage/hero-demo')) asked.push(request.url());
      });
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForTimeout(1200);
      const state = await page.evaluate(() => ({
        noDemo: document.querySelector('.hero').classList.contains('hero--no-demo'),
        shown: getComputedStyle(document.querySelector('.hero__mark')).display !== 'none',
      }));
      expect(state.noDemo && state.shown, '省流量模式下首屏没有退回图标的三片');
      expect(asked.length === 0, `省流量模式下还是取了演示：${asked.join(' | ')}`);
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

// --record：录两段中文页的录屏（桌面 1440×900、手机 390×844），从页顶匀速滚到闯闸，再点两种办法。
// 用本机的 Chrome 有头模式录，水面才是显卡画的。录好的 webm 在 <out>/checkpoint/ 下。
async function record(playwright, baseUrl, outDir) {
  const dir = path.join(outDir, 'checkpoint');
  await mkdir(dir, { recursive: true });
  const sizes = [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'phone', width: 390, height: 844 },
  ];
  const browser = await playwright.chromium.launch({ channel: 'chrome', headless: false });
  const saved = [];
  try {
    for (const size of sizes) {
      const context = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        recordVideo: { dir, size: { width: size.width, height: size.height } },
      });
      await context.route('https://api.github.com/**', (route) =>
        route.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"Not Found"}' }),
      );
      const page = await context.newPage();
      await page.goto(baseUrl, { waitUntil: 'load' });
      await page.waitForSelector('[data-lock][data-lock-live]', { timeout: 8000 });
      await page.waitForTimeout(3600);
      // 匀速滚：先到过闸那一节的顶，再慢慢滚过它，最后到闯闸。
      const glide = (toSelector, edge, durationMs) =>
        page.evaluate(
          ({ selector, where, ms }) =>
            new Promise((resolve) => {
              document.documentElement.style.scrollBehavior = 'auto';
              const el = document.querySelector(selector);
              const rect = el.getBoundingClientRect();
              const target = window.scrollY + (where === 'bottom' ? rect.bottom - window.innerHeight : rect.top);
              const from = window.scrollY;
              const start = performance.now();
              const step = (now) => {
                const k = Math.min(1, (now - start) / ms);
                window.scrollTo(0, from + (target - from) * k);
                if (k < 1) requestAnimationFrame(step);
                else resolve();
              };
              requestAnimationFrame(step);
            }),
          { selector: toSelector, where: edge, ms: durationMs },
        );
      await glide('#pain', 'top', 1600);
      await page.waitForTimeout(1200);
      await glide('[data-lock-track]', 'top', 1800);
      await page.waitForTimeout(600);
      await glide('[data-lock-track]', 'bottom', 17000);
      await page.waitForTimeout(1400);
      await glide('#breach', 'top', 1500);
      await page.waitForTimeout(900);
      for (const id of ['skip-level', 'claim-done']) {
        const button = page.locator(`button[data-attempt="${id}"]`);
        await button.scrollIntoViewIfNeeded();
        await button.click();
        await page.waitForTimeout(2200);
      }
      const video = page.video();
      await context.close();
      const target = path.join(dir, `poundlock-${size.name}.webm`);
      await video.saveAs(target);
      await video.delete().catch(() => {});
      saved.push(target);
    }
  } finally {
    await browser.close();
  }
  return saved;
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
  if (args.record) {
    let saved = [];
    try {
      saved = await record(playwright, baseUrl, outDir);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
    for (const file of saved) console.log(`录屏：${file}`);
    process.exit(saved.length === 2 ? 0 : 1);
  }

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
      // 无头的 Chromium 默认用软件渲染 WebGL，三维的过闸在上面每秒只有几帧，会触发「画不动就换平面版」。
      // 加这几个参数让它用本机的显卡，和真的浏览器一样。
      const browser = await playwright[engine].launch(engine === 'chromium' ? { args: GPU_ARGS } : {});
      try {
        for (const check of checks) {
          if (check.engines && !check.engines.includes(engine)) continue;
          // 要用别的参数起浏览器的核对（比如关掉 WebGL），单独起一个。
          const own = check.launch ? await playwright[engine].launch(check.launch) : null;
          for (const lang of LANGS) {
            if (check.langs && !check.langs.includes(lang.code)) continue;
            for (const viewport of [...VIEWPORTS, ...EXTRA_VIEWPORTS]) {
              if (check.viewports ? !check.viewports.includes(viewport.name) : EXTRA_VIEWPORTS.includes(viewport)) continue;
              results.push(await runCheck(own ?? browser, engine, check, lang, viewport, baseUrl, outDir, copy));
            }
          }
          if (own) await own.close();
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
