# site

<!-- wellyard:component v1 sha256:29eeb0ffc640b20714f3fff9d76c4f85d4ec6a1e9181573948e4fcc37b8dc431 -->
这个仓库是产品 poundlock 的组件 site（类型 site），由 Wellyard 管理。产品层面的事（组件表、环境、决定）写在主仓库 poundlock 的 CLAUDE.md；IP、端口、登录用户名这类敏感的环境信息只写在那里，不写进这个仓库：它以后可能开源。
<!-- /wellyard:component -->

poundlock 的宣传官网：一页落地页，中英双语。为什么长这样（配色、字体、过闸怎么演、哪些改过几版）记在 `docs/visual-direction.md`；当初批准的设计和后来的修订在主仓库 `docs/superpowers/specs/2026-11-20-官网-design.md`。

## 环境要求

- Node 22 或更新（开发和测试用的是 24）。没有 npm 依赖：`package.json` 里没有 `dependencies`，生成和单元测试不用 `npm install`。
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

过闸不是浏览器里实时画的，是离线渲染好的一串画面，页面按滚动位置换帧。现在是第二版（2026-11-22）：4K 母版，帧按「画面变了多少」取，主路是 H.264 视频。

- **取帧表**：`src/scripts/film-schedule.js`。不按进度均匀取，从上一帧往前走，到某一项变化正好到上限就取下一帧：船每帧最多前进 0.4 米，水位、闸门、天色、进度本身各有上限（`LIMITS`）。现在是 931 帧。渲染、压片、页面三处用的是同一张表，改了 `LIMITS` 或 `src/scripts/lock-state.js` 的节拍，影片要重渲。
- **渲染**：`tools/film/render.py`（Blender 脚本，场景全部是程序生成的，没有外部素材）渲出母版 PNG（3840×2880），放在 `.shots/film/master4k/`，不进仓库，931 帧 10 GB 上下。
- **压片**：`tools/film/encode.mjs` 把母版压成 `src/assets/film/` 下的几档视频、两套后备图片和 `manifest.json`，这些进仓库：
  - 视频四档：`uhd` 3840×2160（从母版中间裁成 16:9）、`wide` 2880×2160、`mid` 1920×1440、`phone` 1344×1680（以船为中心裁成 4:5）。H.264，关键帧每 8 帧一个、不用 B 帧，每一帧都能单独定位：一档切成 10 段，每段一个关键帧文件、一个其余帧文件，外加 `index.json`（每一帧多大、每个关键帧缩成 4×4 的颜色）。CRF 是试过的（宽档 22、25、28 的结构相似度 0.953、0.944、0.934，放大看分不出来），各档的值写在脚本里。
  - 后备图片两套（`frames-wide/` 每隔 3 帧一张、`frames-tall/` 每隔 6 帧一张）：浏览器走不了视频那一路时用。目录名不能和视频的档重名（有一档叫 `wide`），脚本里重名会报错。
  - 现在的体积：`uhd` 63 MB、`wide` 60 MB、`mid` 31 MB、`phone` 18 MB，后备图片 37 MB，整个目录 200 MB 上下。访客只下自己那一档，而且滚进这一节才开始整段下（见下面「踩过的坑」）。
- **重渲的四步**：
  1. `node tools/film/states.mjs --schedule > .shots/film/states-v2.json`
  2. 先抽着看镜头：`node tools/film/states.mjs --schedule --every 30 > .shots/film/states-v2-sparse.json`，用第 3 步的命令换成 `--states .shots/film/states-v2-sparse.json --size 640x480 --samples 24 --quality 1`，一两分钟。
  3. `blender -b --factory-startup --python tools/film/render.py -- --states .shots/film/states-v2.json --out .shots/film/master4k --size 3840x2880 --samples 96 --threshold 0.04 --quality 2 --resume 1 --order coarse`
  4. `node tools/film/encode.mjs --from .shots/film/master4k`
