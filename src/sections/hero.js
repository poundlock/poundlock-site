import { html, raw } from '../lib/html.js';
import { starIcon } from './icons.js';

// 图标「梯级」的三片，画法和 design/logo 里的一致（深色版）。每片各自一组，首屏加载时依次升到位。
const mark = raw(`<svg class="hero__mark-svg" viewBox="96 16 320 440" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="hero-lo" gradientUnits="userSpaceOnUse" x1="0" y1="146" x2="0" y2="446"><stop offset="0" stop-color="#3CC4B0"/><stop offset="1" stop-color="#128C84"/></linearGradient>
    <linearGradient id="hero-mid" gradientUnits="userSpaceOnUse" x1="0" y1="106" x2="0" y2="406"><stop offset="0" stop-color="#9AF0DD"/><stop offset="1" stop-color="#4FD0BB"/></linearGradient>
    <linearGradient id="hero-hi" gradientUnits="userSpaceOnUse" x1="0" y1="66" x2="0" y2="366"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#D3F6EC"/></linearGradient>
  </defs>
  <path class="slice slice--lo" d="M199 157.25A150 150 0 0 0 199 434.75Z" fill="url(#hero-lo)"/>
  <path class="slice slice--mid" d="M213 112.3A150 150 0 0 1 299 112.3V399.7A150 150 0 0 1 213 399.7Z" fill="url(#hero-mid)"/>
  <path class="slice slice--hi" d="M313 77.25A150 150 0 0 1 313 354.75Z" fill="url(#hero-hi)"/>
</svg>`);

// 主标题在第一个逗号后面分成两行；文字本身不变（西文逗号后面的空格留着）。
function titleLines(text) {
  const line = (part) => html`<span class="hero__line">${part}</span>`;
  const at = text.search(/[，,]/);
  if (at < 0) return [line(text)];
  const rest = text.slice(at + 1);
  return [line(text.slice(0, at + 1)), rest.startsWith(' ') ? ' ' : null, line(rest.trimStart())];
}

export function render(ctx) {
  const { t, config } = ctx;
  return html`<section id="hero" class="hero" data-section="hero" data-zone="deep">
  <canvas class="hero__water" data-water aria-hidden="true"></canvas>
  <div class="hero__copy">
    <h1 class="hero__title">${titleLines(t.hero.h1)}</h1>
    <p class="hero__sub">${t.hero.sub}</p>
    ${t.hero.note ? html`<p class="hero__note">${t.hero.note}</p>` : null}
    <div class="hero__cta">
      <a class="btn btn--primary" href="${config.repoUrl}" data-star data-fit>${starIcon}<span>${t.hero.ctaStar}</span><span class="star-count" data-star-count hidden></span></a>
      <a class="btn btn--ghost" href="#lock" data-fit>${t.hero.ctaDemo}</a>
    </div>
  </div>
  <div class="hero__mark" aria-hidden="true">${mark}</div>
</section>`;
}
