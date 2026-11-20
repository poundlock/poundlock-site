import { html } from '../lib/html.js';
import { starIcon } from './icons.js';

// 另一种语言的链接：从当前页到站点根的前缀，加上那一页的路径。
export function langSwitch(ctx) {
  const { lang, base, config } = ctx;
  return config.langs
    .filter((other) => other.code !== lang.code)
    .map(
      (other) =>
        html`<a class="lang-switch" href="${base + other.path}" hreflang="${other.htmlLang}" lang="${other.htmlLang}" data-lang-switch>${other.label}</a>`,
    );
}

export function render(ctx) {
  const { t, base, config } = ctx;
  return html`<a class="skip-link" href="#main">${t.nav.skip}</a>
<header class="site-header" data-header>
  <a class="brand" href="#hero" aria-label="poundlock">
    <img class="brand__mark" src="${base}assets/logo/poundlock-tile.svg" alt="" width="28" height="28">
    <span class="brand__name">poundlock</span>
  </a>
  <nav class="site-nav">
    ${langSwitch(ctx)}
    <a class="star-link" href="${config.repoUrl}" data-star>${starIcon}<span>${t.nav.star}</span><span class="star-count" data-star-count hidden></span></a>
  </nav>
</header>`;
}
