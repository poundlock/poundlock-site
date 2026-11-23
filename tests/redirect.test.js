// deploy/redirect.js：旧的 GitHub Pages 地址改成跳到新地址的页面。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deploy } from '../deploy/deploy.js';
import { planRedirect, redirectFiles, redirectScript, writeRedirect } from '../deploy/redirect.js';

const OLD = 'https://poundlock.github.io/poundlock-site/';
const NEW = 'https://poundlock.irmox.com/';
const COMMIT = 'abcdef0123456789abcdef0123456789abcdef01';
const ENV = { SITE_URL: OLD, REDIRECT_TO: NEW, WELLYARD_DEPLOY_VERSION: '20261123', WELLYARD_DEPLOY_COMMIT: COMMIT };

test('planRedirect：缺 REDIRECT_TO、写法不对、和旧地址一样都抛', () => {
  assert.throws(() => planRedirect({ ...ENV, REDIRECT_TO: undefined }), /REDIRECT_TO/);
  assert.throws(() => planRedirect({ ...ENV, REDIRECT_TO: 'https://poundlock.irmox.com' }), /REDIRECT_TO/);
  assert.throws(() => planRedirect({ ...ENV, REDIRECT_TO: 'http://poundlock.irmox.com/' }), /REDIRECT_TO/);
  assert.throws(() => planRedirect({ ...ENV, REDIRECT_TO: 'https://evil.example/"><script>/' }), /REDIRECT_TO/);
  assert.throws(() => planRedirect({ ...ENV, SITE_URL: undefined }), /SITE_URL/);
  assert.equal(planRedirect(ENV).redirectTo, NEW);
});

// 在假的 location 上跑页面里的那段脚本，看它跳到哪
function jump(plan, { pathname, search = '', hash = '' }) {
  let target = null;
  const location = { pathname, search, hash, replace: (url) => (target = url) };
  new Function('location', redirectScript(plan))(location);
  return target;
}

test('跳转脚本：旧地址的路径前缀换成新地址，带上查询和锚点', () => {
  const plan = planRedirect(ENV);
  assert.equal(jump(plan, { pathname: '/poundlock-site/' }), NEW);
  assert.equal(jump(plan, { pathname: '/poundlock-site/en/', hash: '#lock' }), `${NEW}en/#lock`);
  assert.equal(jump(plan, { pathname: '/poundlock-site/index.html', search: '?a=1' }), `${NEW}index.html?a=1`);
  assert.equal(jump(plan, { pathname: '/poundlock-site/assets/reef/manifest.json' }), `${NEW}assets/reef/manifest.json`);
  // 不在前缀下（理论上到不了）：也跳到新地址，不留在旧站
  assert.equal(jump(plan, { pathname: '/other/x' }), `${NEW}other/x`);
});

test('跳转页：首页、英文页、404 都在，标新地址是规范地址、noindex，关了脚本也能靠 meta refresh 跳', () => {
  const files = redirectFiles(planRedirect(ENV));
  for (const name of ['index.html', 'en/index.html', '404.html', 'version.json', '.nojekyll']) assert.ok(name in files, name);
  assert.ok(files['index.html'].includes(`<link rel="canonical" href="${NEW}">`));
  assert.ok(files['index.html'].includes(`content="0; url=${NEW}"`));
  assert.ok(files['en/index.html'].includes(`<link rel="canonical" href="${NEW}en/">`));
  assert.ok(files['en/index.html'].includes('lang="en"'));
  for (const name of ['index.html', 'en/index.html', '404.html']) {
    assert.ok(files[name].includes('<meta name="robots" content="noindex">'), name);
    assert.ok(files[name].includes('location.replace'), name);
    // 不从外面加载任何东西
    assert.ok(!/src=|<link rel="stylesheet"/.test(files[name]), name);
  }
  const info = JSON.parse(files['version.json']);
  assert.equal(info.version, '20261123');
  assert.equal(info.redirectTo, NEW);
});

test('真推一次（推到本机临时建的空仓库）：gh-pages 上只有一次提交，里面是跳转页', async () => {
  const remote = mkdtempSync(path.join(tmpdir(), 'poundlock-site-redirect-'));
  const git = (...args) => execFileSync('git', args, { cwd: remote, encoding: 'utf8' }).trim();
  try {
    git('init', '--bare', '--quiet');
    await deploy({ plan: planRedirect(ENV), origin: remote, log: () => {}, generate: writeRedirect });
    assert.equal(git('rev-list', '--count', 'gh-pages'), '1');
    const files = git('ls-tree', '-r', '--name-only', 'gh-pages').split('\n').sort();
    assert.deepEqual(files, ['.nojekyll', '404.html', 'en/index.html', 'index.html', 'version.json']);
    assert.equal(JSON.parse(git('show', 'gh-pages:version.json')).version, '20261123');
  } finally {
    rmSync(remote, { recursive: true, force: true });
  }
});
