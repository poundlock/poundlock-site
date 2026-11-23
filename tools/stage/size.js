// 首屏演示的设计尺寸：页面的样式定下留给演示的那块地方（w × h），这里给舞台挑一个设计尺寸，
// 舞台按宽度缩放以后正好填满它。字放大到 SCALE 倍就不再放大，多出来的地方让终端变宽、变高；
// 地方小的时候设计宽度停在 MIN_W（字跟着缩小），太宽时设计宽度停在 MAX_W，字才继续放大。
// 那块地方窄于 600 时舞台换成手机那一版（宽 358），它的设计高也按那块地方的长宽比给。
// 写成普通的 JS：entry.tsx 引它，tests/hero-demo.test.js 也能直接引来核。
//
// 舞台就是终端窗口本身（窗口铺满舞台），所以设计宽就是窗口的宽。
// 页面的样式里有几处和 600 这个数连着（hero.css：宽屏右栏的比例、手机版式的断点 680）：改了要一起看。

export const SCALE = 1.45;
export const MIN_W = 600;
export const MAX_W = 1280;
export const MIN_H = 300;
export const COMPACT_W = 358;
export const COMPACT_MIN_H = 300;

export function designSize(w, h) {
  if (!w || !h) return { width: 720, height: 540, compactHeight: 372 };
  const width = Math.round(Math.min(MAX_W, Math.max(MIN_W, w / SCALE)));
  const height = Math.round(Math.max(MIN_H, (h * width) / w));
  const compactHeight = Math.round(Math.max(COMPACT_MIN_H, (h * COMPACT_W) / w));
  return { width, height, compactHeight };
}
