// 动效的公共判断：系统要不要减少动效、帧率撑不撑得住、标签页看不看得见。
// 导入时不碰 window、document，Node 里能直接测。

export function prefersReducedMotion(win = window) {
  return Boolean(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

// 每帧调一次 tick()。最近 windowMs 里的平均帧率低于 minFps 时调一次 onDegrade，只调一次。
// 它要抓的是「这台设备一直画不动」，不是偶尔的卡顿，所以：
//   - 刚挂上的头 graceMs 不算：页面还在加载别的模块、编译着色器，主线程本来就忙；
//   - 中途单独卡一下（一帧隔了 hiccupMs 以上）不算，从这一帧重新开始数；
//   - 一帧隔了一秒以上，当成标签页切走又回来；连着三帧都这样才算真的卡死了。
export function createFpsWatchdog({ minFps = 40, windowMs = 2000, graceMs = 2500, hiccupMs = 250, onDegrade, now = () => performance.now() } = {}) {
  const STALL_MS = 1000;
  let frames = [];
  let first = null;
  let last = null;
  let stalls = 0;
  let done = false;

  const degrade = () => {
    done = true;
    if (onDegrade) onDegrade();
  };

  return {
    tick() {
      if (done) return;
      const t = now();
      if (first === null) first = t;
      const gap = last === null ? 0 : t - last;
      last = t;
      if (t - first < graceMs) return;
      if (gap > STALL_MS) {
        frames = [];
        stalls++;
        if (stalls >= 3) degrade();
        return;
      }
      stalls = 0;
      if (gap > hiccupMs) {
        frames = [];
        return;
      }
      frames.push(t);
      while (t - frames[0] > windowMs) frames.shift();
      const span = t - frames[0];
      if (span < windowMs * 0.9) return;
      if (((frames.length - 1) * 1000) / span < minFps) degrade();
    },
    stop() {
      done = true;
    },
  };
}

// 标签页可见性变化时调 onShow / onHide。返回解绑函数。
export function whenVisible(doc, { onShow, onHide }) {
  const handler = () => (doc.hidden ? onHide && onHide() : onShow && onShow());
  doc.addEventListener('visibilitychange', handler);
  return () => doc.removeEventListener('visibilitychange', handler);
}
