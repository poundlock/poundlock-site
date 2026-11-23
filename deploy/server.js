// 部署到服务器（poundlock.irmox.com）。由 `wellyard deploy site --to prod` 调，不要直接跑（直接跑不记部署 tag）。
//
// 做的事：把页面按 SITE_URL 生成到系统临时目录下的一个新目录，写一个 version.txt（这次的提交），打成压缩包，
// 一条 ssh 传到服务器的 REMOTE_DIR：在那里解到新的发布目录、核对 version.txt、原子地把软链接 current 换过去（deploy/remote.js），
// 最后删掉临时目录。切换之前任何一步失败，线上都还是旧版本。
// 回滚时 Wellyard 在那一版的临时检出里跑这个脚本，生成出来的就是那一版的页面（生成不要 npm 依赖）。
//
//   node deploy/server.js --dry-run    只打印要做什么，不生成、不传
//
// 要的环境变量（写在主仓库清单的部署目标里，这个仓库是公开的，不写服务器的地址）：
//   SITE_URL（站点地址，以 / 结尾）、SSH_TARGET（部署用户@主机）、SSH_PORT、SSH_KEY（部署密钥的路径，~ 开头是家目录）、REMOTE_DIR；
//   WELLYARD_DEPLOY_VERSION、WELLYARD_DEPLOY_COMMIT（Wellyard 给的）。
// 只用 Node 自带模块和系统的 ssh、tar。tar 一律用相对路径（Git Bash 的 GNU tar 会把 C: 当成远程主机）。

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sshEnv, upload } from './remote.js';

const ARCHIVE = 'site.tar.gz';

// planServer(env) -> { siteUrl, version, commit, ssh }；缺变量、写法不对就抛错并点名
export function planServer(env) {
  const missing = ['SITE_URL', 'WELLYARD_DEPLOY_VERSION', 'WELLYARD_DEPLOY_COMMIT'].filter((k) => !env[k]);
  if (missing.length) throw new Error(`缺环境变量：${missing.join('、')}（SITE_URL 写在主仓库清单的部署目标里，另两个是 wellyard deploy 给的）`);
  if (!env.SITE_URL.endsWith('/')) throw new Error(`SITE_URL 要以 / 结尾，现在是 ${env.SITE_URL}`);
  return { siteUrl: env.SITE_URL, version: env.WELLYARD_DEPLOY_VERSION, commit: env.WELLYARD_DEPLOY_COMMIT, ssh: sshEnv(env) };
}

// pack(plan, dir) -> 压缩包的路径：在 dir 下生成页面（dir/site）、写 version.txt、打成 dir/site.tar.gz
export async function pack(plan, dir, log = console.log) {
  const { build } = await import('../build.js');
  const out = path.join(dir, 'site');
  const { pages } = await build({ outDir: out, siteUrl: plan.siteUrl, version: plan.version, commit: plan.commit });
  // 服务器上的部署脚本核对它：解开的就是这次的提交，才切换
  writeFileSync(path.join(out, 'version.txt'), `${plan.commit}\n`);
  const r = spawnSync('tar', ['-czf', ARCHIVE, '-C', 'site', '.'], { cwd: dir, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`打包失败：${(r.stderr || r.stdout || r.error?.message || '').trim()}`);
  log(`已生成 ${pages.length} 页，打好包。`);
  return path.join(dir, ARCHIVE);
}

export async function deployToServer({ plan, env = process.env, log = console.log }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'poundlock-site-server-'));
  try {
    const archive = await pack(plan, dir, log);
    upload(archive, plan.ssh, { version: plan.version, commit: plan.commit, gzip: true, env });
    log(`已传到服务器并切换：版本 ${plan.version}，提交 ${plan.commit.slice(0, 12)}。`);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
}

async function main() {
  const plan = planServer(process.env);
  console.log(`站点地址：${plan.siteUrl}`);
  console.log(`版本：${plan.version}`);
  console.log(`提交：${plan.commit}`);
  console.log(`传到：服务器的 ${plan.ssh.remoteDir}（新的发布目录，原子切换 current）`);
  if (process.argv.includes('--dry-run')) {
    console.log('--dry-run：到此为止，没有生成，也没有传。');
    return;
  }
  await deployToServer({ plan });
  console.log(`用 node deploy/health.js ${plan.version} 核线上的版本。`);
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
