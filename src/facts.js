// 与语言无关的事实。出处是插件仓库（本机在 ../plugin）：stages.json、roster.json、README.md。
// tests/facts.test.js 对着它们核；这里改了而插件没改，测试会红。

// 八个阶段：谁做、交什么。角色的 id 是插件里的名字去掉 at- 前缀。
export const stages = [
  { id: 'S1', roles: ['pm'], artifacts: ['00-contract.md'] },
  { id: 'S2', roles: ['product', 'ui'], artifacts: ['01-prd.md', '02-ui-spec.md', '02-wireframe.html'] },
  { id: 'S3', roles: ['architect'], artifacts: ['03-arch.md', '03-alignment.md'] },
  { id: 'S4', roles: ['pm'], artifacts: ['04-dispatch.md'] },
  { id: 'S5', roles: ['backend', 'frontend', 'ui', 'ios', 'android'], artifacts: ['05-impl/<role>.md'] },
  { id: 'S6', roles: ['qa'], artifacts: ['06-test.md'] },
  { id: 'S7', roles: ['acceptance'], artifacts: ['07-acceptance.md'] },
  { id: 'S8', roles: ['pm'], artifacts: ['08-delivery.md'] },
];

// 十个角色（at-outsider 是测试替身，不算）。
export const roles = ['pm', 'product', 'ui', 'architect', 'backend', 'frontend', 'ios', 'android', 'qa', 'acceptance'];

// 谁能派谁。
export const dispatch = {
  pm: ['product', 'architect', 'qa', 'acceptance'],
  product: ['ui'],
  architect: ['backend', 'frontend', 'ui', 'ios', 'android'],
};

// 六道门禁。
export const gates = ['dispatch', 'readiness', 'writepath', 'contract', 'deliverable', 'budget'];

// 闯闸演示：六种偷懒的办法各对应一道门禁，次序和 gates 一致。
export const breach = [
  { id: 'skip-level', gate: 'dispatch' },
  { id: 'no-test-report', gate: 'readiness' },
  { id: 'cross-dir', gate: 'writepath' },
  { id: 'edit-contract', gate: 'contract' },
  { id: 'claim-done', gate: 'deliverable' },
  { id: 'fourth-rework', gate: 'budget' },
];

export const install = [
  'claude plugin marketplace add poundlock/poundlock-skills --scope local',
  'claude plugin install poundlock@poundlock --scope local',
];

export const firstRun = ['/poundlock:at-init', '/poundlock:at'];

export const floors = { claudeCode: '2.1.276', node: '16.9' };

// 原话验收的示例里，三条各自的结论。
export const contractDemo = ['pass', 'pass', 'fail'];

// README 里对应小节的锚点（中文页指中文半，英文页指英文半）。
export const readmeAnchors = {
  zh: { limits: '#已知边界', install: '#安装' },
  en: { limits: '#known-limitations', install: '#installation' },
};
