import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatStars, loadStars, mountStars } from '../src/scripts/stars.js';

const API = 'https://api.github.com/repos/poundlock/poundlock-skills';

function memoryStorage() {
  const map = new Map();
  return { getItem: (key) => (map.has(key) ? map.get(key) : null), setItem: (key, value) => map.set(key, String(value)), map };
}

const respond = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test('formatStars', () => {
  assert.equal(formatStars(0), '0');
  assert.equal(formatStars(987), '987');
  assert.equal(formatStars(1000), '1k');
  assert.equal(formatStars(1234), '1.2k');
  assert.equal(formatStars(9960), '10k');
  assert.equal(formatStars(12345), '12k');
});

test('取到数就缓存，再取不发请求', async () => {
  const storage = memoryStorage();
  let calls = 0;
  const fetchImpl = async (url) => {
    calls++;
    assert.equal(url, API);
    return { ok: true, status: 200, json: async () => ({ stargazers_count: 42 }) };
  };
  assert.equal(await loadStars({ api: API, fetchImpl, storage }), 42);
  assert.equal(storage.getItem('pl-stars'), '42');
  assert.equal(await loadStars({ api: API, fetchImpl, storage }), 42);
  assert.equal(calls, 1);
});

test('取不到就是 null，而且不抛', async () => {
  const cases = {
    '404': respond(404, { message: 'Not Found' }),
    '403 限流': respond(403, { message: 'API rate limit exceeded' }),
    '断网': async () => {
      throw new TypeError('Failed to fetch');
    },
    '不是数字': respond(200, { stargazers_count: 'x' }),
    '负数': respond(200, { stargazers_count: -1 }),
    '没有这个字段': respond(200, {}),
    '返回体不是 JSON': async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    }),
  };
  for (const [name, fetchImpl] of Object.entries(cases)) {
    assert.equal(await loadStars({ api: API, fetchImpl, storage: memoryStorage() }), null, name);
  }
});

test('取不到的时候不往缓存里写', async () => {
  const storage = memoryStorage();
  await loadStars({ api: API, fetchImpl: respond(404, {}), storage });
  assert.equal(storage.map.size, 0);
});

test('storage 用不了也照常取', async () => {
  const broken = {
    getItem() {
      throw new Error('SecurityError');
    },
    setItem() {
      throw new Error('QuotaExceededError');
    },
  };
  assert.equal(await loadStars({ api: API, fetchImpl: respond(200, { stargazers_count: 7 }), storage: broken }), 7);
});

test('缓存里是坏数据就重新取', async () => {
  const storage = memoryStorage();
  storage.setItem('pl-stars', 'abc');
  assert.equal(await loadStars({ api: API, fetchImpl: respond(200, { stargazers_count: 5 }), storage }), 5);
});

function fakeDoc(count) {
  const elements = Array.from({ length: count }, () => ({ hidden: true, textContent: '' }));
  return { elements, querySelectorAll: (selector) => (selector === '[data-star-count]' ? elements : []) };
}

test('mountStars 填上数字并显示', () => {
  const doc = fakeDoc(3);
  mountStars(doc, 1234);
  for (const element of doc.elements) {
    assert.equal(element.hidden, false);
    assert.equal(element.textContent, '1.2k');
  }
});

test('mountStars(null) 不动页面', () => {
  const doc = fakeDoc(2);
  mountStars(doc, null);
  for (const element of doc.elements) {
    assert.equal(element.hidden, true);
    assert.equal(element.textContent, '');
  }
});

// 仓库刚公开时星标数是 0：按钮旁边挂一个「0」只会减分，等有了第一颗再显示。
test('mountStars(0) 不显示数字，有了第一颗才显示', () => {
  const none = fakeDoc(2);
  mountStars(none, 0);
  for (const element of none.elements) {
    assert.equal(element.hidden, true);
    assert.equal(element.textContent, '');
  }
  const one = fakeDoc(2);
  mountStars(one, 1);
  for (const element of one.elements) {
    assert.equal(element.hidden, false);
    assert.equal(element.textContent, '1');
  }
});
