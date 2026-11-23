// 画面追滚动位置：临界阻尼的弹簧（二阶），不用一阶的指数趋近。过闸的三路画面（视频、图片、平面）都用它。
//
// 一阶的追法：目标一变，速度立刻跳到最大，再往下掉。滚轮一格一格地滚（Windows 上一格 100px，常常不带平滑滚动），
// 每一格画面都是「猛走一截、停住」，连着滚也是一顿一顿的（用户说「停顿感严重」）。二阶的速度是连续的：
// 起步、停下都是缓的，连着几格的滚动被抹成一段匀速的滑行。代价是追得慢一点：匀速滚的时候画面落后 2/ω 秒。
//
// 每一步用解析解（这一步里目标不变），步长多大都稳。越过目标（方向刚反过来时可能发生）就停在目标上，
// 不在目标两边来回晃：来回晃要往回解码。

export function createFollower(omega) {
  let x = null;
  let v = 0;
  return {
    // target：滚动进度；dt：离上一步过了多少秒；snap：直接到位（第一帧、滚出视口的那一刻）。返回这一步画面该在的进度。
    step(target, dt, snap = false) {
      if (x === null || snap) {
        x = target;
        v = 0;
        return x;
      }
      if (!(dt > 0)) return x;
      const c1 = x - target;
      const c2 = v + omega * c1;
      const e = Math.exp(-omega * dt);
      const next = target + (c1 + c2 * dt) * e;
      const crossed = c1 !== 0 && Math.sign(next - target) === -Math.sign(c1);
      if (crossed) {
        x = target;
        v = 0;
      } else {
        x = next;
        v = (c2 - omega * (c1 + c2 * dt)) * e;
      }
      return x;
    },
    get value() {
      return x;
    },
    get velocity() {
      return v;
    },
  };
}
