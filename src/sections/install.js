import { html } from '../lib/html.js';
import { install, firstRun, readmeAnchors } from '../facts.js';

export function render(ctx) {
  const { t, lang, config } = ctx;
  return html`<section id="install" class="install" data-section="install" data-zone="light">
  <header class="section__head">
    <h2 class="section__title">${t.install.title}</h2>
    <p class="section__lead">${t.install.lead}</p>
  </header>
  <div class="install__cmd">
    <pre class="install__pre" data-copy-source tabindex="0"><code>${install.join('\n')}</code></pre>
    <button type="button" class="btn btn--small install__copy" data-copy data-label-copied="${t.install.copied}" data-label-fallback="${t.install.copyFallback}" data-fit>${t.install.copy}</button>
  </div>
  <p class="install__warning">${t.install.scopeWarning}</p>
  <h3 class="install__first-title">${t.install.firstRunTitle}</h3>
  <ol class="install__first">
    ${firstRun.map(
      (command, i) => html`<li>
      <code>${command}</code>
      <span>${t.install.firstRunSteps[i]}</span>
    </li>`,
    )}
  </ol>
  <p class="section__more"><a href="${config.repoUrl + readmeAnchors[lang.code].install}">${t.install.more}</a></p>
</section>`;
}
