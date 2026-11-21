import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accessUnits, avcDescription, codecString, nalType, parameterSets, splitAnnexB, toAvcc } from '../tools/film/pack.js';

// 手拼一段 H.264 裸流：两帧，第一帧是关键帧（带参数集），第二帧不是。
const AUD = [0x09, 0xf0];
const SPS = [0x67, 0x64, 0x00, 0x33, 0xac, 0x2b]; // High，level 5.1
const PPS = [0x68, 0xee, 0x3c, 0x80];
const SEI = [0x06, 0x05, 0x01];
// 载荷里有 00 00 03（防止和起始码撞上的转义），不能在这里切开。
const IDR = [0x65, 0x88, 0x00, 0x00, 0x03, 0x00, 0x7f];
const P = [0x41, 0x9a, 0x02, 0x04];
const S3 = [0, 0, 1];
const S4 = [0, 0, 0, 1];
const STREAM = Uint8Array.from([...S4, ...AUD, ...S4, ...SPS, ...S3, ...PPS, ...S3, ...IDR, ...S4, ...AUD, ...S3, ...SEI, ...S3, ...P]);

const bytes = (list) => list.map((nal) => Array.from(nal));

test('splitAnnexB：三字节、四字节的起始码都认，载荷里的 00 00 03 不切', () => {
  assert.deepEqual(bytes(splitAnnexB(STREAM)), [AUD, SPS, PPS, IDR, AUD, SEI, P]);
});

test('splitAnnexB：前面有多余的零、末尾有补的零，也切得对；空的流是空表', () => {
  const padded = Uint8Array.from([0, 0, ...S4, ...AUD, ...S3, ...P, 0, 0]);
  assert.deepEqual(bytes(splitAnnexB(padded)), [AUD, P]);
  assert.deepEqual(splitAnnexB(new Uint8Array(0)), []);
});

test('nalType 取类型', () => {
  assert.equal(nalType(Uint8Array.from(SPS)), 7);
  assert.equal(nalType(Uint8Array.from(IDR)), 5);
  assert.equal(nalType(Uint8Array.from(AUD)), 9);
});

test('accessUnits：按分隔符归成一帧一帧，有 IDR 的是关键帧', () => {
  const units = accessUnits(splitAnnexB(STREAM));
  assert.equal(units.length, 2);
  assert.equal(units[0].key, true);
  assert.equal(units[1].key, false);
  assert.deepEqual(units[0].nals.map(nalType), [9, 7, 8, 5]);
  assert.deepEqual(units[1].nals.map(nalType), [9, 6, 1]);
});

test('accessUnits：流不是以分隔符开头就报错（压片时要开 aud）', () => {
  assert.throws(() => accessUnits(splitAnnexB(Uint8Array.from([...S4, ...SPS, ...S3, ...IDR]))), /分隔符/);
});

test('parameterSets 取头一个 SPS、PPS；没有就报错', () => {
  const { sps, pps } = parameterSets(splitAnnexB(STREAM));
  assert.deepEqual(Array.from(sps), SPS);
  assert.deepEqual(Array.from(pps), PPS);
  assert.throws(() => parameterSets(splitAnnexB(Uint8Array.from([...S4, ...AUD, ...S3, ...P]))), /SPS/);
});

test('toAvcc：每个 NAL 前面四字节长度，不带分隔符和参数集', () => {
  const [first, second] = accessUnits(splitAnnexB(STREAM));
  assert.deepEqual(Array.from(toAvcc(first.nals)), [0, 0, 0, IDR.length, ...IDR]);
  assert.deepEqual(Array.from(toAvcc(second.nals)), [0, 0, 0, SEI.length, ...SEI, 0, 0, 0, P.length, ...P]);
});

test('avcDescription：High 档带上色度和位深那四个字节', () => {
  const description = avcDescription(Uint8Array.from(SPS), Uint8Array.from(PPS));
  assert.deepEqual(Array.from(description), [1, 0x64, 0x00, 0x33, 0xff, 0xe1, 0, SPS.length, ...SPS, 1, 0, PPS.length, ...PPS, 0xfd, 0xf8, 0xf8, 0]);
});

test('avcDescription：Main 档没有那四个字节', () => {
  const main = [0x67, 0x4d, 0x40, 0x28, 0x95];
  const description = avcDescription(Uint8Array.from(main), Uint8Array.from(PPS));
  assert.deepEqual(Array.from(description), [1, 0x4d, 0x40, 0x28, 0xff, 0xe1, 0, main.length, ...main, 1, 0, PPS.length, ...PPS]);
});

test('codecString 照 SPS 的档次、限制位、级别拼', () => {
  assert.equal(codecString(Uint8Array.from(SPS)), 'avc1.640033');
  assert.equal(codecString(Uint8Array.from([0x67, 0x4d, 0x40, 0x28])), 'avc1.4d4028');
});
