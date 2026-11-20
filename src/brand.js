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

const outline = readWordmark();

export function wordmark(className) {
  return raw(
    `<svg class="${className}" viewBox="${outline.viewBox}" aria-hidden="true" focusable="false">` +
      `<path transform="${outline.transform}" fill="currentColor" d="${outline.d}"/></svg>`,
  );
}

// 图标「梯级」的三片，画法和 design/logo 里的一致，颜色用调色板的变量（--mark-*，页头的样式里定）。
// 页面上的图标跟着页面的配色走；design/logo 里的文件（浏览器标签上的小图标、分享图）是定稿的品牌图，不动。
export function mark(className) {
  const gradient = (id, y1, y2) =>
    `<linearGradient id="brand-${id}" gradientUnits="userSpaceOnUse" x1="0" y1="${y1}" x2="0" y2="${y2}">` +
    `<stop offset="0" style="stop-color:var(--mark-${id}-0)"/><stop offset="1" style="stop-color:var(--mark-${id}-1)"/></linearGradient>`;
  return raw(
    `<svg class="${className}" viewBox="96 56 320 400" aria-hidden="true" focusable="false">` +
      `<defs>${gradient('lo', 146, 446)}${gradient('mid', 106, 406)}${gradient('hi', 66, 366)}</defs>` +
      '<path d="M199 157.25A150 150 0 0 0 199 434.75Z" fill="url(#brand-lo)"/>' +
      '<path d="M213 112.3A150 150 0 0 1 299 112.3V399.7A150 150 0 0 1 213 399.7Z" fill="url(#brand-mid)"/>' +
      '<path d="M313 77.25A150 150 0 0 1 313 354.75Z" fill="url(#brand-hi)"/></svg>',
  );
}
