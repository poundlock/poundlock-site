// deploy/remote.js：经 SSH 把一个压缩包传到服务器，解到新的发布目录再原子换软链接。照 Wellyard 官网那份测试写的。
// 测试碰不到服务器：用替身 ssh 查拼出来的参数、服务器端脚本和传过去的字节，真正的切换在服务器上另验。
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { remoteScript, sshEnv, upload } from '../deploy/remote.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const COMMIT = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
// 建的临时目录都记下来，跑完删掉（部署前 deploy 都会跑整套测试，不删会越积越多）
const made = [];
const temp = (prefix) => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  made.push(d);
  return d;
};
after(() => { for (const d of made) rmSync(d, { recursive: true, force: true, maxRetries: 5 }); });

// keyFile() -> 临时目录里的一个假密钥（sshEnv 只查文件在不在）
function keyFile() {
  const f = join(temp('pl-remote-key-'), 'id');
  writeFileSync(f, 'not a key');
  return f;
}

// fake() -> { bin, out }：复制到临时目录的替身 ssh，和它记录参数、标准输入的目录
function fake() {
  // 复制成 .mjs：临时目录里没有 package.json，.js 会被当成 CommonJS
  const bin = join(temp('pl-remote-fake-'), 'fake-ssh.mjs');
  copyFileSync(join(HERE, 'helpers', 'fake-ssh.js'), bin);
  return { bin, out: temp('pl-remote-out-') };
}

const env = (over = {}) => ({ SSH_TARGET: 'deploy@example.invalid', SSH_PORT: '2222', SSH_KEY: keyFile(), REMOTE_DIR: '/var/www/site', ...over });

test('sshEnv：缺变量时列出缺的名字', () => {
  assert.throws(() => sshEnv({}), /SSH_TARGET.*SSH_PORT.*SSH_KEY.*REMOTE_DIR/s);
  assert.throws(() => sshEnv({ SSH_TARGET: 'a@b', SSH_PORT: '22' }), (e) => /SSH_KEY.*REMOTE_DIR/s.test(e.message) && !/SSH_TARGET/.test(e.message));
});

test('sshEnv：SSH_TARGET、SSH_PORT、REMOTE_DIR 写法不对时报错并点名', () => {
  const bad = [
    ['SSH_TARGET', 'example.invalid'], ['SSH_TARGET', 'a b@example.invalid'], ['SSH_TARGET', 'deploy@exa mple'],
    ['SSH_PORT', '22a'], ['SSH_PORT', '123456'],
    ['REMOTE_DIR', 'var/www/site'], ['REMOTE_DIR', '/'], ['REMOTE_DIR', '/www'], ['REMOTE_DIR', '/var/../etc'],
    ['REMOTE_DIR', '/var/www/site/'], ['REMOTE_DIR', "/var/www/si'te"], ['REMOTE_DIR', '/var//www'], ['REMOTE_DIR', '/var/./www'],
  ];
  for (const [k, v] of bad) assert.throws(() => sshEnv(env({ [k]: v })), new RegExp(k), `${k}=${v}`);
});

test('sshEnv：写法对时原样返回，SSH_KEY 开头的 ~/ 展开成家目录，密钥文件不在时报错', () => {
  const key = keyFile();
  assert.deepEqual(sshEnv(env({ SSH_KEY: key })), { target: 'deploy@example.invalid', port: '2222', key, remoteDir: '/var/www/site', fake: null });
  const missing = join(homedir(), 'pl-no-such-deploy-key-7f3a');
  assert.throws(() => sshEnv(env({ SSH_KEY: '~/pl-no-such-deploy-key-7f3a' })), (e) => e.message.includes(missing) && /SSH_KEY/.test(e.message));
});

test('sshEnv：DEPLOY_SSH_FAKE 只认系统临时目录下的文件（本机残留时不悄悄改走替身）', () => {
  assert.throws(() => sshEnv(env({ DEPLOY_SSH_FAKE: join(HERE, 'helpers', 'fake-ssh.js') })), /DEPLOY_SSH_FAKE/);
  const { bin } = fake();
  assert.equal(sshEnv(env({ DEPLOY_SSH_FAKE: bin })).fake, bin);
});

test('sshEnv：DEPLOY_SSH_FAKE 和 WELLYARD_DEPLOY_ID 同时有值时报错（wellyard 运行部署命令时一定设 WELLYARD_DEPLOY_ID，残留的替身不能让真部署假装成功）', () => {
  const { bin } = fake();
  assert.throws(() => sshEnv(env({ DEPLOY_SSH_FAKE: bin, WELLYARD_DEPLOY_ID: 'abcd1234' })), /DEPLOY_SSH_FAKE/);
});

test('替身 ssh：没设 FAKE_SSH_OUT 时以非 0 退出（不在没人看的地方假装传成功）', () => {
  const { bin } = fake();
  const childEnv = { ...process.env };
  delete childEnv.FAKE_SSH_OUT;
  const r = spawnSync(process.execPath, [bin, 'x'], { input: 'x', encoding: 'utf8', env: childEnv });
  assert.notEqual(r.status, 0);
});

