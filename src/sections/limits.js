import { html } from '../lib/html.js';
import { readmeAnchors } from '../facts.js';

export function render(ctx) {
  const { t, lang, config } = ctx;
  return html`<section id="limits" class="limits" data-section="limits" data-zone="light">
  <header class="section__head">
    <h2 class="section__title">${t.limits.title}</h2>
    <p class="section__lead">${t.limits.lead}</p>
  </header>
  <ul class="limits__list">
    ${t.limits.items.map(
      (item) => html`<li class="limit">
      <h3 class="limit__head">${item.head}</h3>
      <p class="limit__body">${item.body}</p>
    </li>`,
    )}
  </ul>
  <p class="section__more"><a href="${config.repoUrl + readmeAnchors[lang.code].limits}">${t.limits.more}</a></p>
</section>`;
}
