import { test } from 'node:test';
import assert from 'node:assert/strict';
import { styleWriter } from '../src/scripts/style-writer.js';

function fakeElement() {
  const calls = [];
  return {
    calls,
    style: {
      setProperty: (name, value) => calls.push(['set', name, value]),
      removeProperty: (name) => calls.push(['remove', name]),
    },
  };
}

test('styleWriter：同一个值连着写只写一次，值变了才再写', () => {
  const el = fakeElement();
  const vars = styleWriter(el);
  vars.set('--rise', '0.5000');
  vars.set('--rise', '0.5000');
  vars.set('--rise', '0.5000');
  vars.set('--rise', '0.5100');
  vars.set('--other', '1');
  vars.set('--other', '1');
  assert.deepEqual(el.calls, [
    ['set', '--rise', '0.5000'],
    ['set', '--rise', '0.5100'],
    ['set', '--other', '1'],
  ]);
});

test('styleWriter：clear 删掉以后，再写同一个值要真的写上', () => {
  const el = fakeElement();
  const vars = styleWriter(el);
  vars.set('--header-day', '1');
  vars.clear('--header-day');
  vars.set('--header-day', '1');
  assert.deepEqual(el.calls, [
    ['set', '--header-day', '1'],
    ['remove', '--header-day'],
    ['set', '--header-day', '1'],
  ]);
});

test('styleWriter：没有元素时什么都不做，也不抛', () => {
  const vars = styleWriter(null);
  assert.doesNotThrow(() => {
    vars.set('--rise', '1');
    vars.clear('--rise');
  });
});
