import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'vendor', 'animejs');

test('anime.js 是锁定的那一版', () => {
  const [version, sha] = readFileSync(path.join(DIR, 'VERSION'), 'utf8').trim().split('\n');
  assert.equal(version, '4.5.0');
  const file = readFileSync(path.join(DIR, 'anime.esm.min.js'));
  assert.equal(createHash('sha256').update(file).digest('hex'), sha);
  assert.match(file.subarray(0, 200).toString('utf8'), /@version v4\.5\.0/);
  assert.ok(existsSync(path.join(DIR, 'LICENSE.md')), '许可文件要跟着库一起放');
});

test('实时三维撤掉以后，three.js 不在仓库里，也没有脚本引它', () => {
  // 过闸改成了离线渲好的长条图（lock-reef.js，自己写的 WebGL），那七百多 KB 的三维库不该再跟着页面走。
  assert.ok(!existsSync(path.resolve(DIR, '..', 'three')), 'src/vendor/three 还在');
  const scripts = path.resolve(DIR, '..', '..', 'scripts');
  for (const name of readdirSync(scripts)) {
    const text = readFileSync(path.join(scripts, name), 'utf8');
    assert.doesNotMatch(text, /vendor\/three|lock3d/, `${name} 还引着三维的东西`);
  }
});

test('anime.js 里没有往外的地址', () => {
  const text = readFileSync(path.join(DIR, 'anime.esm.min.js'), 'utf8');
  const urls = (text.match(/https?:\/\/[^\s"'`<>)]+/g) ?? []).filter((url) => !url.startsWith('http://www.w3.org/'));
  assert.deepEqual(urls, []);
});
