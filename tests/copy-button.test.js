import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyText } from '../src/scripts/copy-button.js';

const COMMAND = 'claude plugin install poundlock@poundlock --scope local';

test('有剪贴板就复制', async () => {
  const written = [];
  const selected = [];
  const result = await copyText(COMMAND, {
    clipboard: { writeText: async (text) => written.push(text) },
    legacyCopy: (text) => selected.push(text),
  });
  assert.equal(result, 'copied');
  assert.deepEqual(written, [COMMAND]);
  assert.deepEqual(selected, []);
});

test('没有剪贴板就选中', async () => {
  const selected = [];
  const result = await copyText(COMMAND, { clipboard: undefined, legacyCopy: (text) => selected.push(text) });
  assert.equal(result, 'selected');
  assert.deepEqual(selected, [COMMAND]);
});

test('剪贴板拒绝也选中', async () => {
  const selected = [];
  const result = await copyText(COMMAND, {
    clipboard: {
      writeText: async () => {
        throw new Error('NotAllowedError');
      },
    },
    legacyCopy: (text) => selected.push(text),
  });
  assert.equal(result, 'selected');
  assert.deepEqual(selected, [COMMAND]);
});

test('剪贴板对象在、但没有 writeText，也选中', async () => {
  const selected = [];
  const result = await copyText(COMMAND, { clipboard: {}, legacyCopy: (text) => selected.push(text) });
  assert.equal(result, 'selected');
  assert.deepEqual(selected, [COMMAND]);
});
