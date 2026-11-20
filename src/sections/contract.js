import { html } from '../lib/html.js';
import { contractDemo, firstRun } from '../facts.js';
import { checkIcon, gapIcon, returnIcon } from './icons.js';

// 把原话按验收条目引到的几段切开，引到的标出来：左边哪几个字，对着右边哪一条。
function cited(words, clauses) {
  const parts = [];
  let at = 0;
  clauses.forEach((clause, i) => {
    const found = words.indexOf(clause.quote, at);
    if (found < 0) return;
    parts.push(words.slice(at, found));
    parts.push(html`<mark class="contract__cite" data-verdict="${contractDemo[i]}">${clause.quote}</mark>`);
    at = found + clause.quote.length;
  });
  parts.push(words.slice(at));
  return parts;
}

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
      <p class="contract__typed"><code class="contract__cmd">${firstRun[1]}</code></p>
      <blockquote>${cited(t.contract.words, t.contract.clauses)}</blockquote>
    </figure>
    <div class="contract__check">
      <ol class="contract__clauses">
        ${t.contract.clauses.map(
          (clause, i) => html`<li class="clause" data-verdict="${contractDemo[i]}">
          <span class="clause__mark" aria-hidden="true">${contractDemo[i] === 'pass' ? checkIcon : gapIcon}</span>
          <q class="clause__quote">${clause.quote}</q>
          <span class="clause__note">${clause.note}</span>
        </li>`,
        )}
      </ol>
      <p class="contract__rework"><span class="contract__rework-mark" aria-hidden="true">${returnIcon}</span>${t.contract.reworkNote}</p>
    </div>
  </div>
</section>`;
}
