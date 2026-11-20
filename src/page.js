import { html } from './lib/html.js';
import * as header from './sections/header.js';
import * as hero from './sections/hero.js';
import * as pain from './sections/pain.js';
import * as lock from './sections/lock.js';
import * as breach from './sections/breach.js';
import * as contract from './sections/contract.js';
import * as roster from './sections/roster.js';
import * as limits from './sections/limits.js';
import * as install from './sections/install.js';
import * as footer from './sections/footer.js';

// ctx = { lang, t, base, config, version }
//   lang    config.langs 里的一项
//   t       这门语言的文案
//   base    到站点根的相对前缀：中文页 ''，英文页 '../'
//   config  站点配置（siteUrl 已经是这次生成用的那个）
//   version 这次生成的版本号

function head(ctx) {
  const { lang, t, base, config, version } = ctx;
  const pageUrl = config.siteUrl + lang.path;
  const defaultLang = config.langs.find((l) => l.code === config.defaultLang);
  return html`<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t.meta.title}</title>
<meta name="description" content="${t.meta.description}">
<link rel="canonical" href="${pageUrl}">
${config.langs.map((l) => html`<link rel="alternate" hreflang="${l.htmlLang}" href="${config.siteUrl + l.path}">
`)}<link rel="alternate" hreflang="x-default" href="${config.siteUrl + defaultLang.path}">
<meta property="og:type" content="website">
<meta property="og:title" content="${t.meta.title}">
<meta property="og:description" content="${t.meta.description}">
<meta property="og:url" content="${pageUrl}">
<meta property="og:image" content="${config.siteUrl}assets/social-preview.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="poundlock-site-version" content="${version}">
<link rel="icon" type="image/svg+xml" href="${base}assets/logo/poundlock-tile.svg">
<link rel="stylesheet" href="${base}assets/site.css">
<script>document.documentElement.classList.add('js',matchMedia('(prefers-reduced-motion: reduce)').matches?'motion-reduced':'motion-ok')</script>
<script>/* 临时：挑配色用，定稿后删掉 */(function(){var p=new URLSearchParams(location.search).get('palette');if(p)document.documentElement.dataset.palette=p})()</script>
<script type="module" src="${base}assets/scripts/main.js"></script>
</head>`;
}

// <main> 里各节的次序。页头和页尾在 <main> 外面。
const SECTIONS = [hero, pain, lock, breach, contract, roster, limits, install];

export function renderPage(ctx) {
  const { lang, config } = ctx;
  return String(html`<!doctype html>
<html lang="${lang.htmlLang}" data-repo-api="${config.repoApi}">
${head(ctx)}
<body>
${header.render(ctx)}
<main id="main">
${SECTIONS.map((section) => html`${section.render(ctx)}
`)}</main>
${footer.render(ctx)}
</body>
</html>
`);
}
