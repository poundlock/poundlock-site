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
