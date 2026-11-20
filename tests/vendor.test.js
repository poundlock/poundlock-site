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

test('three.js 是锁定的那一版', () => {
  const dir = path.resolve(DIR, '..', 'three');
  const [version, sha] = readFileSync(path.join(dir, 'VERSION'), 'utf8').split('\n');
  assert.equal(version, '0.187.0');
  const file = readFileSync(path.join(dir, 'three.module.min.js'));
  assert.equal(createHash('sha256').update(file).digest('hex'), sha);
  assert.match(file.subarray(0, 200).toString('utf8'), /Three\.js Authors[\s\S]*SPDX-License-Identifier: MIT/);
  assert.ok(existsSync(path.join(dir, 'LICENSE')), '许可文件要跟着库一起放');
});

test('three.js 只有过闸的三维版引它，入口和别的模块不引', () => {
  // 它有七百多 KB，只在快滚到过闸时才加载；谁要是在入口里静态引了它，首屏就被拖慢了。
  const scripts = path.resolve(DIR, '..', '..', 'scripts');
  for (const name of readdirSync(scripts)) {
    const text = readFileSync(path.join(scripts, name), 'utf8');
    if (name === 'lock3d.js') assert.match(text, /from '\.\.\/vendor\/three\/three\.module\.min\.js'/);
    else assert.doesNotMatch(text, /from\s+['"][^'"]*vendor\/three/, `${name} 静态引了 three.js`);
  }
});

test('anime.js 里没有往外的地址', () => {
  const text = readFileSync(path.join(DIR, 'anime.esm.min.js'), 'utf8');
  const urls = (text.match(/https?:\/\/[^\s"'`<>)]+/g) ?? []).filter((url) => !url.startsWith('http://www.w3.org/'));
  assert.deepEqual(urls, []);
});
