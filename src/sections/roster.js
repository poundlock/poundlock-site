import { html } from '../lib/html.js';
import { roles, dispatch } from '../facts.js';

// 每个角色由谁派（花名册反过来查）。
const parentsOf = (role) =>
  Object.entries(dispatch)
    .filter(([, list]) => list.includes(role))
    .map(([from]) => from);
// 第几层：项目经理是 0，它直接派的是 1，再往下是 2。
const tierOf = (role) => (role === 'pm' ? 0 : parentsOf(role).includes('pm') ? 1 : 2);

// 宽屏上那张图里，每个角色的中心在横向的哪（百分比）。和 roster.css 里各角色占的列对应：
// 第一层四个各占四分之一，第二层五个各占五分之一。
const CENTER = { pm: 50, product: 12.5, architect: 37.5, qa: 62.5, acceptance: 87.5, ui: 10, backend: 30, frontend: 50, ios: 70, android: 90 };

// 连到第 tier 层的那些线：从上面那个角色的底边流到下面那个角色的顶边。
function links(tier) {
  const edges = Object.entries(dispatch).flatMap(([from, list]) => list.filter((to) => tierOf(to) === tier).map((to) => [from, to]));
  return html`<svg class="roster__links" data-links-to="${tier}" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      ${edges.map(([from, to]) => html`<path data-edge="${`${from}>${to}`}" d="M${CENTER[from]} 0C${CENTER[from]} 6 ${CENTER[to]} 4 ${CENTER[to]} 10"/>`)}
    </svg>`;
}

export function render(ctx) {
  const { t } = ctx;
  const name = (id) => t.lock.roles[id].name;
  return html`<section id="roster" class="roster" data-section="roster" data-zone="light">
  <header class="section__head">
    <h2 class="section__title">${t.roster.title}</h2>
    <p class="section__lead">${t.roster.lead}</p>
  </header>
  <div class="roster__tree">
    <p class="roster__you"><span class="roster__you-tag">${t.roster.you}</span>${t.roster.youTalkTo}</p>
    <ul class="roster__nodes">
      ${roles.map((id) => {
        const parents = parentsOf(id);
        return html`<li class="role" data-role-node="${id}" data-tier="${tierOf(id)}" tabindex="0">
        <strong class="role__name" data-fit>${name(id)}</strong>
        ${parents.length ? html`<span class="role__from">${t.roster.dispatchedBy.replace('{who}', parents.map(name).join(t.roster.listJoin))}</span>` : null}
        <span class="role__job">${t.lock.roles[id].job}</span>
      </li>`;
      })}
    </ul>
    ${links(1)}
    ${links(2)}
  </div>
</section>`;
}
