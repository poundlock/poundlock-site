import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mountWater, hexToRgb } from '../src/scripts/water.js';

test('hexToRgb：调色板里的色值换成着色器要的三个 0 到 1 的数', () => {
  assert.deepEqual(hexToRgb('#FFFFFF'), [1, 1, 1]);
  assert.deepEqual(hexToRgb('#000000'), [0, 0, 0]);
  assert.deepEqual(hexToRgb(' #11606A ').map((v) => Math.round(v * 255)), [17, 96, 106]);
  assert.deepEqual(hexToRgb('#7fe7d6').map((v) => Math.round(v * 255)), [127, 231, 214]);
});

test('hexToRgb：读不懂的值是 null，调用方用默认色', () => {
  for (const value of ['', 'teal', '#FFF', 'rgb(1, 2, 3)', 'var(--scene-0)', undefined, null]) {
    assert.equal(hexToRgb(value), null, String(value));
  }
});

function fakeCanvas(getContext) {
  const listeners = {};
  let asked = 0;
  return {
    dataset: {},
    width: 0,
    height: 0,
    clientWidth: 800,
    clientHeight: 600,
    getContext: (...args) => {
      asked++;
      return getContext(...args);
    },
    addEventListener: (type, fn) => (listeners[type] = fn),
    removeEventListener: (type) => delete listeners[type],
    listeners,
    asked: () => asked,
  };
}

test('拿不到 WebGL 就是静态', () => {
  const canvas = fakeCanvas(() => null);
  const water = mountWater(canvas);
  assert.equal(water.mode, 'static');
  assert.equal(canvas.dataset.mode, 'static');
  water.destroy();
});

test('减少动效时不去拿上下文', () => {
  const canvas = fakeCanvas(() => {
    throw new Error('不该被调用');
  });
  const water = mountWater(canvas, { reduced: true });
  assert.equal(water.mode, 'static');
  assert.equal(canvas.dataset.mode, 'static');
  assert.equal(canvas.asked(), 0);
});

test('getContext 抛错也落到静态', () => {
  const canvas = fakeCanvas(() => {
    throw new Error('WebGL 被禁用');
  });
  assert.equal(mountWater(canvas).mode, 'static');
});

test('着色器编译不过就落到静态，并告诉调用方', () => {
  // 一个什么都能调、但编译总是失败的假上下文。
  const gl = new Proxy(
    {},
    {
      get: (target, key) => {
        if (key === 'getShaderParameter' || key === 'getProgramParameter') return () => false;
        if (key === 'getShaderInfoLog' || key === 'getProgramInfoLog') return () => 'bad shader';
        if (key === 'createShader' || key === 'createProgram' || key === 'createBuffer') return () => ({});
        if (typeof key === 'string' && /^[A-Z_0-9]+$/.test(key)) return 1;
        return () => {};
      },
    },
  );
  let told = 0;
  const canvas = fakeCanvas(() => gl);
  const water = mountWater(canvas, { onDegrade: () => told++ });
  assert.equal(water.mode, 'static');
  assert.equal(canvas.dataset.mode, 'static');
  assert.equal(told, 1);
});
