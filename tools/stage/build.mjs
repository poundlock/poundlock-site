// 打包官网首屏的演示：npm ci 装好依赖以后，在 tools/stage 下 npm run build（或 node build.mjs）。
// 输出 src/assets/stage/hero-demo.js（连同 React 的一个 ES 模块）和 hero-demo.css，这两个文件进仓库，
// 官网本身的构建（build.js）不跑这一步、也不需要这里的依赖。改了 hero/、kit/ 或 entry.tsx 就重新打包。
import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

await build({
  entryPoints: [path.join(HERE, 'entry.tsx')],
  outfile: path.join(HERE, '..', '..', 'src', 'assets', 'stage', 'hero-demo.js'),
  bundle: true,
  format: 'esm',
  minify: true,
  jsx: 'automatic',
  // 样式里的嵌套写法降成平的：老一点的浏览器（Safari 15、Chrome 100）不认 CSS 嵌套
  target: ['es2020', 'chrome100', 'firefox100', 'safari15'],
  define: { 'process.env.NODE_ENV': '"production"' },
  // Stageshow 部件的许可证要求带上版权声明；React 自己的许可证注释 esbuild 默认留在文件末尾
  banner: {
    js: '/*! poundlock 首屏演示（tools/stage）。用到 Stageshow 的部件：MIT License, Copyright (c) 2026 Benji Taylor */',
    css: '/*! poundlock 首屏演示（tools/stage）。用到 Stageshow 的部件：MIT License, Copyright (c) 2026 Benji Taylor */',
  },
  logLevel: 'info',
})
