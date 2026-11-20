import { html } from '../lib/html.js';
import { breach, gates } from '../facts.js';

// 六种办法和各自「门禁说的话」默认就以列表的样子在页面上；脚本只做增强。
export function render(ctx) {
  const { t } = ctx;
  return html`<section id="breach" class="breach" data-section="breach" data-zone="light">
  <header class="section__head">
    <h2 class="section__title">${t.breach.title}</h2>
    <p class="section__lead">${t.breach.lead}</p>
    <p class="breach__badge">${t.breach.demoBadge}</p>
  </header>
  <div class="breach__panel">
    <ul class="breach__attempts">
      ${breach.map(
        (item) => html`<li class="breach__attempt">
        <button type="button" class="breach__button" data-attempt="${item.id}" data-gate-ref="${item.gate}" aria-pressed="false" data-fit>${t.breach.attempts[item.id].label}</button>
        <p class="breach__says" data-says-for="${item.id}"><strong class="breach__gate-name">${t.breach.gates[item.gate].name}</strong><span class="breach__says-text">${t.breach.attempts[item.id].says}</span></p>
      </li>`,
      )}
    </ul>
    <div class="breach__out" data-breach-out aria-live="polite"></div>
    <ul class="breach__gates">
      ${gates.map(
        (id) => html`<li class="gate-badge" data-gate="${id}">
        <strong class="gate-badge__name" data-fit>${t.breach.gates[id].name}</strong>
        <span class="gate-badge__what">${t.breach.gates[id].what}</span>
      </li>`,
      )}
    </ul>
    <p class="breach__all" data-breach-all>${t.breach.allTried}</p>
  </div>
</section>`;
}
