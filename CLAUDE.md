# site

<!-- wellyard:component v1 sha256:29eeb0ffc640b20714f3fff9d76c4f85d4ec6a1e9181573948e4fcc37b8dc431 -->
这个仓库是产品 poundlock 的组件 site（类型 site），由 Wellyard 管理。产品层面的事（组件表、环境、决定）写在主仓库 poundlock 的 CLAUDE.md；IP、端口、登录用户名这类敏感的环境信息只写在那里，不写进这个仓库：它以后可能开源。
<!-- /wellyard:component -->

poundlock 的宣传官网：一页落地页，中英双语。为什么长这样（配色、字体、过闸怎么演、哪些改过几版）记在 `docs/visual-direction.md`；当初批准的设计和后来的修订在主仓库 `docs/superpowers/specs/2026-11-20-官网-design.md`。

## 环境要求

- Node 20 或更新。没有 npm 依赖：`package.json` 里没有 `dependencies`，生成和单元测试不用 `npm install`。
- 下面三样只在做对应的事时才要，都不进 `package.json`：
  - 浏览器核对要 Playwright：`npm install --no-save playwright@1.65.1`，再 `npx playwright install chromium webkit firefox`。
  - 重新裁字体要 Python 的 `fonttools` 和 `brotli`（`tools/subset-fonts.py` 开头写了原始字体从哪几个包里取）。
  - 重新渲染过闸的影片要 Blender 5.3 和带 libwebp 的 ffmpeg，见下面「影片」。

## 构建

`node build.js` 生成到 `dist/`（先清空它）。`node tools/serve.js` 在本机起一个静态服务看 `dist/`。

页面不用框架：`src/sections/` 下每一节一个模块，吃 `src/copy/` 的文案和 `src/facts.js` 的事实，拼成两页（`dist/index.html` 是中文，`dist/en/index.html` 是英文）。

## 测试

- `node --test`：单元测试。里面有几条是护栏，改这些地方之前先知道：
  - 两种语言的文案键必须一一对应。
  - 页面上的数字和命令对着插件仓库核（`../plugin/` 在本机时才核，不在就跳过）。
  - 颜色只能出自 `src/styles/tokens.css` 的调色板，正文对比度要到 AA。
  - 中文字体是按文案裁的子集：文案里出现子集没有的字，测试会红，这时重跑 `python tools/subset-fonts.py <原始字体目录>`。
- `node tools/browser-check.js --engines chromium,webkit,firefox`：在三个浏览器内核里把生成出来的页面真的打开核一遍（三种宽度、两种语言），全跑要十几分钟。`--only 名字,名字` 只跑其中几条。
- 主仓库清单里这个组件的 `test` 是 `node --test`，`wellyard test site` 跑的就是它。浏览器核对不在里面（要另装 Playwright、慢），改了页面自己跑。

## 影片（「过闸」那一节的画面）

过闸不是浏览器里实时画的，是离线渲染好的一串画面，页面按滚动位置换帧。

- `tools/film/render.py`（Blender 脚本，场景全部是程序生成的，没有外部素材）渲出母版 PNG，放在 `.shots/film/master/`，不进仓库。
- `tools/film/encode.mjs` 把母版压成 `src/assets/film/` 下的两套 WebP 和 `manifest.json`，这些进仓库。横版就是整幅母版（4:3，每帧都要）：窗口比 16:9 高的时候要用到上下那两条，所以不裁；竖版取中间一条、隔一帧取一帧，给手机。没有 `manifest.json` 时页面不带影片，用平面的那张图。
- 重渲的三步：
  1. `node tools/film/states.mjs --frames 240 > .shots/film/states-240.json`
  2. `blender -b --factory-startup --python tools/film/render.py -- --states .shots/film/states-240.json --out .shots/film/master --size 1920x1440 --samples 200 --quality 2 --resume 1`
  3. `node tools/film/encode.mjs --from .shots/film/master`
- 正式渲染一帧四十多秒（RTX 5090），240 帧三小时左右。中途断了，原样再跑一遍第 2 步，`--resume 1` 会跳过已经渲出来的帧。
- 正式渲之前先整段预演一遍：第 2 步换成 `--size 480x360 --samples 24 --quality 1`，十分钟，抽帧看镜头有没有穿过东西、节拍对不对。
- Blender 是免安装包，在开发机上的位置记在主仓库的 `CLAUDE.md`。
- 影片和页面是同一套节拍：每一帧的状态取自 `src/scripts/lock-state.js`。改了那个函数，影片要重渲。
- 「天亮」有一对要一起改的数：`render.py` 的 `sky_time`（天色怎么走）和 `src/scripts/lock-film.js` 的 `DAY_AT`（页头在哪一刻换成浅色）。
- 影片有二十来 MB，每重渲一次仓库历史就多这么多。别为小改动重渲。
- 草是一块块的草皮（每块两千根草叶），不是一丛丛单独摆的：单独摆有两百万个物体，每帧光整理场景就要八秒。

