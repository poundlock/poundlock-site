// deploy/server.js：生成、打包、经 SSH 传到服务器。测试碰不到服务器：用替身 ssh 收下压缩包，解开看里面对不对。
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deployToServer, planServer } from '../deploy/server.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const COMMIT = 'abcdef0123456789abcdef0123456789abcdef01';
const made = [];
const temp = (prefix) => {
  const d = mkdtempSync(path.join(tmpdir(), prefix));
  made.push(d);
  return d;
};
after(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true, maxRetries: 5 });
});

function keyFile() {
  const f = path.join(temp('pl-server-key-'), 'id');
  writeFileSync(f, 'not a key');
  return f;
}

const env = (over = {}) => ({
  SITE_URL: 'https://site.example.invalid/',
  WELLYARD_DEPLOY_VERSION: '20261123',
  WELLYARD_DEPLOY_COMMIT: COMMIT,
  SSH_TARGET: 'deploy@example.invalid',
  SSH_PORT: '2222',
  SSH_KEY: keyFile(),
  REMOTE_DIR: '/var/www/site',
  ...over,
});

test('planServer：缺变量时一起列出来；SITE_URL 要以 / 结尾；SSH 那几个照 remote.js 核', () => {
  assert.throws(() => planServer({}), /SITE_URL.*WELLYARD_DEPLOY_VERSION.*WELLYARD_DEPLOY_COMMIT/s);
  assert.throws(() => planServer(env({ SITE_URL: 'https://site.example.invalid' })), /\//);
  assert.throws(() => planServer(env({ SSH_PORT: 'x' })), /SSH_PORT/);
  const plan = planServer(env());
  assert.equal(plan.siteUrl, 'https://site.example.invalid/');
  assert.equal(plan.version, '20261123');
  assert.equal(plan.ssh.remoteDir, '/var/www/site');
});

test('deployToServer：传过去的包里是按 SITE_URL 生成的两页、version.txt 是这次的提交、version.json 是这次的版本', async () => {
  const fakeDir = temp('pl-server-fake-');
  const bin = path.join(fakeDir, 'fake-ssh.mjs');
  copyFileSync(path.join(HERE, 'helpers', 'fake-ssh.js'), bin);
  const out = temp('pl-server-out-');
  const plan = planServer(env({ DEPLOY_SSH_FAKE: bin }));
  await deployToServer({ plan, env: { ...process.env, FAKE_SSH_OUT: out }, log: () => {} });

  const argv = JSON.parse(readFileSync(path.join(out, 'argv.json'), 'utf8'));
  assert.equal(argv.at(-2), 'deploy@example.invalid');
  assert.ok(argv.at(-1).includes("D='/var/www/site'"));

  const unpacked = temp('pl-server-unpacked-');
  copyFileSync(path.join(out, 'stdin.bin'), path.join(unpacked, 'site.tar.gz'));
  const r = spawnSync('tar', ['-xzf', 'site.tar.gz'], { cwd: unpacked, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(path.join(unpacked, 'version.txt'), 'utf8').trim(), COMMIT);
  assert.equal(JSON.parse(readFileSync(path.join(unpacked, 'version.json'), 'utf8')).version, '20261123');
  assert.ok(existsSync(path.join(unpacked, 'en', 'index.html')));
  const home = readFileSync(path.join(unpacked, 'index.html'), 'utf8');
  assert.ok(home.includes('<link rel="canonical" href="https://site.example.invalid/">'), '规范地址不是 SITE_URL');
});

test('server.js、remote.js 只 import node: 模块和仓库里的文件（回滚在临时检出里跑，没有 npm 依赖）', () => {
  for (const f of ['deploy/server.js', 'deploy/remote.js']) {
    const src = readFileSync(path.join(ROOT, f), 'utf8');
    const specs = [...src.matchAll(/(?:from\s+|import\()\s*'([^']+)'/g)].map((m) => m[1]);
    for (const s of specs) assert.ok(s.startsWith('node:') || s.startsWith('./') || s.startsWith('../'), `${f}：${s}`);
  }
});
