// 过闸的场景：八个闸室、船、闸门、水尺，生成时算成一张 SVG。
// 画法接着图标「梯级」：竖着的长片、两端是圆弧、片与片之间隔一道 14 宽的闸缝、一片比一片高。
// 浏览器端的 lock.js 从 data- 属性里读它要的数（各级水位、船停的位置），不另存一份。

import { raw } from '../lib/html.js';
import { stages } from '../facts.js';

const SLIT = 14;
const WIDTH = 86;
const WIDE = 150; // 实现那一段：五个角色并排
const HEIGHT = 300;
const STEP = 28; // 每过一道闸升这么多
const TOP = 74; // 倒数第二片的顶在 TOP + STEP；最高一片见 LAST_LIFT
const LAST_LIFT = 10;
const LEFT = 70; // 左边留给水尺
const CAP_R = 150; // 中间各片上下两端那道浅弧的半径（图标里圆的半径）
const END_R = 173.8; // 两头半月形的半径：弦长 300、拱高 86

const round = (n) => Math.round(n * 10) / 10;

function capSag(width) {
  return CAP_R - Math.sqrt(CAP_R * CAP_R - (width / 2) * (width / 2));
}

// 半月形的弧在离直边 inset 远的地方，比弦的端点低多少。
function endDrop(inset) {
  const dx = inset + (END_R - WIDTH);
  return HEIGHT / 2 - Math.sqrt(END_R * END_R - dx * dx);
}

function build() {
  const slabs = [];
  let x = LEFT;
  for (let i = 0; i < stages.length; i++) {
    const width = i === 4 ? WIDE : WIDTH;
    // 最高一片再抬一点：两头的半月形让船停得比片顶低，不抬的话最后两级的水位挨得太近。
    const top = TOP + (stages.length - 1 - i) * STEP - (i === stages.length - 1 ? LAST_LIFT : 0);
    const bottom = top + HEIGHT;
    let path;
    let restX; // 船停在哪
    let level; // 这一级的水位：船停着时的 y
    if (i === 0) {
      path = `M${x + width} ${top}A${END_R} ${END_R} 0 0 0 ${x + width} ${bottom}Z`;
      restX = x + width - 22;
      level = top + endDrop(22);
    } else if (i === stages.length - 1) {
      path = `M${x} ${top}A${END_R} ${END_R} 0 0 1 ${x} ${bottom}Z`;
      restX = x + 22;
      level = top + endDrop(22);
    } else {
      const sag = round(capSag(width));
      path = `M${x} ${top + sag}A${CAP_R} ${CAP_R} 0 0 1 ${x + width} ${top + sag}V${bottom - sag}A${CAP_R} ${CAP_R} 0 0 1 ${x} ${bottom - sag}Z`;
      restX = x + width / 2;
      level = top;
    }
    slabs.push({ id: stages[i].id, x, width, top, bottom, path, restX: round(restX), level: round(level) });
    x += width + SLIT;
  }
  return {
    slabs,
    width: WIDTH,
    height: HEIGHT,
    river: round(slabs[0].level + STEP), // 进第一道闸之前的河面
    startX: round(slabs[0].restX - 110), // 船一开始在哪
    empty: HEIGHT + 12, // 水的那块矩形往下挪这么多，闸室就是空的
    viewBox: [0, 0, x - SLIT + 24, slabs[0].bottom + 30],
  };
}

export const geometry = build();

// 每片水的颜色：在调色板的三档之间取——最低一片、中间、最高一片，每档上下两端。
// 这里只写变量名，色值在 tokens.css 里：换配色不用动这张图。
// 两套：deep 是水下，light 是升出水面以后。
const TONES = {
  deep: { tops: ['--water-lo-0', '--water-mid-0', '--water-hi-0'], bottoms: ['--mint-lo', '--mint-mid', '--mint-hi'] },
  light: { tops: ['--blue-lo-0', '--blue-mid-0', '--blue-hi-0'], bottoms: ['--blue-lo', '--blue-mid', '--blue-hi'] },
};

// 在三档之间按 t（0 到 1）取色，写成 CSS 的 color-mix。
function ramp(names, t) {
  const scaled = t * (names.length - 1);
  const i = Math.min(names.length - 2, Math.floor(scaled));
  const share = Math.round((scaled - i) * 100);
  if (share === 0) return `var(${names[i]})`;
  if (share === 100) return `var(${names[i + 1]})`;
  return `color-mix(in srgb, var(${names[i]}), var(${names[i + 1]}) ${share}%)`;
}

