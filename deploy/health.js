// 健康检查：线上的 version.json 是不是这次部署的版本。
//   node deploy/health.js <版本>     用环境变量 SITE_URL；对上了退出码 0，试满了还没对上退出码 1
// GitHub Pages 推上去以后要过一两分钟才换上新的，所以隔一会儿再试，默认最多等五分钟。

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function checkHealth({ siteUrl, version, fetchImpl = fetch, retries = 30, delayMs = 10000 }) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // 带一个每次不同的参数：Pages 前面有缓存，不带的话可能一直拿到旧的。
      const response = await fetchImpl(`${siteUrl}version.json?t=${Date.now()}-${attempt}`, { cache: 'no-store' });
      if (response.ok) {
        const info = await response.json();
        if (info.version === version) return true;
      }
    } catch {
      // 取不到（还没生效、网络抖了一下）：接着试。
    }
    if (attempt < retries && delayMs > 0) await sleep(delayMs);
  }
  return false;
}

function isMain() {
  if (!process.argv[1]) return false;
  const here = fileURLToPath(import.meta.url);
  const entry = path.resolve(process.argv[1]);
  return process.platform === 'win32' ? here.toLowerCase() === entry.toLowerCase() : here === entry;
}

if (isMain()) {
  const version = process.argv[2];
  const siteUrl = process.env.SITE_URL;
  if (!version || !siteUrl || !siteUrl.endsWith('/')) {
    console.error('用法：SITE_URL=<站点地址，以 / 结尾> node deploy/health.js <版本>');
    process.exit(1);
  }
  const ok = await checkHealth({ siteUrl, version });
  console.log(ok ? `线上是 ${version}。` : `等了五分钟，线上还不是 ${version}。`);
  // 不调 process.exit：刚取过 HTTPS 就强行退出，Node 24 在 Windows 上会在退出时崩（退出码 127）。
  // 只记下退出码，让进程自己收完连接再退。
  process.exitCode = ok ? 0 : 1;
}
