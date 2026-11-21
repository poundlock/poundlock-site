# poundlock-site

[poundlock](https://github.com/poundlock/poundlock-skills) 的官网：一页落地页，中文和英文各一页。

poundlock 是一个 Claude Code 插件：十个角色的软件开发团队，按顺序把你的需求做完，每一步做没做完由门禁核。这个仓库只是它的官网；插件本身、怎么安装、怎么用，见插件仓库的 README。

## 看一眼

```
node build.js          # 生成到 dist/
node tools/serve.js    # 在本机起一个静态服务，打开它打印的地址
```

要 Node 22 或更新。没有 npm 依赖，不用 `npm install`。

## 这里面有什么

| 位置 | 是什么 |
| --- | --- |
| `src/sections/` | 页面的每一节，一节一个模块 |
| `src/copy/` | 两种语言的文案 |
| `src/facts.js` | 页面上说到的事实：阶段、角色、门禁、安装命令。有测试对着插件仓库核 |
| `src/styles/` | 样式。颜色全部出自 `tokens.css` 的调色板 |
| `src/scripts/` | 浏览器里跑的脚本。页面不靠它们也读得通，它们只做增强 |
| `src/assets/film/` | 「过闸」那一节的影片：离线渲染的一串画面，页面按滚动位置换帧 |
| `tools/film/` | 渲染那段影片的 Blender 脚本和压片脚本 |
| `tools/browser-check.js` | 在三个浏览器内核里把生成出来的页面真的打开核一遍 |
| `docs/visual-direction.md` | 为什么长这样：配色、字体、过闸怎么演 |

没有用任何前端框架：一个不带依赖的生成脚本（`build.js`）把模块和文案拼成静态页面。页面上用到的动效库（anime.js）和字体（IBM Plex）都放在仓库里自己托管，页面不向第三方请求任何脚本、样式或字体。

## 测试

```
node --test                                                      # 单元测试
node tools/browser-check.js --engines chromium,webkit,firefox    # 浏览器核对，要先装 Playwright
```

浏览器核对要另装 Playwright，它不在 `package.json` 里：

```
npm install --no-save playwright@1.65.1
npx playwright install chromium webkit firefox
```

## 过闸的影片

「过闸」那一节的画面是用 Blender 离线渲染的，场景全部由脚本生成，没有用外部素材。怎么重新渲染，见 `CLAUDE.md` 的「影片」一节。

## 许可

仓库里自带的第三方文件各有各的许可，许可文件跟着它们一起放：anime.js（MIT，`src/vendor/animejs/`）、IBM Plex（SIL Open Font License，`src/assets/fonts/`）。
