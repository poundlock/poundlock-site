import { html } from '../lib/html.js';
import { starIcon, arrowDownIcon } from './icons.js';

export function render(ctx) {
  const { t, config } = ctx;
  return html`<section id="hero" class="hero" data-section="hero" data-zone="deep">
  <div class="hero__copy">
    <h1 class="hero__title">${t.hero.h1}</h1>
    <p class="hero__sub">${t.hero.sub}</p>
    ${t.hero.note ? html`<p class="hero__note">${t.hero.note}</p>` : null}
    <div class="hero__cta">
      <a class="btn btn--primary" href="${config.repoUrl}" data-star data-fit>${starIcon}<span>${t.hero.ctaStar}</span><span class="star-count" data-star-count hidden></span></a>
      <a class="btn btn--ghost" href="#lock" data-fit><span>${t.hero.ctaDemo}</span>${arrowDownIcon}</a>
    </div>
  </div>
</section>`;
}
