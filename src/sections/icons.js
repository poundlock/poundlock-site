import { raw } from '../lib/html.js';

// 内联图标。页面上不用 emoji 当图标。
export const starIcon = raw(
  '<svg class="icon icon--star" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">' +
    '<path d="M10 1.6l2.5 5.2 5.7.8-4.1 4 1 5.7L10 14.6 4.9 17.3l1-5.7-4.1-4 5.7-.8z" fill="currentColor"/></svg>',
);

export const arrowDownIcon = raw(
  '<svg class="icon icon--arrow" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false">' +
    '<path d="M10 3v12m0 0l-5-5m5 5l5-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
);

// 验收清单：通过是一个实心的勾；没通过是一个留着缺口的圈——闸门没合上。
export const checkIcon = raw(
  '<svg class="icon icon--check" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">' +
    '<circle cx="12" cy="12" r="11" fill="currentColor"/><path class="icon__tick" d="M7 12.4l3.3 3.3L17 9" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
);

export const gapIcon = raw(
  '<svg class="icon icon--gap" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">' +
    '<path d="M16.6 3.1A10 10 0 1 0 20.9 7.4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M8.5 8.5l7 7m0-7l-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
);

// 退回去返工：一道往回拐的线。
export const returnIcon = raw(
  '<svg class="icon icon--return" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">' +
    '<path d="M9 7L4 12l5 5M4 12h11a5 5 0 0 0 5-5V5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
);
