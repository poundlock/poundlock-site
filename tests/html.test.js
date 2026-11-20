import { test } from 'node:test';
import assert from 'node:assert/strict';
import { html, raw, escapeHtml } from '../src/lib/html.js';

test('插值默认转义', () => assert.equal(String(html`<p>${'<b>&"'}</p>`), '<p>&lt;b&gt;&amp;&quot;</p>'));

test('Raw 和 Raw 的数组不再转义', () =>
  assert.equal(String(html`<ul>${[html`<li>${'a'}</li>`, raw('<li>b</li>')]}</ul>`), '<ul><li>a</li><li>b</li></ul>'));

test('null、undefined、false 渲染成空', () => assert.equal(String(html`a${null}${undefined}${false}b`), 'ab'));

test('数组里的字符串照样转义', () => assert.equal(String(html`${['<i>', raw('<b>')]}`), '&lt;i&gt;<b>'));

test('数字原样写出，单引号也转义', () => {
  assert.equal(String(html`<a data-n="${8}">`), '<a data-n="8">');
  assert.equal(escapeHtml(`it's`), 'it&#39;s');
});
