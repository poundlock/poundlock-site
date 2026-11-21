import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sectionAt, withHash } from '../src/scripts/lang-switch.js';

const PAGE = [
  { id: 'hero', top: -2400 },
  { id: 'pain', top: -1500 },
  { id: 'lock', top: -900 },
  { id: 'breach', top: 120 },
  { id: 'contract', top: 980 },
];

test('sectionAt：顶边已经过了那条线的最后一节，就是访客在看的那一节', () => {
  assert.equal(sectionAt(PAGE, 360), 'breach');
  assert.equal(sectionAt(PAGE, 100), 'lock');
  assert.equal(sectionAt(PAGE, 2000), 'contract');
});

test('sectionAt：一节都还没到（或者没有节）是 null', () => {
  assert.equal(sectionAt([{ id: 'hero', top: 500 }], 360), null);
  assert.equal(sectionAt([], 360), null);
});

test('withHash：带上那一节的锚点；原来有锚点就换掉', () => {
  assert.equal(withHash('en/', 'install', 'hero'), 'en/#install');
  assert.equal(withHash('../#lock', 'install', 'hero'), '../#install');
  assert.equal(withHash('../', 'breach', 'hero'), '../#breach');
});

test('withHash：还在第一节（或者不知道在哪）就不带锚点，到另一页的页顶', () => {
  assert.equal(withHash('en/', 'hero', 'hero'), 'en/');
  assert.equal(withHash('en/#install', 'hero', 'hero'), 'en/');
  assert.equal(withHash('en/#install', null, 'hero'), 'en/');
});
