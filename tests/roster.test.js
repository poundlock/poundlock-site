import { test } from 'node:test';
import assert from 'node:assert/strict';
import { edgesOf, linkedTo } from '../src/scripts/roster.js';
import { dispatch } from '../src/facts.js';

const EDGES = Object.entries(dispatch).flatMap(([from, list]) => list.map((to) => `${from}>${to}`));

test('edgesOf：一个角色连着的线，派进来的、派出去的都算', () => {
  assert.deepEqual(edgesOf('architect', EDGES).sort(), ['architect>android', 'architect>backend', 'architect>frontend', 'architect>ios', 'architect>ui', 'pm>architect'].sort());
  assert.deepEqual(edgesOf('ui', EDGES).sort(), ['architect>ui', 'product>ui']);
  assert.deepEqual(edgesOf('qa', EDGES), ['pm>qa']);
  assert.deepEqual(edgesOf('nobody', EDGES), []);
});

test('edgesOf：名字是另一个名字的一部分时不串（pm 不会带上 product 自己派出去的线）', () => {
  assert.ok(!edgesOf('pm', EDGES).includes('product>ui'));
  assert.deepEqual(edgesOf('pm', EDGES).sort(), ['pm>acceptance', 'pm>architect', 'pm>product', 'pm>qa']);
});

test('linkedTo：线另一头的角色', () => {
  assert.deepEqual(linkedTo('architect', EDGES).sort(), ['android', 'backend', 'frontend', 'ios', 'pm', 'ui']);
  assert.deepEqual(linkedTo('ui', EDGES).sort(), ['architect', 'product']);
});
