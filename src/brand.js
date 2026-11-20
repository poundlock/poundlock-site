// 字标：从横版图标的 SVG 里取出「poundlock」那条轮廓，内联进页面，颜色跟着文字色走。
// 只在生成时运行。字标是 Segoe UI Semibold 转的轮廓（主仓库 design/logo/README.md），不要换成活字。

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { raw } from './lib/html.js';

const LOCKUP = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets', 'logo', 'poundlock-lockup-on-dark.svg');

function readWordmark() {
  const svg = readFileSync(LOCKUP, 'utf8');
  const match = svg.match(/<path transform="translate\(([-\d.]+) ([-\d.]+)\)" fill="#F0F6FC" d="([^"]+)"/);
  if (!match) throw new Error(`在 ${LOCKUP} 里找不到字标的轮廓`);
  const [, tx, ty, d] = match;
  // 轮廓只用了 M、L、Q、Z（绝对坐标），数字两两成对，直接取外接框。
  const numbers = d.match(/-?\d+(?:\.\d+)?/g).map(Number);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i + 1 < numbers.length; i += 2) {
    minX = Math.min(minX, numbers[i]);
    maxX = Math.max(maxX, numbers[i]);
    minY = Math.min(minY, numbers[i + 1]);
    maxY = Math.max(maxY, numbers[i + 1]);
  }
  const round = (n) => Math.round(n * 10) / 10;
  return {
    d,
    viewBox: [round(minX + Number(tx)), round(minY + Number(ty)), round(maxX - minX), round(maxY - minY)].join(' '),
    transform: `translate(${tx} ${ty})`,
  };
}

const mark = readWordmark();

export function wordmark(className) {
  return raw(
    `<svg class="${className}" viewBox="${mark.viewBox}" aria-hidden="true" focusable="false">` +
      `<path transform="${mark.transform}" fill="currentColor" d="${mark.d}"/></svg>`,
  );
}
