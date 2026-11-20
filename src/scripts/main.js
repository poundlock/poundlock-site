// 浏览器端入口。页面不靠它也读得通：这里只做增强。
// 约定：每个功能模块各自动态导入、各自包在 try/catch 里初始化，一个加载不出来或抛错，不影响别的。

import { prefersReducedMotion } from './motion.js';
import { loadStars, mountStars } from './stars.js';

const root = document.documentElement;
let reduced = prefersReducedMotion(window);

function setMotionClass() {
  root.classList.toggle('motion-reduced', reduced);
  root.classList.toggle('motion-ok', !reduced);
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
const FEATURES = [['./lock.js', 'initLock', '[data-lock]']];

async function start(path, init, selector, anime) {
  const element = document.querySelector(selector);
  if (!element) return;
  try {
    const module = await import(path);
    module[init](element, anime, { reduced });
  } catch (error) {
    console.warn(`[poundlock] ${path} 没起来，这一块保持静态。`, error);
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
}

boot();