- **渲染要一整天**：4K 一帧 80 到 150 秒（RTX 5090，日出那几帧最慢），931 帧二十三个小时左右。`--order coarse` 先每隔八帧渲一遍、再补每隔四帧、两帧，最后补齐：任何时候停下来，手里都是完整的一段，可以用 `encode.mjs --stride 8` 先压出来看。中途断了原样再跑第 3 步，`--resume 1` 跳过已经渲出来的帧。
- **省时的设置是量过的**：噪点阈值 0.04 比 0.02 省三成、画面看不出差别；后期（柔光、色散）挪到显卡上算、雾的步长加倍都不省时间。
- **镜头只留原画面的左边 82%**：`tools/film/lockfilm/world.py` 的 `FRAME_KEEP`（感光面裁窄、画幅往左偏，透视和景深不变）。页面把船摆在画面宽度的 61% 处、左边留给字，原来右边那 18% 在宽屏版式里从来不露出来。压片脚本的 `FOCUS_X` 和它是同一个数，改一处要改另一处。
- **页面怎么放**：`src/scripts/lock-video.js` 用 `VideoDecoder`（WebCodecs）让显卡解码，解出来的帧画到画布上：按画布大小挑一档（铺满时不用放大的最小一档，手机只用 `phone`），先下访客所在的那一段和下一段，再下别的段的关键帧，最后补其余帧；要画的那一组先解，再按滚动方向备下一组。走不通（没有 `VideoDecoder`、这一档解不了、解出来的头一帧和记下的颜色对不上、十五秒没画出头一帧）就退回 `lock-film.js` 的图片那一路，再不行是平面的那张图。量过：不节流的 Chrome 里滚这一节 115 到 120 帧，往回滚每一帧都对得上。
- **在本机看视频那一路要用装了的 Chrome**：Playwright 自带的 Chromium 没有 H.264 解码器，在它上面页面走的是图片那一路；`browser-check.js` 里视频那几条核对用 `channel: 'chrome'`。
- 正式渲之前先整段预演一遍：第 3 步换成 `--size 640x480 --samples 24 --quality 1`，也用 `--order coarse`，二十分钟左右能先拿到每隔八帧的那一遍。
- Blender 是免安装包，在开发机上的位置记在主仓库的 `CLAUDE.md`。
- 「天亮」有一对要一起改的数：`render.py` 的 `sky_time`（天色怎么走）和 `src/scripts/lock-film.js` 的 `DAY_AT`（页头在哪一刻换成浅色）。
- 影片有两百来 MB，每重渲、重压一次仓库历史就多这么多。别为小改动重渲；只改了页面怎么放，用不着重压。
- 草是一块块的草皮（每块两千根草叶），不是一丛丛单独摆的：单独摆有两百万个物体，每帧光整理场景就要八秒。

## 部署

官网放在 GitHub Pages 上：官网仓库 `gh-pages` 分支的根目录。部署目标叫 `pages`，写在主仓库的 `workspace.json` 里。

