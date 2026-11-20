import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as facts from '../src/facts.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN = path.resolve(ROOT, '..', 'plugin');
const hasPlugin = existsSync(path.join(PLUGIN, 'stages.json'));
const skip = hasPlugin ? false : '本机没有 ../plugin（插件仓库），这一条不核';

const strip = (id) => id.replace(/^at-/, '');
const pluginJson = (name) => JSON.parse(readFileSync(path.join(PLUGIN, name), 'utf8'));
const copy = (code) => JSON.parse(readFileSync(path.join(ROOT, 'src', 'copy', `${code}.json`), 'utf8'));

test('数目', () => {
  assert.equal(facts.stages.length, 8);
  assert.equal(facts.roles.length, 10);
  assert.equal(facts.gates.length, 6);
  assert.equal(facts.breach.length, 6);
  assert.deepEqual(facts.breach.map((b) => b.gate), facts.gates);
  assert.equal(new Set(facts.breach.map((b) => b.id)).size, 6);
  assert.equal(facts.install.length, 2);
  assert.equal(facts.contractDemo.length, 3);
});

test('阶段里出现的角色都在角色表里', () => {
  for (const stage of facts.stages) for (const role of stage.roles) assert.ok(facts.roles.includes(role), `${stage.id}：${role}`);
});

test('对着插件核：阶段', { skip }, () => {
  const stages = pluginJson('stages.json');
  assert.deepEqual(facts.stages.map((s) => s.id), Object.keys(stages));
  for (const stage of facts.stages) {
    const real = stages[stage.id];
    const produces = Array.isArray(real.produces) ? real.produces : Object.values(real.produces).flat();
    assert.deepEqual(stage.artifacts, produces, `${stage.id} 的产物`);
    assert.deepEqual(stage.roles, (real.producers ?? [real.role]).map(strip), `${stage.id} 的角色`);
  }
});

test('对着插件核：花名册', { skip }, () => {
  const roster = pluginJson('roster.json');
  const real = Object.keys(roster).filter((key) => key !== '__main__' && key !== 'at-outsider');
  assert.deepEqual([...facts.roles].sort(), real.map(strip).sort());
  const dispatch = {};
  for (const key of real) {
    const to = roster[key].can_delegate_to;
    if (to.length) dispatch[strip(key)] = to.map(strip);
  }
  assert.deepEqual(facts.dispatch, dispatch);
});

test('对着插件核：README', { skip }, () => {
  const readme = readFileSync(path.join(PLUGIN, 'README.md'), 'utf8');
  const [zhHalf, enHalf] = readme.split('<a id="english"></a>');
  assert.ok(enHalf, 'README 里找不到中英的分界');
  for (const half of [zhHalf, enHalf]) {
    for (const command of facts.install) assert.ok(half.includes(command), `安装命令：${command}`);
    assert.ok(half.includes(facts.floors.claudeCode), 'Claude Code 的版本下限');
    assert.ok(half.includes(facts.floors.node), 'Node 的版本下限');
    for (const command of facts.firstRun) assert.ok(half.includes(command), `命令：${command}`);
  }
  const zh = copy('zh');
  const en = copy('en');
  for (const id of facts.gates) {
    assert.ok(zhHalf.includes(zh.breach.gates[id].name), `中文门禁名：${zh.breach.gates[id].name}`);
    assert.ok(enHalf.toLowerCase().includes(en.breach.gates[id].name.toLowerCase()), `英文门禁名：${en.breach.gates[id].name}`);
  }
});
