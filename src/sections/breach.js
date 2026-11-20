import { html, raw } from '../lib/html.js';
import { breach, gates } from '../facts.js';

// 演示窗里的图：左边一室有水、船在上面，右边高一级的那一室还空着；中间的缝里是闸门。
// 画法和过闸那张图一致（两端带浅弧的长片、14 宽的缝）。
const scene = raw(`<svg class="breach__svg" viewBox="0 0 420 250" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="breach-water" gradientUnits="userSpaceOnUse" x1="0" y1="110" x2="0" y2="330"><stop offset="0" style="stop-color:var(--water-mid-0)"/><stop offset="1" style="stop-color:var(--mint-mid)"/></linearGradient>
  </defs>
  <path class="breach__slab" d="M70 116A150 150 0 0 1 196 116V330H70Z" fill="url(#breach-water)"/>
  <path class="breach__shell" d="M210 76A150 150 0 0 1 336 76V330H210Z"/>
  <rect class="breach__gate" x="200" y="62" width="6" height="200" rx="3"/>
  <circle class="breach__ring" cx="203" cy="104" r="26"/>
  <g transform="translate(133 102)"><g class="breach__boat"><g transform="scale(1.25)">
    <path class="boat__sail" d="M-2 -8V-40A32 32 0 0 1 22 -8Z"/>
    <path class="boat__hull" d="M-24 -6H24Q18 8 0 8Q-18 8 -24 -6Z"/>
  </g></g></g>
</svg>`);

// 六种办法和各自「门禁说的话」默认就以列表的样子在页面上；脚本只做增强。
export function render(ctx) {
  const { t } = ctx;
  return html`<section id="breach" class="breach" data-section="breach" data-zone="light">
  <header class="section__head">
    <h2 class="section__title">${t.breach.title}</h2>
    <p class="section__lead">${t.breach.lead}</p>
  </header>
  <div class="breach__panel on-deep">
    <p class="breach__badge">${t.breach.demoBadge}</p>
    <ul class="breach__attempts">
      ${breach.map(
        (item) => html`<li class="breach__attempt">
        <button type="button" class="breach__button" data-attempt="${item.id}" data-gate-ref="${item.gate}" aria-pressed="false" data-fit>${t.breach.attempts[item.id].label}</button>
        <p class="breach__says" data-says-for="${item.id}"><strong class="breach__gate-name">${t.breach.gates[item.gate].name}</strong><span class="breach__says-text">${t.breach.attempts[item.id].says}</span></p>
      </li>`,
      )}
    </ul>
    <div class="breach__stage">
      <div class="breach__scene">${scene}</div>
      <div class="breach__out" data-breach-out aria-live="polite"></div>
    </div>
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
