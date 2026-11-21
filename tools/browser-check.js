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
    // 影片版的过闸：画布上画着东西，滚到哪画哪一帧；横屏用横版、竖屏用竖版；平面那张图收起来；滚到头天亮。
    name: 'lock-film',
    viewports: ['1440', '820', '360'],
    async run({ page, url, shot, uncaught }) {
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForSelector('[data-lock][data-lock-live]', { timeout: 15000 });
      const state = () =>
        page.evaluate(() => {
          const root = document.querySelector('[data-lock]');
          const canvas = root.querySelector('[data-lock-canvas]');
          const set = JSON.parse(canvas.dataset.film).sets[canvas.dataset.filmSet];
          // 画布上取一小块算平均亮度：画上了东西就不是 0。
          const pixels = canvas.getContext('2d').getImageData(Math.floor(canvas.width * 0.45), Math.floor(canvas.height * 0.35), 32, 32).data;
          let sum = 0;
          for (let i = 0; i < pixels.length; i += 4) sum += pixels[i] + pixels[i + 1] + pixels[i + 2];
          return {
            film: root.hasAttribute('data-lock-film'),
            display: getComputedStyle(canvas).display,
            opacity: Number(getComputedStyle(canvas).opacity),
            set: canvas.dataset.filmSet,
            frame: Number(canvas.dataset.frame),
            count: set ? set.count : 0,
            lit: sum / (32 * 32 * 3),
            flat: getComputedStyle(root.querySelector('.lock__water .lock__scene')).visibility,
            day: root.hasAttribute('data-day'),
            // 和 lock-film.js 的 pickSet 一个规则：又竖又窄（手机）才用竖版。
            wide: !(innerWidth < innerHeight && innerWidth <= 600),
            // 当前这一段的说明压到底下的产物清单上多少像素（不压是负数或 0）。
            overlap: root.querySelector('.lock__water .chamber[data-current]').getBoundingClientRect().bottom - root.querySelector('.lock__water .lock__ledger').getBoundingClientRect().top,
          };
        });
      // 等画面追到进度 fraction 对应的那一帧（这一带的帧要先下完，惯性要追上）。
      const settle = (fraction) =>
        page
          .waitForFunction(
            (f) => {
              const canvas = document.querySelector('[data-lock-canvas]');
              const set = JSON.parse(canvas.dataset.film).sets[canvas.dataset.filmSet];
              return set && Math.abs(Number(canvas.dataset.frame) - Math.round(f * (set.count - 1))) <= 1;
            },
            fraction,
            { timeout: 25000, polling: 200 },
          )
          .catch(() => {});
      await scrollLockTo(page, 0.3);
      // 画面是快滚到时才加载的：等它挂上、第一帧画出来。
      await page.waitForSelector('[data-lock][data-lock-scene="film"][data-lock-film-ready]', { timeout: 25000 });
      await settle(0.3);
      await page.waitForTimeout(800);
      let s = await state();
      expect(s.film, '影片版的过闸没起来');
      expect(s.display === 'block' && s.opacity > 0.9, `画布没显示出来：${JSON.stringify(s)}`);
      expect(s.set === (s.wide ? 'wide' : 'tall'), `这个视口该用${s.wide ? '横版' : '竖版'}，用的却是 ${s.set} 这一套`);
      expect(Math.abs(s.frame - Math.round(0.3 * (s.count - 1))) <= 1, `滚到 0.3，画的是第 ${s.frame} 帧（共 ${s.count} 帧）`);
      expect(s.lit > 2, `画布是黑的：${JSON.stringify(s)}`);
      expect(s.flat === 'hidden', '影片起来了，平面那张图却没收起来');
      expect(!s.day, '才到第三拍就天亮了');
      expect(s.overlap <= 1, `这一段的说明压到了产物清单上 ${Math.round(s.overlap)} 像素`);
      await shot('night');
      // 实现那一段（S5）的说明最长：它也不能压到清单上。
      await scrollLockTo(page, 0.56);
      await settle(0.56);
      await page.waitForTimeout(600);
      s = await state();
      expect(s.overlap <= 1, `S5 的说明压到了产物清单上 ${Math.round(s.overlap)} 像素`);
      await shot('s5');
      await scrollLockTo(page, 1);
      await settle(1);
      await page.waitForTimeout(600);
      s = await state();
      expect(s.frame === s.count - 1, `滚到头了，画的是第 ${s.frame} 帧，不是最后一帧（${s.count - 1}）`);
      expect(s.day, '滚到头了天还没亮');
      await shot('day');
      expect(uncaught.length === 0, `有未捕获的异常：${uncaught.join(' | ')}`);
    },
  },
  {
    // 影片一帧都下不来：退回平面的那张图，八拍照常走，水面照常从上往下退。
    name: 'lock-flat',
    engines: ['chromium'],
    viewports: ['1440', '360'],
    async run({ page, url, shot, uncaught }) {
      await page.route('**/assets/film/**', (route) => route.abort());
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForSelector('[data-lock][data-lock-live]', { timeout: 15000 });
      await scrollLockTo(page, 0.53);
      await page.waitForSelector('[data-lock][data-lock-scene="flat"]', { timeout: 15000 });
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
      expect(!s.film, '影片下不来，却还标着影片版');
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
            for (const viewport of VIEWPORTS) {
              if (check.viewports && !check.viewports.includes(viewport.name)) continue;
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
