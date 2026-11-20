import { html } from '../lib/html.js';
import { stages } from '../facts.js';
import { renderScene } from './lock-scene.js';

// 八个阶段的清单。默认是一张看得全的静态清单；动效在的时候，同一份清单变成「当前这一段」的说明，一次只露一段。
function chamber(t, stage) {
  const copy = t.lock.stages[stage.id];
  // 契约那一段冻结原话，业务验收那一段再把它亮出来对一遍。
  const showsWords = stage.id === 'S1' || stage.id === 'S7';
  return html`<li class="chamber" data-stage="${stage.id}">
        <p class="chamber__head"><span class="chamber__id">${stage.id}</span><strong class="chamber__name" data-fit>${copy.name}</strong></p>
        <p class="chamber__line">${copy.line}</p>
        ${showsWords
          ? html`<figure class="chamber__words">
          <figcaption>${t.contract.wordsLabel}</figcaption>
          <blockquote>${t.contract.words}</blockquote>
        </figure>`
          : null}
        <ul class="chamber__roles">
          ${stage.roles.map((role) => html`<li class="chip" data-role="${role}" data-fit>${t.lock.roles[role].name}</li>`)}
        </ul>
        ${stage.id === 'S5' ? html`<p class="chamber__note">${t.lock.parallelNote}</p>` : null}
        <ul class="chamber__artifacts">
          ${stage.artifacts.map((name) => html`<li data-artifact><code>${name}</code></li>`)}
        </ul>
      </li>`;
}

// 账本：每一段留下的产物。beat 是它在第几拍落进来（水面以上那一份全都在，不带这个属性）。
function ledger(t, live) {
  return html`<div class="lock__ledger" aria-hidden="true">
          <p class="lock__ledger-title">${t.lock.ledgerTitle}</p>
          <ul class="lock__ledger-list">
            ${stages.flatMap((stage, i) =>
              stage.artifacts.map((name) =>
                live
                  ? html`<li class="lock__tag" data-ledger-beat="${i}"><code>${name}</code></li>`
                  : html`<li class="lock__tag" data-in><code>${name}</code></li>`,
              ),
            )}
          </ul>
        </div>`;
}

export function render(ctx) {
  const { t, base, film } = ctx;
  // 影片的清单：哪几套画面、各多少帧、多大。没有影片（还没渲染、或者有意不带）就不写，页面用平面的那张图。
  const filmData = film ? JSON.stringify({ base: `${base}assets/film/`, sets: film.sets }) : null;
  const last = stages[stages.length - 1];
  const lastCopy = t.lock.stages[last.id];
  return html`<section id="lock" class="lock" data-section="lock" data-zone="rise" data-lock>
  <header class="section__head lock__head">
    <h2 class="section__title">${t.lock.title}</h2>
    <p class="section__lead">${t.lock.lead}</p>
  </header>
  <div class="lock__track" data-lock-track>
    <div class="lock__stage">
      <!-- 过闸的影片画在这里，滚到哪画哪一帧；没有影片时它不显示，用下面那张平面的图。 -->
      ${filmData ? html`<canvas class="lock__canvas" data-lock-canvas data-film="${filmData}" aria-hidden="true"></canvas>` : html`<canvas class="lock__canvas" data-lock-canvas aria-hidden="true"></canvas>`}
      <!-- 水面以上：同一张图换成浅色版，停在最后一段。动效在的时候垫在水的下面，水退下去才露出来。 -->
      <div class="lock__layer lock__air on-light" aria-hidden="true">
        <div class="lock__scene">${renderScene({ tone: 'light' })}</div>
        <div class="lock__flight">
          <div class="chamber" data-current>
            <p class="chamber__head"><span class="chamber__id">${last.id}</span><strong class="chamber__name">${lastCopy.name}</strong></p>
            <p class="chamber__line">${lastCopy.line}</p>
            <ul class="chamber__roles">
              ${last.roles.map((role) => html`<li class="chip">${t.lock.roles[role].name}</li>`)}
            </ul>
          </div>
        </div>
        ${ledger(t, false)}
      </div>
      <div class="lock__layer lock__water" data-lock-water>
        <div class="lock__scene" aria-hidden="true">${renderScene()}</div>
        <ol class="lock__flight">
          ${stages.map((stage) => chamber(t, stage))}
        </ol>
        ${ledger(t, true)}
      </div>
      <!-- 水面：一道波，带一线亮光，底下一条往下淡出的亮带。水从上往下退的时候，它压在水的上沿。 -->
      <svg class="lock__wave" viewBox="0 0 1200 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <defs><linearGradient id="lock-wave-fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--wave)"/><stop offset="1" style="stop-color:var(--wave)" stop-opacity="0"/></linearGradient></defs>
        <path class="lock__wave-body" d="M0 41V22C100 6 200 6 300 20S500 36 600 20S800 4 900 20S1100 34 1200 18V41Z"/>
        <rect x="0" y="40" width="1200" height="60" fill="url(#lock-wave-fade)"/>
        <path class="lock__wave-line" d="M0 22C100 6 200 6 300 20S500 36 600 20S800 4 900 20S1100 34 1200 18"/>
      </svg>
    </div>
  </div>
</section>`;
}
