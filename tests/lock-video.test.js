import { test } from 'node:test';
import assert from 'node:assert/strict';
import { downloadOrder, locate, pickEvictions, pickTier, planDecode, prepareIndex, probeMatches } from '../src/scripts/lock-video.js';

const TIERS = {
  uhd: { width: 3840, height: 2160, focus: [0.6098, 0.5] },
  wide: { width: 2880, height: 2160, focus: [0.6098, 0.5] },
  mid: { width: 1920, height: 1440, focus: [0.6098, 0.5] },
  phone: { width: 1344, height: 1680, focus: [0.5, 0.5] },
};
const WIDE_LAYOUT = { anchor: [0.61, 0.5] };

test('pickTier：挑铺满画布时不用放大的最小一档', () => {
  // 用户没最大化的窗口（4K 屏，125% 缩放）。
  assert.equal(pickTier(TIERS, 2329, 1879, WIDE_LAYOUT), 'wide');
  // 4K 屏上最大化：3840 宽、比 16:9 扁，用裁成 16:9 的那一档，正好一比一。
  assert.equal(pickTier(TIERS, 3840, 1900, WIDE_LAYOUT), 'uhd');
  // 普通笔记本。
  assert.equal(pickTier(TIERS, 1440, 900, WIDE_LAYOUT), 'mid');
  assert.equal(pickTier(TIERS, 1920, 1080, WIDE_LAYOUT), 'mid');
  // 视网膜屏的笔记本全屏。
  assert.equal(pickTier(TIERS, 3024, 1964, WIDE_LAYOUT), 'uhd');
});

test('pickTier：哪一档都不够大，就用放大得最少的；一样的时候用画面更全的那一档', () => {
  assert.equal(pickTier(TIERS, 5120, 2880, WIDE_LAYOUT), 'uhd');
  // 又大又高的窗口：整幅的那一档和裁成 16:9 的那一档要放大的一样多，用整幅的。
  assert.equal(pickTier(TIERS, 2880, 2400, WIDE_LAYOUT), 'wide');
});

test('pickTier：手机只用手机那一档；没有手机档就照常挑；可以封顶；没有档是 null', () => {
  assert.equal(pickTier(TIERS, 1170, 1518, { phone: true, anchor: [0.5, 0.4] }), 'phone');
  const { phone, ...rest } = TIERS;
  assert.equal(pickTier(rest, 1125, 1400, { phone: true, anchor: [0.5, 0.4] }), 'mid');
  assert.equal(pickTier(TIERS, 3840, 1900, { ...WIDE_LAYOUT, cap: 'mid' }), 'mid');
  assert.equal(pickTier(TIERS, 3840, 1900, { ...WIDE_LAYOUT, cap: 'wide' }), 'wide');
  assert.equal(pickTier({}, 1440, 900, WIDE_LAYOUT), null);
  assert.equal(pickTier({ phone }, 1440, 900, WIDE_LAYOUT), 'phone');
});

// 一小份索引：每 4 帧一个关键帧，一段 8 帧，一共 18 帧（最后一段只有 2 帧）。
const INDEX = prepareIndex({
  gop: 4,
  count: 18,
  segments: [
    { first: 0, count: 8, key: 'k00.bin', rest: 'p00.bin', keySizes: [100, 110], restSizes: [10, 11, 12, 13, 14, 15] },
    { first: 8, count: 8, key: 'k01.bin', rest: 'p01.bin', keySizes: [120, 130], restSizes: [20, 21, 22, 23, 24, 25] },
    { first: 16, count: 2, key: 'k02.bin', rest: 'p02.bin', keySizes: [140], restSizes: [30] },
  ],
});

test('locate：每一帧在哪一段、哪个文件、从哪到哪', () => {
  assert.deepEqual(locate(INDEX, 0), { segment: 0, key: true, offset: 0, size: 100 });
  assert.deepEqual(locate(INDEX, 4), { segment: 0, key: true, offset: 100, size: 110 });
  assert.deepEqual(locate(INDEX, 1), { segment: 0, key: false, offset: 0, size: 10 });
  assert.deepEqual(locate(INDEX, 3), { segment: 0, key: false, offset: 21, size: 12 });
  assert.deepEqual(locate(INDEX, 5), { segment: 0, key: false, offset: 33, size: 13 });
  assert.deepEqual(locate(INDEX, 7), { segment: 0, key: false, offset: 60, size: 15 });
  assert.deepEqual(locate(INDEX, 12), { segment: 1, key: true, offset: 120, size: 130 });
  assert.deepEqual(locate(INDEX, 15), { segment: 1, key: false, offset: 110, size: 25 });
  assert.deepEqual(locate(INDEX, 16), { segment: 2, key: true, offset: 0, size: 140 });
  assert.deepEqual(locate(INDEX, 17), { segment: 2, key: false, offset: 0, size: 30 });
  assert.equal(locate(INDEX, 18), null);
  assert.equal(locate(INDEX, -1), null);
});

// 每一组（从关键帧起的 gop 帧）里现在能解的有几帧、已经解好放着的有几帧。
const all = (gop, count) => (g) => Math.max(0, Math.min(gop, count - g));
const haveFrom = (cached, gop) => (g) => cached.filter((i) => i >= g && i < g + gop).length;

