// 给资源的地址加上按内容算的版本号：assets/site.css → assets/site.css?v=<内容哈希的前 10 位>。
// 服务器对带版本号的地址发长期缓存（一年、immutable，Cloudflare 边缘也缓存），内容一变版本号就变，访客拿到的总是新的；
// 不带的（页面本身、version.json、长条图的清单）照旧每次回源核对。
// 原来文件名不带哈希，只能一律 no-cache：国内的访客回访时每个文件都要绕一趟 Cloudflare 欧洲的节点回源核对，一次 1～2 秒。
//
// 改的是生成出来的输出目录（build.js 生成完调），不动 src。改三种写法（只改指向输出目录里确实有的文件的）：
//   页面里的 src="…"、href="…"；样式里的 url(…)；脚本里以 ./ 或 ../ 开头、以资源扩展名结尾的字符串（import、动态 import、new URL）。
// 一个文件的版本号按改写以后的内容算，所以被引用的变了，引用它的也跟着变。只用 node: 模块。

import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const hashOf = (content) => createHash('sha256').update(content).digest('hex').slice(0, 10);

const JS_REF = /(['"`])(\.\.?\/[^'"`\s?#]+\.(?:js|css|webp|png|svg|woff2|json))\1/g;
const CSS_REF = /url\((['"]?)([^'")\s?#]+)\1\)/g;
const HTML_REF = /\b(src|href)="([^"?#:]+)"/g;

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

// outDir 下 assets/ 里的文件都算版本号；pages 是要改的页面（相对 outDir）。返回 { 相对 assets/ 的路径: 版本号 }。
export async function versionAssets(outDir, pages) {
  const assetsDir = path.resolve(outDir, 'assets');
  const files = new Set(await walk(assetsDir));
  const versions = new Map();
  const visiting = new Set();

  // 文本里的引用换成带版本号的；target 是解析出来的绝对路径，不在输出目录里的不动
  const rewrite = (text, pattern, from, build) =>
    text.replace(pattern, (whole, quote, ref) => {
      const target = path.resolve(from, ref);
      return versions.has(target) ? build(quote, `${ref}?v=${versions.get(target)}`) : whole;
    });
  const refsIn = (text, pattern, from) => [...text.matchAll(pattern)].map((m) => path.resolve(from, m[2])).filter((target) => files.has(target));

  const version = async (file) => {
    if (versions.has(file)) return;
    const ext = path.extname(file);
    if (ext !== '.js' && ext !== '.css') {
      versions.set(file, hashOf(await readFile(file)));
      return;
    }
    if (visiting.has(file)) throw new Error(`资源互相引用成了环，算不出版本号：${path.relative(outDir, file)}`);
    visiting.add(file);
    const from = path.dirname(file);
    const pattern = ext === '.js' ? JS_REF : CSS_REF;
    let text = await readFile(file, 'utf8');
    for (const target of refsIn(text, pattern, from)) if (target !== file) await version(target);
    text = ext === '.js' ? rewrite(text, JS_REF, from, (q, ref) => `${q}${ref}${q}`) : rewrite(text, CSS_REF, from, (q, ref) => `url(${q}${ref}${q})`);
    await writeFile(file, text);
    visiting.delete(file);
    versions.set(file, hashOf(text));
  };

  for (const file of files) await version(file);
  for (const page of pages) {
    const file = path.resolve(outDir, page);
    const from = path.dirname(file);
    const text = await readFile(file, 'utf8');
    await writeFile(file, text.replace(HTML_REF, (whole, attr, ref) => {
      const target = path.resolve(from, ref);
      return versions.has(target) ? `${attr}="${ref}?v=${versions.get(target)}"` : whole;
    }));
  }
  return Object.fromEntries([...versions].map(([file, v]) => [path.relative(assetsDir, file).split(path.sep).join('/'), v]));
}
