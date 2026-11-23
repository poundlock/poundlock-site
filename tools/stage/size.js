// 首屏演示的设计尺寸：页面的样式定下留给演示的那块地方（w × h），这里给舞台挑一个设计尺寸，
// 舞台按宽度缩放以后正好填满它。字放大到 SCALE 倍就不再放大，多出来的地方让终端变宽、变高；
// 地方小的时候设计宽度停在 720（字跟着缩小，和原来一样）。太宽时设计宽度停在 MAX_W，字才继续放大。
// 写成普通的 JS：entry.tsx 引它，tests/hero-demo.test.js 也能直接引来核。

export const SCALE = 1.45;
export const MIN_W = 720;
export const MAX_W = 1280;
export const MIN_H = 440;

export function designSize(w, h) {
  if (!w || !h) return { width: 720, height: 540 };
  const width = Math.round(Math.min(MAX_W, Math.max(MIN_W, w / SCALE)));
  const height = Math.round(Math.max(MIN_H, (h * width) / w));
  return { width, height };
}