## 部署

官网放在 GitHub Pages 上：官网仓库 `gh-pages` 分支的根目录。部署目标叫 `pages`，写在主仓库的 `workspace.json` 里。

- **上线、回滚只走 Wellyard**：`wellyard deploy site --to pages`（会话里用 `/wellyard:deploy`）。不要直接跑 `deploy/deploy.js`：直接跑不弹窗确认、不记部署 tag。
- **部署前检查**：`node --test` 和 `node tools/browser-check.js --engines chromium,webkit,firefox` 都要过。
- **部署命令做了什么**：`node deploy/deploy.js` 把页面生成到系统临时目录，在那里建一个只有一次提交的临时仓库，强推到 origin 的 `gh-pages`，再删掉临时目录。`gh-pages` 上从来只有最新这一次提交（影片有二十多 MB，留历史的话仓库很快就大了）；每一版是哪个提交，由 Wellyard 的部署 tag 记着。加 `--dry-run` 只打印要做什么，不生成、不推。
- **健康检查**：`node deploy/health.js <版本>`，要环境变量 `SITE_URL`（站点地址，见主仓库清单里这个目标的 `env.SITE_URL`）。它取线上的 `version.json`，版本对上了退出码 0。Pages 推上去以后要一两分钟才换上新的，它每十秒试一次，最多等五分钟。
- **回滚**：`wellyard deploy site --to pages --rollback`（回到上一版），或者 `--rollback-to <版本>`。Wellyard 在那一版的临时检出里跑同一个部署命令，生成出来的就是那一版的页面。
- **一次性的设置**（第一次上线前做，都要用户自己点）：
  1. 官网仓库改成公开：组织是免费套餐，私有仓库开不了 Pages。
  2. 第一次部署把 `gh-pages` 分支推上去以后，在仓库的 Settings → Pages 里把来源设成「Deploy from a branch」，分支 `gh-pages`，目录 `/ (root)`。
  3. 插件仓库也要公开：不然页面上的星标按钮点过去是 404，星标数也取不到（取不到时按钮照常显示，只是没有数字）。
- 站点地址是项目页的地址，带着仓库名这一段路径。页面里的资源都用相对地址，以后换成自己的域名只用改清单里的 `SITE_URL`，再部署一次。

## 踩过的坑

- **帧率看门狗会误判。** 首屏的水面在帧率撑不住时会换成静态的底。出过一次事：别的模块在页面刚打开时加载，卡了将近一秒，水面被当成「设备画不动」关掉了。现在看门狗头 2.5 秒不计、单独一次卡顿不计；重的东西（过闸的画面）等快滚到再加载。再加重模块时照这个做。
- **无头浏览器的帧率不能信。** 没有显卡时 WebGL 走软件渲染，慢得多。`browser-check.js` 给 Chromium 加了走显卡的启动参数；`--perf` 量出来的数只在有显卡的机器上有参考价值，而开发机的显卡又太好，弱设备上什么样没量过。
- **Safari 没有滚动锚定。** 带着锚点打开页面时，浏览器先滚到那一节，脚本接管以后有的节高度变了（闯闸的面板从清单变成两栏），Chrome 会自己跟着调滚动位置，Safari 不会，落点就偏了。`main.js` 的 `reanchor` 为此补一次定位。以后再加「脚本接管后高度会变」的节，记得这一条。
- **WebKit 里带锚点打开页面不能平滑滚动。** 全局开着平滑滚动时，WebKit 会从页顶一路滚过整页（包括过闸那五屏）。所以平滑滚动只在页面里有元素拿着焦点时才开（`base.css`）。
- **Windows 的剪贴板会把换行换成回车加换行。** 复制的核对比内容时不计这个；页面本身没问题。
- **跑测试别把输出接到管道里再看退出码。** `node --test | grep …` 的退出码是 grep 的。出过一次带着红的测试提交。输出重定向到文件，看 `node --test` 自己的退出码。
- **Node 24.14 的 `node --test` 全量跑偶尔会卡死**，和仓库路径长度有关，是运行器的毛病。先重跑，别急着查代码。
- **批量改文件别用 heredoc 往命令行里塞带引号的大段内容**（Bash 会解析失败，或者把转义符吃掉）。写成脚本文件再跑。
- **页面的界面元素不用橙、红、棕**，「没通过」「被拦下」这类状态靠形状和文字区分（虚线、留缺口的圈），不靠红色。影片里的暖光是画面里的光，不算。
- **品牌文件没有跟着配色改。** 页面的配色 2026-11-20 换成了「清水」，`src/assets/` 里的图标和分享预览图还是原来的青绿色。那是定了稿的品牌资产，改不改由用户定。

## 约定

- 提交说明用中文，不加署名行。
- 不往这个仓库写 IP、登录用户名、邮箱、本机的绝对路径：它要公开。插件 `plugin.json` 里作者的邮箱也不放到页面上。
- `.shots/`（截图、渲染的母版、日志）不进仓库。
