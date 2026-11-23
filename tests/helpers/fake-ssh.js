// 测试用的替身 ssh：把收到的参数和标准输入记到 $FAKE_SSH_OUT 下（argv.json、stdin.bin），
// 往 stderr 写 $FAKE_SSH_STDERR，以 $FAKE_SSH_EXIT（默认 0）退出。
// 部署脚本只认系统临时目录下的替身（DEPLOY_SSH_FAKE），测试先把它复制到临时目录再用。
// 照 Wellyard 官网的那份写的。只用 node: 模块。
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const out = process.env.FAKE_SSH_OUT;
if (!out) {
  // 不是测试在用（比如本机环境里残留了 DEPLOY_SSH_FAKE）：别假装传成功
  process.stderr.write('fake ssh: FAKE_SSH_OUT is not set, refusing to pretend the upload worked\n');
  process.exit(97);
}
writeFileSync(join(out, 'argv.json'), JSON.stringify(process.argv.slice(2)));
writeFileSync(join(out, 'stdin.bin'), readFileSync(0));
if (process.env.FAKE_SSH_STDERR) process.stderr.write(process.env.FAKE_SSH_STDERR);
process.exit(Number(process.env.FAKE_SSH_EXIT || 0));