- **上线、回滚只走 Wellyard**：`wellyard deploy site --to pages`（会话里用 `/wellyard:deploy`）。不要直接跑 `deploy/deploy.js`：直接跑不弹窗确认、不记部署 tag。
- **部署前检查**：`node --test` 和 `node tools/browser-check.js --engines chromium,webkit,firefox` 都要过。
- **部署命令做了什么**：`node deploy/deploy.js` 把页面生成到系统临时目录，在那里建一个只有一次提交的临时仓库，强推到 origin 的 `gh-pages`，再删掉临时目录。`gh-pages` 上从来只有最新这一次提交（影片有二十多 MB，留历史的话仓库很快就大了）；每一版是哪个提交，由 Wellyard 的部署 tag 记着。加 `--dry-run` 只打印要做什么，不生成、不推。
- **健康检查**：`node deploy/health.js <版本>`，要环境变量 `SITE_URL`（站点地址，见主仓库清单里这个目标的 `env.SITE_URL`）。它取线上的 `version.json`，版本对上了退出码 0。Pages 推上去以后要一两分钟才换上新的，它每十秒试一次，最多等五分钟。
- **回滚**：`wellyard deploy site --to pages --rollback`（回到上一版），或者 `--rollback-to <版本>`。Wellyard 在那一版的临时检出里跑同一个部署命令，生成出来的就是那一版的页面。
- **一次性的设置 2026-11-21 第一次上线时都做完了**，留着是为了以后换仓库、换组织时知道要什么：
  1. 官网仓库要公开：组织是免费套餐，私有仓库开不了 Pages。
  2. Pages 的来源是「Deploy from a branch」，分支 `gh-pages`，目录 `/ (root)`。第一次把 `gh-pages` 推到公开仓库时 GitHub 自己就照这个开了，没有手工设；没自动开的话在 Settings → Pages 里设。
  3. 插件仓库也要公开：不然页面上的星标按钮点过去是 404，星标数也取不到（取不到时按钮照常显示，只是没有数字）。
- 站点地址是项目页的地址，带着仓库名这一段路径。页面里的资源都用相对地址，以后换成自己的域名只用改清单里的 `SITE_URL`，再部署一次。

## 踩过的坑

- **过闸那个粘住的舞台只在放得下的视口里开。** 判据是 `src/scripts/stage.js` 的 `STAGE_QUERY`：窄屏版式要 560 高，宽屏版式要 520 高。放不下（小手机、横过来的手机、把浏览器放大到 200%）时这一节是静态的清单，八段都读得到。它的样式全部挂在 `<html>` 的 `stage-ok` 上：页头的内联脚本一开始就标好，`lock.js` 在视口变化时开、收；过闸的模块抛错、入口脚本取不到时会撤掉它。改这一节的样式时别再直接挂 `motion-ok`（`tests/sections.test.js` 会拦）。
- **核对工具默认的手机视口（360×740）比真手机高。** 那是不带浏览器工具栏的高度；真的 iPhone 上可用的高度是 660 上下，iPhone SE 只有 550 上下。矮视口专门由 `lock-short` 这条核对跑。动过闸的版式之后要看它。
- **影片要等访客滚进来才整段下。** 离过闸还有一屏时，视频那一路只取要画的那一帧附近的一个关键帧（按字节范围取文件的一小段），图片那一路只下头一遍稀的（二十来张）；访客真的滚进来了才整段下（两路都在 `fill` 里）。别改回一挂上就全下：只看一眼首屏就走的人也会下几十 MB，GitHub Pages 每月有 100 GB 的流量软上限。
- **带锚点的地址刷新时不能再补定位。** `main.js` 的 `reanchor` 只在新打开页面时补（见下面 Safari 那一条）；刷新、后退回来时浏览器恢复的是离开前的位置，补了会把人拉回那一节的开头。
- **帧率看门狗会误判。** 首屏的水面在帧率撑不住时会换成静态的底。出过一次事：别的模块在页面刚打开时加载，卡了将近一秒，水面被当成「设备画不动」关掉了。现在看门狗头 2.5 秒不计、单独一次卡顿不计；重的东西（过闸的画面）等快滚到再加载。再加重模块时照这个做。
- **滚动时每帧要写的样式变量，写在读它的那个元素上，而且变了才写**（`src/scripts/style-writer.js`）。原来过闸每帧往 `<html>` 写 `--rise`、`--header-day`，整页每帧重算一遍样式；现在 `--rise`、`--header-day` 写在页头上，`--lock-progress` 只写收尾那两处淡入淡出起作用的那一段（`lock.js` 的 `fadeProgress`）。量过：从 0.2 滚到 0.8 的四秒里，往 `<html>` 写样式从每帧两次降到 2 次。以后再加跟着滚动变的样式，照这个做。
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
