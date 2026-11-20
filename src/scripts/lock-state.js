// 过闸每一刻的状态：船在哪、每一室的水位、每一道闸门开没开、天亮了多少。
// 只取决于滚动进度，是个纯函数——往回滚、刷新、改窗口大小，画面都由它算出来。Node 里能直接测。
//
// 位置的单位是「闸室」：第 i 室（下标从 0 起）占 [i, i+1]，第 g 道闸门在位置 g，河在 0 之前，上游在 n 之后。
// 水位的单位是「级」：河面是 0，第 i 室低水位是 i、注满是 i+1。
//
// 每一室的动作照真的船闸，一步接一步，不重叠：
//   船开进来 → 身后的闸门关严 → 水位升一级 → 前面的闸门打开（两边水位平了才开得了）

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
// x 走到 [a, b] 的哪了，带缓动；a 之前是 0，b 之后是 1。
const phase = (x, a, b) => ease(clamp01((x - a) / (b - a)));

// 一室里四个动作各占的区间（0 到 1 是这一室的全程）。
export const PHASES = {
  move: [0, 0.42],
  close: [0.44, 0.58],
  rise: [0.6, 0.84],
  open: [0.86, 1],
};

// 最后一拍里，前一半过最后一道闸，后一半船驶出去、天亮。
export const LAST_SHARE = 0.5;

export function lockStateAt(progress, n = 8) {
  const u = clamp01(progress) * n;
  // 第 i 室的动作走到哪了。
  const local = (i) => clamp01((u - i) / (i === n - 1 ? LAST_SHARE : 1));

  const water = [];
  const gates = [];
  let boat = -0.5;

  for (let i = 0; i < n; i++) {
    const s = local(i);
    if (u >= i) boat = i - 0.5 + phase(s, ...PHASES.move);
    water.push(phase(s, ...PHASES.rise));
    // 第 i 道闸门：下游那一室注满以后打开（第一道一开始就开着），船过去以后在身后关上。
    const opened = i === 0 ? 1 : phase(local(i - 1), ...PHASES.open);
    gates.push(1 - opened + opened * phase(s, ...PHASES.close));
  }
  gates.push(1 - phase(local(n - 1), ...PHASES.open));

  // 收尾：船驶出最高一级，天亮。
  const end = clamp01((u - (n - 1) - LAST_SHARE) / (1 - LAST_SHARE));
  if (end > 0) boat = n - 0.5 + phase(end, 0, 0.75) * 1.7;
  const day = phase(end, 0.3, 1);

  // 船浮在它所在那一室的水面上。
  const chamber = Math.min(n - 1, Math.floor(boat));
  const level = boat < 0 ? 0 : boat >= n ? n : chamber + water[chamber];

  return { boat, level, water, gates, day };
}
