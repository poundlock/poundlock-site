import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBreachState } from '../src/scripts/breach.js';
import { breach } from '../src/facts.js';

const IDS = breach.map((item) => item.id);

test('第一次试和重复试', () => {
  const state = createBreachState(IDS);
  assert.deepEqual(state.attempt('skip-level'), { id: 'skip-level', first: true, tried: 1, allTried: false });
  assert.deepEqual(state.attempt('skip-level'), { id: 'skip-level', first: false, tried: 1, allTried: false });
  assert.deepEqual(state.attempt('cross-dir'), { id: 'cross-dir', first: true, tried: 2, allTried: false });
});

test('全部试过', () => {
  const state = createBreachState(IDS);
  const results = IDS.map((id) => state.attempt(id));
  assert.deepEqual(results.map((r) => r.allTried), [false, false, false, false, false, true]);
  assert.equal(results.at(-1).tried, 6);
  // 都试过以后再点，仍然算都试过。
  assert.equal(state.attempt(IDS[0]).allTried, true);
});

test('reset', () => {
  const state = createBreachState(IDS);
  IDS.forEach((id) => state.attempt(id));
  state.reset();
  assert.deepEqual(state.attempt('skip-level'), { id: 'skip-level', first: true, tried: 1, allTried: false });
});

test('不认识的 id', () => {
  const state = createBreachState(IDS);
  assert.throws(() => state.attempt('zzz'), RangeError);
  // 抛了以后不算试过。
  assert.equal(state.attempt('skip-level').tried, 1);
});

test('一种办法都没有的时候，不算「全部试过」', () => {
  const state = createBreachState([]);
  assert.throws(() => state.attempt('skip-level'), RangeError);
});
