import { html } from '../lib/html.js';

export function render(ctx) {
  const { t } = ctx;
  return html`<section id="pain" class="pain" data-section="pain" data-zone="deep">
  <h2 class="section__title">${t.pain.title}</h2>
  <ul class="pain__list">
    ${t.pain.items.map(
      (item) => html`<li class="pain__item">
      <p class="pain__claim">${item.claim}</p>
      <p class="pain__truth">${item.truth}</p>
    </li>`,
    )}
  </ul>
</section>`;
}