// tone：'deep' 是水下那一张（脚本驱动的就是它），'light' 是水面以上那一张（静态，升满了的样子）。
export function renderScene({ tone = 'deep' } = {}) {
  const { slabs, river, viewBox } = geometry;
  const { tops, bottoms } = TONES[tone];
  const id = (name, i) => `lock-${tone}-${name}-${i}`;
  const last = slabs.length - 1;

  const defs = slabs
    .map((slab, i) => {
      const t = i / last;
      return (
        `<linearGradient id="${id('water', i)}" gradientUnits="userSpaceOnUse" x1="0" y1="${slab.top}" x2="0" y2="${slab.bottom}">` +
        `<stop offset="0" style="stop-color:${ramp(tops, t)}"/><stop offset="1" style="stop-color:${ramp(bottoms, t)}"/></linearGradient>` +
        `<clipPath id="${id('clip', i)}"><path d="${slab.path}"/></clipPath>`
      );
    })
    .join('');

  const chambers = slabs
    .map((slab, i) => {
      // 实现那一段分五道：四条细的分隔线，水漫上来才看得见。
      const lanes =
        i === 4
          ? [1, 2, 3, 4]
              .map((k) => {
                const lx = round(slab.x + (slab.width * k) / 5);
                return `<line class="slab__lane" x1="${lx}" y1="${slab.top}" x2="${lx}" y2="${slab.bottom}"/>`;
              })
              .join('')
          : '';
      return (
        `<g class="slab" data-slab="${i}" data-stage-ref="${slab.id}" data-top="${slab.top}" data-level="${slab.level}" data-rest-x="${slab.restX}">` +
        `<path class="slab__shell" d="${slab.path}"/>` +
        `<g clip-path="url(#${id('clip', i)})">` +
        `<rect class="slab__water" x="${slab.x}" y="${slab.top}" width="${slab.width}" height="${geometry.height}" fill="url(#${id('water', i)})"/>` +
        lanes +
        `</g></g>`
      );
    })
    .join('');

  // 每片左边那道闸门：关上的时候，缝里亮起一根杆。
  // 竖直范围取相邻两片重叠的那一段；第一片左边没有缝，所以是七道。
  const gates = slabs
    .slice(1)
    .map((slab, k) => {
      const prev = slabs[k];
      const y0 = Math.max(prev.top, slab.top) + 14;
      const y1 = Math.min(prev.bottom, slab.bottom) - 14;
      return `<rect class="gate" data-gate-index="${k + 1}" x="${slab.x - SLIT / 2 - 2}" y="${y0}" width="4" height="${y1 - y0}" rx="2"/>`;
    })
    .join('');

  // 水尺：每一级一道刻度，数字是第几级。
  const gaugeTop = slabs[last].level - 14;
  const gaugeBottom = river + 14;
  const ticks = slabs
    .map(
      (slab, i) =>
        `<line class="gauge__tick" x1="34" y1="${slab.level}" x2="46" y2="${slab.level}"/>` +
        `<text class="gauge__num" x="26" y="${slab.level}" text-anchor="end" dominant-baseline="central">${i + 1}</text>`,
    )
    .join('');
  const gauge =
    `<g class="gauge"><line class="gauge__rail" x1="46" y1="${gaugeTop}" x2="46" y2="${gaugeBottom}"/>${ticks}` +
    `<path class="gauge__float" d="M48 0l10 -6v12z"/></g>`;

  // 船：一个浅浅的船身，一面四分之一圆的帆（帆就是一小片图标）。原点在船底中间。
  const boat =
    `<g class="boat"><g transform="scale(1.3)">` +
    `<path class="boat__sail" d="M-2 -8V-40A32 32 0 0 1 22 -8Z"/>` +
    `<path class="boat__hull" d="M-24 -6H24Q18 8 0 8Q-18 8 -24 -6Z"/>` +
    `</g></g>`;

  // 样式要用的几个位置写成变量，和几何是同一份数：静态版式里船停在最高一级，动效版式开场时船在河面上。
  const top = slabs[last];
  const vars =
    `--boat-rest-x:${top.restX}px;--boat-rest-y:${top.level}px;` +
    `--boat-start-x:${geometry.startX}px;--river:${river}px;--empty:${geometry.empty}px`;

  return raw(
    `<svg class="lock__svg lock__svg--${tone}" viewBox="${viewBox.join(' ')}" style="${vars}" data-river="${river}" data-start-x="${geometry.startX}" data-empty="${geometry.empty}" aria-hidden="true" focusable="false">` +
      `<defs>${defs}</defs>${gauge}${chambers}${gates}${boat}</svg>`,
  );
}
