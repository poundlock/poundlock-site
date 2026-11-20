// 动效的公共判断：系统要不要减少动效、帧率撑不撑得住、标签页看不看得见。
// 导入时不碰 window、document，Node 里能直接测。

export function prefersReducedMotion(win = window) {
  return Boolean(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

// 每帧调一次 tick()。最近 windowMs 里的平均帧率低于 minFps 时调一次 onDegrade，只调一次。
// 单独一帧隔了一秒以上，当成标签页切走又回来，重新开始数；连着三帧都这样才算真的卡。
export function createFpsWatchdog({ minFps = 40, windowMs = 2000, onDegrade, now = () => performance.now() } = {}) {
  const STALL_MS = 1000;
  let frames = [];
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
      if (last !== null && t - last > STALL_MS) {
        frames = [];
        stalls++;
        last = t;
        if (stalls >= 3) degrade();
        return;
      }
      if (last !== null) stalls = 0;
      last = t;
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
