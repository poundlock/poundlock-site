import { html } from '../lib/html.js';
import { contractDemo } from '../facts.js';

export function render(ctx) {
  const { t } = ctx;
  return html`<section id="contract" class="contract" data-section="contract" data-zone="light">
  <header class="section__head">
    <h2 class="section__title">${t.contract.title}</h2>
    <p class="section__lead">${t.contract.lead}</p>
  </header>
  <div class="contract__grid">
    <figure class="contract__words">
      <figcaption>${t.contract.wordsLabel}</figcaption>
      <blockquote>${t.contract.words}</blockquote>
    </figure>
    <ol class="contract__clauses">
      ${t.contract.clauses.map(
        (clause, i) => html`<li class="clause" data-verdict="${contractDemo[i]}">
        <q class="clause__quote">${clause.quote}</q>
        <span class="clause__note">${clause.note}</span>
      </li>`,
      )}
    </ol>
  </div>
  <p class="contract__rework">${t.contract.reworkNote}</p>
</section>`;
}
