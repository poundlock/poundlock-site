import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deploy, planDeploy } from '../deploy/deploy.js';
import { checkHealth } from '../deploy/health.js';

const SITE_URL = 'https://poundlock.github.io/poundlock-site/';
const COMMIT = 'abcdef0123456789abcdef0123456789abcdef01';
const ENV = { SITE_URL, WELLYARD_DEPLOY_VERSION: '20261120', WELLYARD_DEPLOY_COMMIT: COMMIT };

test('planDeploy 缺 SITE_URL 就抛', () => {
  assert.throws(() => planDeploy({ ...ENV, SITE_URL: undefined }), /SITE_URL/);
  assert.throws(() => planDeploy({ ...ENV, SITE_URL: '' }), /SITE_URL/);
});

test('planDeploy 的 SITE_URL 要以 / 结尾', () => {
  assert.throws(() => planDeploy({ ...ENV, SITE_URL: 'https://poundlock.github.io/poundlock-site' }), /\//);
});

test('planDeploy 缺版本或提交就抛', () => {
  assert.throws(() => planDeploy({ ...ENV, WELLYARD_DEPLOY_VERSION: undefined }), /WELLYARD_DEPLOY_VERSION/);
  assert.throws(() => planDeploy({ ...ENV, WELLYARD_DEPLOY_COMMIT: undefined }), /WELLYARD_DEPLOY_COMMIT/);
});

test('planDeploy 取 Wellyard 给的版本和提交', () => {
  assert.deepEqual(planDeploy(ENV), { siteUrl: SITE_URL, version: '20261120', commit: COMMIT, branch: 'gh-pages' });
});

// 假的 fetch：按顺序给出每一次的结果。给的是版本号就返回带这个版本的 version.json，给的是 Error 就拒绝。
function fakeFetch(answers) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    const answer = answers[Math.min(calls.length - 1, answers.length - 1)];
    if (answer instanceof Error) throw answer;
    return { ok: true, json: async () => ({ version: answer }) };
  };
  return { fetchImpl, calls };
}

test('checkHealth：版本对上就通过', async () => {
  const { fetchImpl, calls } = fakeFetch(['20261120']);
  assert.equal(await checkHealth({ siteUrl: SITE_URL, version: '20261120', fetchImpl, delayMs: 0 }), true);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].startsWith(`${SITE_URL}version.json`), calls[0]);
});

test('checkHealth：先旧后新', async () => {
  const { fetchImpl, calls } = fakeFetch(['20261119', '20261119', '20261120']);
  assert.equal(await checkHealth({ siteUrl: SITE_URL, version: '20261120', fetchImpl, delayMs: 0 }), true);
  assert.equal(calls.length, 3);
});

test('checkHealth：一直不对就不通过', async () => {
  const { fetchImpl, calls } = fakeFetch(['20261119']);
  assert.equal(await checkHealth({ siteUrl: SITE_URL, version: '20261120', fetchImpl, retries: 3, delayMs: 0 }), false);
  assert.equal(calls.length, 3);
});

test('checkHealth：取不到也接着试', async () => {
  const { fetchImpl, calls } = fakeFetch([new Error('ENOTFOUND'), '20261120']);
  assert.equal(await checkHealth({ siteUrl: SITE_URL, version: '20261120', fetchImpl, delayMs: 0 }), true);
  assert.equal(calls.length, 2);
});

test('checkHealth：服务器回了错误页（不是 2xx）不算通过', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return { ok: false, json: async () => ({ version: '20261120' }) };
  };
  assert.equal(await checkHealth({ siteUrl: SITE_URL, version: '20261120', fetchImpl, retries: 2, delayMs: 0 }), false);
  assert.equal(calls, 2);
});

// 预先装进子进程的探针：有人调 process.exit 就在 stderr 留一个记号，再照常退出。
const EXIT_PROBE = `data:text/javascript,${encodeURIComponent(
  "const exit = process.exit; process.exit = (code) => { process.stderr.write('FORCED_EXIT'); exit(code); };",
)}`;

// 起一个本机的小服务当「线上」，把 health.js 当命令行真跑一遍。
async function runHealthCli(version, served) {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ version: served }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const child = spawn(process.execPath, ['--import', EXIT_PROBE, fileURLToPath(new URL('../deploy/health.js', import.meta.url)), version], {
      env: { ...process.env, SITE_URL: `http://127.0.0.1:${server.address().port}/` },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    const code = await new Promise((resolve) => child.on('close', resolve));
    return { code, stdout, stderr };
  } finally {
    server.close();
  }
}

// 第一次上线后撞到的：线上已经是这一版时，脚本取完网络马上 process.exit，Node 24 在 Windows 上
// 退出时崩掉（libuv 的断言），话印对了、退出码却是 127，验收会被当成没过。崩溃只在 HTTPS 上出现，
// 本机的明文服务复现不了，所以这里核的是成因：取过网络以后不强行退出，退出码交给 process.exitCode。
test('health.js 的命令行：线上已经是这一版，退出码 0，而且不是强行退出的', async () => {
  const result = await runHealthCli('20261120', '20261120');
  assert.match(result.stdout, /线上是 20261120/);
  assert.equal(result.stderr, '');
  assert.equal(result.code, 0);
});

test('deploy：真推一次（推到本机临时建的空仓库）——gh-pages 上只有一次提交，里面是这一版的页面', async () => {
  const remote = mkdtempSync(path.join(tmpdir(), 'poundlock-site-remote-'));
  const git = (...args) => execFileSync('git', args, { cwd: remote, encoding: 'utf8' }).trim();
  try {
    git('init', '--bare', '--quiet');
    const lines = [];
    // 推两次：第二次是强推，分支上还是只有一次提交。
    await deploy({ plan: planDeploy(ENV), origin: remote, log: (line) => lines.push(line) });
    await deploy({ plan: planDeploy({ ...ENV, WELLYARD_DEPLOY_VERSION: '20261121' }), origin: remote, log: (line) => lines.push(line) });
    assert.equal(git('rev-list', '--count', 'gh-pages'), '1');
    const files = git('ls-tree', '-r', '--name-only', 'gh-pages').split('\n');
    for (const name of ['index.html', 'en/index.html', 'version.json', '.nojekyll', 'assets/site.css', 'assets/scripts/main.js']) {
      assert.ok(files.includes(name), `推上去的东西里没有 ${name}`);
    }
    const info = JSON.parse(git('show', 'gh-pages:version.json'));
    assert.equal(info.version, '20261121');
    assert.equal(info.commit, COMMIT);
    // 页面里的地址是这次部署的站点地址。
    assert.ok(git('show', 'gh-pages:index.html').includes(`<link rel="canonical" href="${SITE_URL}">`));
    assert.match(git('log', '-1', '--format=%s', 'gh-pages'), /20261121/);
  } finally {
    rmSync(remote, { recursive: true, force: true });
  }
});
