import { html } from '../lib/html.js';
import { roles, dispatch } from '../facts.js';

export function render(ctx) {
  const { t } = ctx;
  const edges = Object.entries(dispatch).flatMap(([from, list]) => list.map((to) => `${from}>${to}`));
  return html`<section id="roster" class="roster" data-section="roster" data-zone="light">
  <header class="section__head">
    <h2 class="section__title">${t.roster.title}</h2>
    <p class="section__lead">${t.roster.lead}</p>
  </header>
  <div class="roster__tree">
    <p class="roster__you">${t.roster.youTalkTo}</p>
    <ul class="roster__nodes">
      ${roles.map(
        (id) => html`<li class="role" data-role-node="${id}" tabindex="0">
        <strong class="role__name" data-fit>${t.lock.roles[id].name}</strong>
        <span class="role__job">${t.lock.roles[id].job}</span>
      </li>`,
      )}
    </ul>
    <div class="roster__edges" aria-hidden="true">
      ${edges.map((edge) => html`<span class="roster__edge" data-edge="${edge}"></span>`)}
    </div>
  </div>
</section>`;
}
