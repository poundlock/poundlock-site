import { html } from '../lib/html.js';
import { starIcon } from './icons.js';
import { langSwitch } from './header.js';

export function render(ctx) {
  const { t, config } = ctx;
  return html`<footer id="end" class="end" data-section="end" data-zone="deep">
  <p class="end__closing">${t.footer.closing}</p>
  <a class="btn btn--primary" href="${config.repoUrl}" data-star data-fit>${starIcon}<span>${t.hero.ctaStar}</span><span class="star-count" data-star-count hidden></span></a>
  <nav class="end__links">
    <a href="${config.repoUrl}">${t.footer.repo}</a>
    <a href="${config.repoUrl}#readme">${t.footer.readme}</a>
    <a href="${config.repoUrl}/blob/main/CHANGELOG.md">${t.footer.changelog}</a>
    <a href="${config.repoUrl}/blob/main/LICENSE">${t.footer.license}</a>
    ${langSwitch(ctx)}
  </nav>
</footer>`;
}
