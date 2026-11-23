// 部署整个官网到 GitHub Pages（推 gh-pages）。2026-11-23 起正式地址在服务器上（deploy/server.js），
// Pages 那个旧地址改放跳转页（deploy/redirect.js 复用这里推 gh-pages 的那段）；这个脚本留着，Pages 要再放整站时用。
//
// 做的事：把页面生成到系统临时目录下的一个新目录，在那里建一个只有一次提交的临时仓库，
// 强推到官网仓库 origin 的 gh-pages 分支，再把临时目录删掉。gh-pages 上从来只有最新这一次提交：
// 影片有二十多 MB，每次部署都留历史的话仓库很快就大了；要回到哪一版，由 Wellyard 的部署 tag 记着。
//
//   node deploy/deploy.js --dry-run    只打印要做什么，不生成、不推
//
// 要的环境变量：SITE_URL（站点最终的地址，以 / 结尾，写在主仓库清单的部署目标里）、
// WELLYARD_DEPLOY_VERSION、WELLYARD_DEPLOY_COMMIT（Wellyard 给的）。
// 回滚时 Wellyard 在那一版的临时检出里跑这个脚本，生成出来的就是那一版的页面。

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BRANCH = 'gh-pages';

export function planDeploy(env) {
  const siteUrl = env.SITE_URL;
  if (!siteUrl) throw new Error('缺 SITE_URL：站点最终的地址，写在主仓库 workspace.json 里这个部署目标的 env 里。');
  if (!siteUrl.endsWith('/')) throw new Error(`SITE_URL 要以 / 结尾，现在是 ${siteUrl}`);
  const version = env.WELLYARD_DEPLOY_VERSION;
  const commit = env.WELLYARD_DEPLOY_COMMIT;
  if (!version) throw new Error('缺 WELLYARD_DEPLOY_VERSION：这个脚本由 wellyard deploy 调，版本号是它给的。');
  if (!commit) throw new Error('缺 WELLYARD_DEPLOY_COMMIT：这个脚本由 wellyard deploy 调，要上线的提交是它给的。');
  return { siteUrl, version, commit, branch: BRANCH };
}

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();

// 默认的生成步骤：按 plan.siteUrl 生成整个官网
export async function buildSite(dir, plan, log) {
  const { build } = await import('../build.js');
  const { pages } = await build({ outDir: dir, siteUrl: plan.siteUrl, version: plan.version, commit: plan.commit });
  log(`已生成 ${pages.length} 页。`);
}

// 生成（generate 往 dir 里写要上线的文件，默认是整个官网；deploy/redirect.js 换成跳转页）、建临时仓库、
// 强推到 origin 的 plan.branch。origin 是一个 git 地址（测试里是本机的一个空仓库）。
export async function deploy({ plan, origin, log = console.log, generate = buildSite }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'poundlock-site-deploy-'));
  try {
    await generate(dir, plan, log);
    git(dir, 'init', '--quiet', '--initial-branch', plan.branch);
    // 这是个刚建的、只装着生成结果的临时仓库，里面的东西全都要上线。
    git(dir, 'add', '--all');
    git(dir, 'commit', '--quiet', '-m', `部署 ${plan.version}（${plan.commit.slice(0, 7)}）`);
    git(dir, 'push', '--force', '--quiet', origin, `${plan.branch}:${plan.branch}`);
    log(`已推到 ${plan.branch}。`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  const plan = planDeploy(process.env);
  const origin = git(ROOT, 'remote', 'get-url', 'origin');
  console.log(`站点地址：${plan.siteUrl}`);
  console.log(`版本：${plan.version}`);
  console.log(`提交：${plan.commit}`);
  console.log(`推到：${origin} 的 ${plan.branch} 分支（强推，分支上只留这一次提交）`);
  if (process.argv.includes('--dry-run')) {
    console.log('--dry-run：到此为止，没有生成，也没有推。');
    return;
  }
  await deploy({ plan, origin });
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
