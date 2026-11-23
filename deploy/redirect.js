// 把旧的 GitHub Pages 地址（SITE_URL）改成跳到新地址（REDIRECT_TO）的页面。由 `wellyard deploy site --to pages` 调，不要直接跑。
//
// 官网 2026-11-23 搬到了 poundlock.irmox.com（deploy/server.js）。旧地址上已经有人收藏、贴过链接，插件仓库以前也链着它，
// 所以不关掉，改成跳转页：GitHub Pages 做不了服务器端的 301，只能在页面里跳。
//   - 首页、英文页：脚本带着原来的路径、查询和锚点跳到新地址的同一处；关了脚本就靠 meta refresh 跳到对应的那页。
//   - 别的路径（旧地址上的资源、写错的地址）：GitHub Pages 给 404.html，它用同样的脚本跳。
//   - 每页都标新地址是规范地址、旧页 noindex，搜索引擎照这个换过去。
// 推 gh-pages 的做法和 deploy/deploy.js 一样（分支上只留这一次提交）。version.json 照样写，deploy/health.js 照样能核。
//
//   node deploy/redirect.js --dry-run    只打印要做什么，不生成、不推
//
// 要的环境变量：SITE_URL（旧地址）、REDIRECT_TO（新地址），都以 / 结尾，写在主仓库清单的部署目标里；
// WELLYARD_DEPLOY_VERSION、WELLYARD_DEPLOY_COMMIT（Wellyard 给的）。

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deploy, planDeploy } from './deploy.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function planRedirect(env) {
  const plan = planDeploy(env);
  const to = env.REDIRECT_TO;
  if (!to) throw new Error('缺 REDIRECT_TO：要跳到的新地址，写在主仓库 workspace.json 里这个部署目标的 env 里。');
  if (!/^https:\/\/[a-z0-9.-]+\/$/.test(to)) throw new Error(`REDIRECT_TO 要写成 https://<域名>/（以 / 结尾），现在是 ${to}`);
  if (to === plan.siteUrl) throw new Error('REDIRECT_TO 和 SITE_URL 一样，会跳回自己');
  return { ...plan, redirectTo: to };
}

// 页面里跳转的那段脚本：把旧地址的路径前缀（比如 /poundlock-site/）换成新地址，带上查询和锚点
export function redirectScript(plan) {
  const base = new URL(plan.siteUrl).pathname;
  return `(function(){var b=${JSON.stringify(base)},t=${JSON.stringify(plan.redirectTo)},p=location.pathname;p=p.indexOf(b)===0?p.slice(b.length):p.replace(/^\\//,'');location.replace(t+p+location.search+location.hash);})();`;
}

function page({ lang, title, body, target, plan }) {
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="robots" content="noindex">
<link rel="canonical" href="${target}">
<script>${redirectScript(plan)}</script>
<meta http-equiv="refresh" content="0; url=${target}">
<style>body{font:16px/1.7 system-ui,-apple-system,"Segoe UI",sans-serif;max-width:36rem;margin:4rem auto;padding:0 1rem}</style>
</head>
<body>
${body}
</body>
</html>
`;
}

// redirectFiles(plan) -> { 相对路径: 内容 }
export function redirectFiles(plan) {
  const to = plan.redirectTo;
  const link = (href) => `<a href="${href}">${href.replace(/^https:\/\//, '').replace(/\/$/, '')}</a>`;
  const zh = `<p>poundlock 的官网搬到了 ${link(to)}。</p>`;
  const en = `<p>The poundlock site has moved to ${link(`${to}en/`)}.</p>`;
  return {
    'index.html': page({ lang: 'zh-CN', title: 'poundlock 的官网搬家了', body: zh, target: to, plan }),
    'en/index.html': page({ lang: 'en', title: 'The poundlock site has moved', body: en, target: `${to}en/`, plan }),
    '404.html': page({ lang: 'zh-CN', title: 'poundlock 的官网搬家了', body: `${zh}\n${en}`, target: to, plan }),
    'version.json': `${JSON.stringify({ version: plan.version, commit: plan.commit, redirectTo: to, builtAt: new Date().toISOString() })}\n`,
    '.nojekyll': '',
  };
}

export async function writeRedirect(dir, plan, log = console.log) {
  const files = redirectFiles(plan);
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), content);
  }
  log(`已生成跳转页（${Object.keys(files).length} 个文件），跳到 ${plan.redirectTo}。`);
}

async function main() {
  const plan = planRedirect(process.env);
  const origin = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
  console.log(`旧地址：${plan.siteUrl}`);
  console.log(`跳到：${plan.redirectTo}`);
  console.log(`版本：${plan.version}`);
  console.log(`提交：${plan.commit}`);
  console.log(`推到：${origin} 的 ${plan.branch} 分支（强推，分支上只留这一次提交）`);
  if (process.argv.includes('--dry-run')) {
    console.log('--dry-run：到此为止，没有生成，也没有推。');
    return;
  }
  await deploy({ plan, origin, generate: writeRedirect });
  console.log(`GitHub Pages 要过一两分钟才换上新的：用 node deploy/health.js ${plan.version} 核。`);
}

function isMain() {
  if (!process.argv[1]) return false;
  const here = fileURLToPath(import.meta.url);
  const entry = path.resolve(process.argv[1]);
  return process.platform === 'win32' ? here.toLowerCase() === entry.toLowerCase() : here === entry;
}

if (isMain()) {
  try {
    await main();
  } catch (error) {
    console.error(`部署没成：${error.message}`);
    process.exit(1);
  }
}
