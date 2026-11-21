// 影片的取帧表：整段滚动（进度 0 到 1）上，哪些进度各渲一帧。
// 不按进度均匀取——那样船在走的那几段帧太少（一帧窜出去好几米），停着的时候帧又白白多。
// 按「画面变了多少」取：从上一帧往前，走到某一项变化正好到了上限就取下一帧。
// 纯函数，Node 里能直接测；渲染脚本（tools/film/states.mjs）和压片脚本都用它，页面拿压片写出来的表查帧号。
import { lockStateAt } from './lock-state.js';

// 一室有多长（米）。和渲染脚本里的场景（tools/film/lockfilm/layout.py 的 L）是同一个数。
export const CHAMBER_METRES = 24;

// 相邻两帧之间，各项最多变多少。
export const LIMITS = {
  travel: 0.4, // 船前进（米）
  rise: 1 / 16, // 任一室的水位（级）
  gate: 1 / 10, // 任一道闸门（0 开到 1 关）
  day: 1 / 40, // 天亮了多少
  gap: 1 / 240, // 进度本身：什么都没动也不隔太远（天色、水波、镜头的小晃动在走）
};

// 从状态 a 到状态 b（都带 progress），各项变化占各自上限的比例里最大的那个。不超过 1 就是「一帧走得到」。
export function stepCost(a, b, limits = LIMITS) {
  let cost = Math.abs(b.progress - a.progress) / limits.gap;
  cost = Math.max(cost, (Math.abs(b.boat - a.boat) * CHAMBER_METRES) / limits.travel);
  for (let i = 0; i < a.water.length; i++) cost = Math.max(cost, Math.abs(b.water[i] - a.water[i]) / limits.rise);
  for (let i = 0; i < a.gates.length; i++) cost = Math.max(cost, Math.abs(b.gates[i] - a.gates[i]) / limits.gate);
  return Math.max(cost, Math.abs(b.day - a.day) / limits.day);
}

const PRECISION = 1e7; // 表里的进度留七位小数：渲染和页面用的是同一个数

// 取帧表：进度从 0 到 1，严格递增。
export function filmSchedule(limits = LIMITS) {
  const at = (progress) => ({ progress, ...lockStateAt(progress) });
  const table = [0];
  let here = at(0);
  while (here.progress < 1) {
    const reach = Math.min(limits.gap, 1 - here.progress);
    let next;
    if (stepCost(here, at(here.progress + reach), limits) <= 1) {
      next = here.progress + reach;
    } else {
      // 一步之内各项都只往一个方向变，走得越远变得越多：二分找正好到上限的那一步。
      let lo = 0;
      let hi = reach;
      for (let k = 0; k < 48; k++) {
        const mid = (lo + hi) / 2;
        if (stepCost(here, at(here.progress + mid), limits) <= 1) lo = mid;
        else hi = mid;
      }
      next = here.progress + lo;
    }
    // 往下取整到七位小数（取整以后只会更近，不会超上限）；到头了就是 1。
    next = 1 - next < 1 / PRECISION ? 1 : Math.floor(next * PRECISION) / PRECISION;
    if (next <= here.progress) next = Math.min(1, here.progress + 1 / PRECISION);
    table.push(next);
    here = at(next);
  }
  return table;
}

// 这个进度该画第几帧：表里离它最近的那一帧（正好在两帧正中间取后面那一帧）。
export function frameAtTable(table, progress) {
  const last = table.length - 1;
  if (last <= 0 || !(progress > table[0])) return 0;
  if (progress >= table[last]) return last;
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (table[mid] <= progress) lo = mid;
    else hi = mid;
  }
  return progress - table[lo] < table[hi] - progress ? lo : hi;
}
