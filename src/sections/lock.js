import { html } from '../lib/html.js';
import { stages } from '../facts.js';

function chamber(t, stage) {
  const copy = t.lock.stages[stage.id];
  return html`<li class="chamber" data-stage="${stage.id}">
        <span class="chamber__id">${stage.id}</span>
        <h3 class="chamber__name" data-fit>${copy.name}</h3>
        <p class="chamber__line">${copy.line}</p>
        <ul class="chamber__roles">
          ${stage.roles.map((role) => html`<li class="chip" data-role="${role}" data-fit>${t.lock.roles[role].name}</li>`)}
        </ul>
        ${stage.id === 'S5' ? html`<p class="chamber__note">${t.lock.parallelNote}</p>` : null}
        <ul class="chamber__artifacts">
          ${stage.artifacts.map((name) => html`<li data-artifact><code>${name}</code></li>`)}
        </ul>
      </li>`;
}

export function render(ctx) {
  const { t } = ctx;
  return html`<section id="lock" class="lock" data-section="lock" data-zone="rise" data-lock>
  <header class="section__head">
    <h2 class="section__title">${t.lock.title}</h2>
    <p class="section__lead">${t.lock.lead}</p>
  </header>
  <div class="lock__stage">
    <ol class="lock__flight">
      ${stages.map((stage) => chamber(t, stage))}
    </ol>
    <p class="lock__ledger-title">${t.lock.ledgerTitle}</p>
  </div>
</section>`;
}