test('planDecode：先解要画的那一帧所在的一组', () => {
  const size = all(8, 100);
  assert.equal(planDecode({ target: 10, direction: 1, gop: 8, count: 100, budget: 24, size, have: () => 0 }), 8);
  // 一下子跳很远：直接解那里的一组，中间的不管。
  assert.equal(planDecode({ target: 77, direction: 1, gop: 8, count: 100, budget: 24, size, have: haveFrom([8, 9, 10, 11, 12, 13, 14, 15], 8) }), 72);
});

test('planDecode：这一组备好了，往哪边滚就先备哪边的下一组', () => {
  const size = all(8, 100);
  const have = haveFrom([16, 17, 18, 19, 20, 21, 22, 23], 8);
  assert.equal(planDecode({ target: 18, direction: 1, gop: 8, count: 100, budget: 24, size, have }), 24);
  assert.equal(planDecode({ target: 18, direction: -1, gop: 8, count: 100, budget: 24, size, have }), 8);
});

test('planDecode：缓存只放得下两组时，不去备反方向的那一组', () => {
  const size = all(8, 100);
  const cached = [...Array(16).keys()].map((i) => i + 16); // 16..31
  assert.equal(planDecode({ target: 18, direction: 1, gop: 8, count: 100, budget: 16, size, have: haveFrom(cached, 8) }), null);
  // 放得下三组，就把反方向的也备上：回头滚的时候不用现解。
  assert.equal(planDecode({ target: 18, direction: 1, gop: 8, count: 100, budget: 24, size, have: haveFrom(cached, 8) }), 8);
});

test('planDecode：到头了不越界；最后一组不满也照解', () => {
  const size = all(8, 20);
  assert.equal(planDecode({ target: 18, direction: 1, gop: 8, count: 20, budget: 24, size, have: () => 0 }), 16);
  assert.equal(planDecode({ target: 18, direction: 1, gop: 8, count: 20, budget: 24, size, have: haveFrom([16, 17, 18, 19], 8) }), 8);
  assert.equal(planDecode({ target: 2, direction: -1, gop: 8, count: 20, budget: 24, size, have: haveFrom([0, 1, 2, 3, 4, 5, 6, 7], 8) }), 8);
});

test('planDecode：只下到了关键帧（一组只有一帧能解）时，前后多备几个关键帧', () => {
  const size = () => 1;
  const have = haveFrom([16], 8);
  assert.equal(planDecode({ target: 18, direction: 1, gop: 8, count: 100, budget: 24, size, have }), 24);
  assert.equal(planDecode({ target: 18, direction: 1, gop: 8, count: 100, budget: 24, size, have: haveFrom([16, 24], 8) }), 8);
  assert.equal(planDecode({ target: 18, direction: 1, gop: 8, count: 100, budget: 24, size, have: haveFrom([8, 16, 24], 8) }), 32);
  // 这一组什么都还没下到：跳过它，看别的。
  assert.equal(planDecode({ target: 18, direction: 1, gop: 8, count: 100, budget: 24, size: (g) => (g === 16 ? 0 : 1), have: () => 0 }), 24);
});

test('pickEvictions：超了就丢离得最远的；要画的那一组不丢；身后的比前面的先丢', () => {
  const cached = [...Array(24).keys()]; // 0..23
  assert.deepEqual(pickEvictions(cached, { target: 17, direction: 1, gop: 8, budget: 16 }), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(pickEvictions(cached, { target: 9, direction: 1, gop: 8, budget: 16 }), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(pickEvictions(cached, { target: 9, direction: -1, gop: 8, budget: 16 }), [16, 17, 18, 19, 20, 21, 22, 23]);
  assert.deepEqual(pickEvictions(cached, { target: 9, direction: 1, gop: 8, budget: 24 }), []);
  // 预算比一组还小，要画的那一组也不丢。
  assert.deepEqual(pickEvictions([8, 9, 10, 11, 12, 13, 14, 15], { target: 9, direction: 1, gop: 8, budget: 4 }), []);
});

test('downloadOrder：先下访客所在的那一段（关键帧、其余帧），再下一段，然后别的段的关键帧由近到远，最后别的段的其余帧', () => {
  const tag = (list) => list.map((item) => `${item.kind}${item.segment}`);
  assert.deepEqual(tag(downloadOrder(4, 1, 1)), ['key1', 'rest1', 'key2', 'rest2', 'key0', 'key3', 'rest0', 'rest3']);
  assert.deepEqual(tag(downloadOrder(4, 2, -1)), ['key2', 'rest2', 'key1', 'rest1', 'key3', 'key0', 'rest3', 'rest0']);
  assert.deepEqual(tag(downloadOrder(1, 0, 1)), ['key0', 'rest0']);
  assert.deepEqual(tag(downloadOrder(3, 2, 1)), ['key2', 'rest2', 'key1', 'key0', 'rest1', 'rest0']);
});

test('probeMatches：解出来的画面和压片时记下的大致一样才算过', () => {
  const expected = Array.from({ length: 48 }, (_, i) => (i * 5) % 200);
  assert.equal(probeMatches(expected, expected), true);
  assert.equal(probeMatches(expected, expected.map((v) => v + 9)), true);
  // 整个发绿、全黑、长度不对：不过。
  assert.equal(probeMatches(expected, expected.map((v, i) => (i % 3 === 1 ? 255 : 0))), false);
  assert.equal(probeMatches(expected, expected.map(() => 0)), false);
  assert.equal(probeMatches(expected, expected.slice(0, 12)), false);
  assert.equal(probeMatches(null, expected), true); // 压片时没记：不核
});