test('remoteScript：切换以后不再因为清旧发布失败而报错（current 已经是新版，报失败会让部署记录和线上对不上）', () => {
  const s = remoteScript({ remoteDir: '/var/www/site', version: '20261116', commit: COMMIT, gzip: true });
  const at = (needle) => s.indexOf(needle);
  assert.ok(at('mv -Tf') < at('echo "switched') && at('echo "switched') < at('set +e') && at('set +e') < at('ls -1t'), '切换、报告、关掉 set -e、清旧发布要按这个顺序');
  assert.ok(s.trimEnd().endsWith('exit 0'), '清旧发布失败也以 0 退出');
});

test('remoteScript：只有 ASCII；外来文件检查在解包之前，换软链接在核对 version.txt 之后，清旧发布在最后', () => {
  const s = remoteScript({ remoteDir: '/var/www/site', version: '20261116', commit: COMMIT, gzip: true });
  assert.match(s, /^[\x00-\x7f]*$/, '远端脚本经命令行参数传过去，Windows 上非 ASCII 字符可能被转坏');
  assert.ok(s.includes("D='/var/www/site'"));
  assert.ok(s.includes(`C='${COMMIT}'`));
  assert.ok(s.includes("N='20261116'-"));
  assert.ok(s.includes('KEEP=3'));
  const at = (needle) => {
    const i = s.indexOf(needle);
    assert.ok(i >= 0, `脚本里没有 ${needle}`);
    return i;
  };
  const order = ['exit 3', 'exit 5', '-xzf - -C', 'version.txt', 'touch "$D/releases/$N"', 'ln -sfn', 'mv -Tf', 'ls -1t'].map(at);
  assert.deepEqual(order, [...order].sort((a, b) => a - b), '步骤顺序不对');
  // 解开的目录时间是打包时的（回滚时很旧），清旧发布按修改时间排，所以要 touch 成部署时刻；两台机器时钟差一点不刷警告
  assert.ok(s.includes('--warning=no-timestamp'));
});

test('remoteScript：gzip 决定 tar 解不解压；版本号、提交号写法不对时报错', () => {
  const plain = remoteScript({ remoteDir: '/var/www/site', version: '20261116b', commit: COMMIT, gzip: false });
  assert.ok(plain.includes('-xf - -C'));
  assert.ok(!plain.includes('-xzf'));
  assert.ok(remoteScript({ remoteDir: '/var/www/site', version: 'v1', commit: COMMIT, gzip: true, keep: 5 }).includes('KEEP=5'));
  assert.throws(() => remoteScript({ remoteDir: '/var/www/site', version: "1'; rm -rf /", commit: COMMIT, gzip: true }), /版本号/);
  assert.throws(() => remoteScript({ remoteDir: '/var/www/site', version: '1', commit: 'abc', gzip: true }), /提交/);
});

test('upload：替身 ssh 收到密钥、端口、BatchMode、StrictHostKeyChecking=yes、目标和远端脚本，标准输入就是那个文件', () => {
  const { bin, out } = fake();
  const cfg = sshEnv(env({ DEPLOY_SSH_FAKE: bin }));
  const payload = join(temp('pl-remote-payload-'), 'site.tar.gz');
  writeFileSync(payload, Buffer.from([0x1f, 0x8b, 0, 1, 2, 3, 255]));
  upload(payload, cfg, { version: '20261116', commit: COMMIT, gzip: true, env: { ...process.env, FAKE_SSH_OUT: out } });
  const argv = JSON.parse(readFileSync(join(out, 'argv.json'), 'utf8'));
  const opt = (k) => argv[argv.indexOf(k) + 1];
  assert.equal(opt('-i'), cfg.key);
  assert.equal(opt('-p'), '2222');
  for (const o of ['BatchMode=yes', 'StrictHostKeyChecking=yes', 'IdentitiesOnly=yes']) assert.ok(argv.includes(o), o);
  assert.equal(argv.at(-2), 'deploy@example.invalid');
  assert.equal(argv.at(-1), remoteScript({ remoteDir: '/var/www/site', version: '20261116', commit: COMMIT, gzip: true }));
  assert.deepEqual(readFileSync(join(out, 'stdin.bin')), readFileSync(payload));
});

test('upload：连不上（退出码 255）提示先手动 ssh 核对指纹；远端脚本失败时说清是哪种并带上远端输出', () => {
  const { bin, out } = fake();
  const cfg = sshEnv(env({ DEPLOY_SSH_FAKE: bin }));
  const payload = join(temp('pl-remote-payload-'), 'x.tar');
  writeFileSync(payload, 'x');
  const run = (code, stderr) => () => upload(payload, cfg, { version: '1', commit: COMMIT, gzip: false, env: { ...process.env, FAKE_SSH_OUT: out, FAKE_SSH_EXIT: String(code), FAKE_SSH_STDERR: stderr } });
  assert.throws(run(255, 'Host key verification failed.'), (e) => /手动 ssh/.test(e.message) && /Host key verification failed/.test(e.message) && /version\.txt/.test(e.message));
  assert.throws(run(3, ''), /服务器上没有 \/var\/www\/site/);
  assert.throws(run(5, 'foreign: x.html'), (e) => /REMOTE_DIR/.test(e.message) && /foreign: x\.html/.test(e.message));
  assert.throws(run(4, ''), /version\.txt/);
  assert.throws(run(2, 'tar: Unexpected EOF'), (e) => /退出码 2/.test(e.message) && /Unexpected EOF/.test(e.message));
});
