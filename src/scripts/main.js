// 浏览器端入口。页面不靠它也读得通：这里只做增强。
// 约定：每个功能模块各自动态导入、各自包在 try/catch 里初始化，一个加载不出来或抛错，不影响别的。

import { prefersReducedMotion } from './motion.js';
import { loadStars, mountStars } from './stars.js';

const root = document.documentElement;
let reduced = prefersReducedMotion(window);

function setMotionClass() {
  root.classList.toggle('motion-reduced', reduced);
  root.classList.toggle('motion-ok', !reduced);
  // 整页退回静态时，过闸那个粘住的舞台也收掉（它的样式挂在 stage-ok 上）。
  if (reduced) root.classList.remove('stage-ok');
}
setMotionClass();

// 星标数不等动效库。
loadStars({ api: root.dataset.repoApi }).then((n) => mountStars(document, n));

// 页头：离开页顶以后才垫上底色。
const header = document.querySelector('[data-header]');
if (header) {
  const mark = () => {
    header.dataset.scrolled = String(window.scrollY > 8);
  };
  window.addEventListener('scroll', mark, { passive: true });
  mark();
}

// [模块, 导出的初始化函数, 它要的根元素]。anime 是 null 时（减少动效，或者动效库没加载出来），各模块自己走静态的那一路。
const FEATURES = [
  ['./lock.js', 'initLock', '[data-lock]'],
  ['./breach.js', 'initBreach', '#breach'],
  ['./roster.js', 'initRoster', '#roster'],
  ['./copy-button.js', 'initCopyButtons', '#install'],
  ['./lang-switch.js', 'initLangSwitch', 'body'],
];

async function start(path, init, selector, anime) {
  const element = document.querySelector(selector);
  if (!element) return;
  try {
    const module = await import(path);
    await module[init](element, anime, { reduced });
  } catch (error) {
    console.warn(`[poundlock] ${path} 没起来，这一块保持静态。`, error);
    // 过闸没起来：收掉粘住的舞台，退回静态的清单——不然八段里有七段藏着，谁也读不到。
    if (selector === '[data-lock]') root.classList.remove('stage-ok');
  }
}

// 访客自己动过页面没有（滚轮、触摸、按键、点按）。
let touched = false;
for (const type of ['wheel', 'touchstart', 'keydown', 'pointerdown']) {
  window.addEventListener(
    type,
    () => {
      touched = true;
    },
    { once: true, passive: true },
  );
}

// 带着锚点打开页面时，浏览器在各模块接管之前就滚到了那一节；接管以后有的节高度变了
// （闯闸那块面板从一张清单变成左右两栏），有的浏览器（Safari）不会跟着调滚动位置，落点就偏了。
// 所以接管完补一次定位。访客自己已经动过页面就不补，不跟他抢。
// 只在「新打开」时补：刷新、后退回来的时候，浏览器恢复的是访客离开前的位置，不是锚点，补了反而把人拉走。
const navigation = performance.getEntriesByType('navigation')[0];
const freshVisit = !navigation || navigation.type === 'navigate';

function reanchor() {
  if (!freshVisit || touched || location.hash.length < 2) return;
  let target = null;
  try {
    target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
  } catch {
    return;
  }
  if (target) target.scrollIntoView({ block: 'start' });
}

// 首屏演示：打包好的 React 演示（tools/stage），挂上以后替掉图标的三片。减少动效时演示自己停在最后那一帧。
// 省流量模式不下；样式、脚本取不到或者挂的时候出错（文案不全也算），退回图标。
async function mountDemo() {
  try {
    const slot = document.querySelector('[data-hero-demo]');
    if (!slot) return;
    if (navigator.connection && navigator.connection.saveData) {
      slot.closest('.hero').classList.add('hero--no-demo');
      return;
    }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('../stage/hero-demo.css', import.meta.url).href;
    document.head.append(link);
    await new Promise((resolve) => {
      link.onload = resolve;
      link.onerror = resolve;
    });
    const { mountHeroDemo } = await import('../stage/hero-demo.js');
    mountHeroDemo(slot);
  } catch (error) {
    document.querySelector('.hero')?.classList.add('hero--no-demo');
    console.warn('[poundlock] 首屏演示没起来，退回图标。', error);
  }
}

async function boot() {
  // 水面不靠动效库。
  try {
    const canvas = document.querySelector('[data-water]');
    if (canvas) {
      const { mountWater } = await import('./water.js');
      mountWater(canvas, { reduced });
    }
  } catch (error) {
    console.warn('[poundlock] 水面没起来，用静态的底。', error);
  }

  // 首屏演示和下面那些各管各的：不等它下完再起别的（它的位置样式里已经留好，挂上时版式不跳）。
  mountDemo();

  let anime = null;
  if (!reduced) {
    try {
      anime = await import('../vendor/animejs/anime.esm.min.js');
    } catch (error) {
      // 动效库没加载出来：整页退回静态。
      reduced = true;
      setMotionClass();
      console.warn('[poundlock] 动效库没加载出来，整页保持静态。', error);
    }
  }

  await Promise.all(FEATURES.map(([path, init, selector]) => start(path, init, selector, anime)));
  reanchor();
}

boot();
