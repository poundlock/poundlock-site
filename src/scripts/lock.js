// 过闸：画面停在视口里，滚动推进，八拍，对应 S1 到 S8。
// 默认的版式是静态的（八个阶段的清单加一张升满了的图）；这里只在系统没要求减少动效时接管。
// 接管以后有两种画法，依次往下退：
//   一条鱼游过八段景（lock-reef.js：离线渲好的长条图加实时的光斑、摆动、鱼群，要 WebGL）；
//   平面的那张图（要动效库）：没有 WebGL、访客开了省流量、画面画不动或者取不到时用。
// beatAt、progressOf 是纯函数，Node 里能直接测。

import { styleWriter } from './style-writer.js';
import { createFollower } from './follow.js';
import { mountReef, readReef } from './lock-reef.js';
import { STAGE_QUERY } from './stage.js';

export function beatAt(progress, beats = 8) {
  const p = Math.min(1, Math.max(0, progress));
  return Math.min(beats - 1, Math.floor(p * beats));
}

// 轨道滚到哪了。rect 是轨道的 getBoundingClientRect()：顶对齐视口顶是 0，底对齐视口底是 1。
export function progressOf(rect, viewportHeight) {
  const range = rect.height - viewportHeight;
  if (range <= 0) return rect.top + rect.height <= 0 ? 1 : 0;
  return Math.min(1, Math.max(0, -rect.top / range));
}

const BEATS = 8;

// 画面追滚动位置的弹簧有多硬（follow.js 的 ω，每秒）。12：滚轮滚一格，画面缓缓滑 0.4 秒停住；
// 匀速滚的时候落后 0.17 秒。原来是一阶的指数趋近（也是 12，时间常数 83ms），滚轮一格一格滚时一顿一顿的。
// 平面的那张图用这个数；鱼游过八段景那一路更软（lock-reef.js 的 REEF_FOLLOW），停下时有惯性。
export const FOLLOW = 12;

// 收尾那两处淡入淡出（lock.css：水面那一层退掉、底下那层亮色升上来）只在进度 0.95 到 0.9955 之间变，
// 两头外面写进去的值都一样。--lock-progress 只写这一段里的值，这一段以外不用每帧写。
export const FADE_FROM = 0.95;
export const FADE_TO = 0.9955;

// 滚轮一格走一段：每一段停在哪（进度）。有长条图的清单时停在每段场景的正中（镜头中心对着那一段的中间），
// 第一段停在开头、最后一段停在出水停下的那一幅；没有清单（平面的图）时停在每一拍的正中。
// 停的位置一定落在那一段的拍子里（beatAt 对得上）。纯函数，Node 里能测。
export function stopsOf(reef, beats = BEATS) {
  const stops = [];
  for (let i = 0; i < beats; i++) {
    if (i === 0) stops.push(0);
    else if (i === beats - 1) stops.push(1);
    else if (reef && reef.sceneLen && reef.xEnd > reef.xStart) stops.push(((i + 0.5) * reef.sceneLen - reef.xStart) / (reef.xEnd - reef.xStart));
    else stops.push((i + 0.5) / beats);
  }
  return stops;
}

// 从进度 p 往 dir（1 往下、-1 往上）滚一格该停在哪：下一个停点；已经在最后一个（或第一个）就是 null，照常滚出这一节
export function nextStop(stops, p, dir) {
  const eps = 0.002;
  if (dir > 0) return stops.find((s) => s > p + eps) ?? null;
  for (let i = stops.length - 1; i >= 0; i--) if (stops[i] < p - eps) return stops[i];
  return null;
}

export function fadeProgress(progress) {
  return Math.min(FADE_TO, Math.max(FADE_FROM, progress));
}

// 平面的画法：那张八片的图。动效库的时间线管每一拍里各个动作的缓动，走到哪由滚动进度定。
function mountFlat(root, anime) {
  const waterLayer = root.querySelector('[data-lock-water]');
  const svg = waterLayer && waterLayer.querySelector('.lock__svg');
  const stage = root.querySelector('.lock__stage');
  if (!svg || !stage) return null;
  const stageVars = styleWriter(stage);

  const BEAT = 1000; // 时间线上一拍的长度
  const { createTimeline } = anime;
  const river = Number(svg.dataset.river);
  const startX = Number(svg.dataset.startX);
  const empty = Number(svg.dataset.empty);
  const slabs = [...svg.querySelectorAll('.slab')].map((group) => ({
    top: Number(group.dataset.top),
    level: Number(group.dataset.level),
    restX: Number(group.dataset.restX),
    water: group.querySelector('.slab__water'),
  }));
  // 闸门在片与片之间的缝里：第 i 片身后的那道是 gateOf[i]，第一片身后没有。
  const gateOf = {};
  for (const gate of svg.querySelectorAll('.gate')) gateOf[Number(gate.dataset.gateIndex)] = gate;
  const lanes = [...svg.querySelectorAll('.slab__lane')];
  const boat = svg.querySelector('.boat');
  const float = svg.querySelector('.gauge__float');

  // 画面的状态是一个普通对象，时间线只管把里面的数算出来；怎么写进页面由 render 一处决定。
  const state = { boatX: startX, boatY: river, lanes: 0, surface: 0 };
  slabs.forEach((slab, i) => {
    state[`water${i}`] = empty;
    state[`gate${i}`] = 0;
  });

  const render = () => {
    slabs.forEach((slab, i) => {
      slab.water.style.transform = `translateY(${state[`water${i}`].toFixed(2)}px)`;
      const gate = gateOf[i];
      if (!gate) return;
      const closed = state[`gate${i}`];
      gate.style.transform = `scaleY(${closed.toFixed(3)})`;
      gate.style.opacity = Math.min(1, Math.max(0, closed)).toFixed(3);
    });
    boat.style.transform = `translate(${state.boatX.toFixed(2)}px, ${state.boatY.toFixed(2)}px)`;
    float.style.transform = `translateY(${state.boatY.toFixed(2)}px)`;
    for (const lane of lanes) lane.style.opacity = (state.lanes * 0.5).toFixed(3);
    stageVars.set('--surface', state.surface.toFixed(4));
  };

  const timeline = createTimeline({ defaults: { ease: 'linear' }, autoplay: false });

  slabs.forEach((slab, i) => {
    const t0 = i * BEAT;
    const lower = i === 0 ? river : slabs[i - 1].level; // 下游的水位
    const fromX = i === 0 ? startX : slabs[i - 1].restX;
    // 最后一拍要给「升出水面」留出时间，前面的动作压紧。
    const k = i === BEATS - 1 ? 0.5 : 1;

    // 一、这一室放水，放到和下游齐平。
    timeline.add(state, { [`water${i}`]: [empty, lower - slab.top], duration: 420 * k, ease: 'outQuart' }, t0);
    // 二、船开进来。
    timeline.add(state, { boatX: [fromX, slab.restX], duration: 300 * k, ease: 'inOutQuad' }, t0 + 330 * k);
    // 三、身后的闸门关上。
    if (gateOf[i]) timeline.add(state, { [`gate${i}`]: [0, 1], duration: 120 * k, ease: 'outBack' }, t0 + 590 * k);
    // 四、水位升一级，船跟着升。
    timeline.add(state, { [`water${i}`]: [lower - slab.top, 0], duration: 290 * k, ease: 'outQuart' }, t0 + 700 * k);
    timeline.add(state, { boatY: [lower, slab.level], duration: 290 * k, ease: 'outQuart' }, t0 + 700 * k);
    // 实现那一段：水漫上来，五道分隔线显出来。
    if (i === 4) timeline.add(state, { lanes: [0, 1], duration: 220 }, t0 + 760);
  });

  // 收尾：水从上往下退，底下那张浅色的图在原地露出来。
  timeline.add(state, { surface: [0, 1], duration: 480, ease: 'inOutQuad' }, BEATS * BEAT - 480);

  // 第一帧直接到位，之后带着惯性追滚动位置。
  let shown = null;
  let last = null;
  const follower = createFollower(FOLLOW);
  return {
    kind: 'flat',
    frame(progress, now, snap = false) {
      const dt = last === null ? 0 : Math.min(0.1, (now - last) / 1000);
      last = now;
      shown = follower.step(progress, dt, snap);
      timeline.seek(shown * BEATS * BEAT);
      render();
    },
    destroy() {
      if (timeline.revert) timeline.revert();
      for (const element of [...slabs.map((slab) => slab.water), ...Object.values(gateOf), ...lanes, boat, float]) element.removeAttribute('style');
      stageVars.clear('--surface');
    },
  };
}

// 粘住的舞台只在放得下的视口里开（STAGE_QUERY，见 stage.js）。视口变了（转屏、改窗口大小、放大）就跟着开或者收：
// 收起来的时候这一节是静态的清单，八段都读得到。
export function initLock(root, anime, { reduced = false } = {}) {
  const none = { destroy() {} };
  if (reduced || !root.querySelector('[data-lock-track]')) return none;

  const doc = root.ownerDocument;
  const win = doc.defaultView;
  const query = win.matchMedia(STAGE_QUERY);
  let stage = null;
  const sync = () => {
    doc.documentElement.classList.toggle('stage-ok', query.matches);
    if (query.matches && !stage) stage = openStage(root, anime);
    else if (!query.matches && stage) {
      stage.destroy();
      stage = null;
    }
  };
  query.addEventListener('change', sync);
  sync();

  return {
    destroy() {
      query.removeEventListener('change', sync);
      if (stage) stage.destroy();
      stage = null;
    },
  };
}

function openStage(root, anime) {
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  const track = root.querySelector('[data-lock-track]');
  const canvas = root.querySelector('[data-lock-canvas]');
  const chambers = [...root.querySelectorAll('[data-stage]')];
  const ticks = [...root.querySelectorAll('[data-rail-beat]')];
  const tags = [...root.querySelectorAll('[data-ledger-beat]')];

  // --lock-progress 写在这一节上（只有收尾那两处淡入淡出读它）；--rise 写在页头上（只有页头读它，
  // 写在 <html> 上会让整页每帧重算样式）。都是值变了才写。
  const rootVars = styleWriter(root);
  const headerVars = styleWriter(doc.querySelector('[data-header]'));

  // 这一拍、这一段的文字、账本里已经落下的产物：直接跟着滚动位置走。
  let progress = 0;
  let shownBeat = -1;
  const apply = () => {
    progress = progressOf(track.getBoundingClientRect(), win.innerHeight);
    const beat = beatAt(progress, BEATS);
    rootVars.set('--lock-progress', fadeProgress(progress).toFixed(4));
    headerVars.set('--rise', progress.toFixed(4));
    if (beat === shownBeat) return;
    shownBeat = beat;
    root.dataset.beat = String(beat);
    // data-past：已经过去的几段。换段时它们往上淡走、后面的从下面浮上来；往回滚正好反过来（lock.css）
    chambers.forEach((chamber, i) => {
      chamber.toggleAttribute('data-current', i === beat);
      chamber.toggleAttribute('data-past', i < beat);
    });
    ticks.forEach((tick, i) => {
      tick.toggleAttribute('data-current', i === beat);
      tick.toggleAttribute('data-past', i < beat);
    });
    // data-in：已经落下的产物；data-now：这一拍刚落下的（手机上放不下全部，只显示这些）。
    tags.forEach((tag) => {
      const at = Number(tag.dataset.ledgerBeat);
      tag.toggleAttribute('data-in', at <= beat);
      tag.toggleAttribute('data-now', at === beat);
    });
  };

  let scene = null;
  let inView = false;
  const saveData = Boolean(win.navigator.connection && win.navigator.connection.saveData);
  // 走得了新画面就一开始把这一节标上 data-lock-film（画布的样式挂在它上面）：平面的那张图从头收着，
  // 不会在画面到之前先闪出来（在过闸中间刷新时，它闪出来的是停在开场的样子，和文字对不上）。
  // 省流量模式不下这一路（长条图有十几 MB）。
  const useReef = Boolean(readReef(canvas)) && Boolean(win.WebGLRenderingContext) && !saveData;
  if (useReef) root.setAttribute('data-lock-film', '');

  const show = (mounted) => {
    scene = mounted;
    if (!scene) {
      delete root.dataset.lockScene;
      return;
    }
    root.dataset.lockScene = scene.kind;
    apply();
    scene.frame(progress, win.performance.now(), true);
    if (inView && scene.fill) scene.fill();
  };

  // 新画面画不动了（帧率看门狗、丢了上下文）：收起画布，换成平面的那张图。
  const toFlat = () => {
    if (scene) scene.destroy();
    root.removeAttribute('data-lock-film');
    show(anime ? mountFlat(root, anime) : null);
  };

  const mount = () => {
    if (scene) return;
    let mounted = null;
    if (useReef) mounted = mountReef(root, canvas, { onFail: toFlat });
    if (!mounted) root.removeAttribute('data-lock-film');
    if (!mounted && anime) mounted = mountFlat(root, anime);
    show(mounted);
  };

  // 这一节在视口里的时候每帧做两件事：读一次滚动位置（不单靠 scroll 事件——有的浏览器在惯性滚动、
  // 或者脚本滚动之后，事件来得晚），再画一帧。不在视口里就停。
  let frame = 0;
  const loop = (now) => {
    apply();
    if (scene) scene.frame(progress, now);
    frame = inView ? win.requestAnimationFrame(loop) : 0;
  };
  const observer = new win.IntersectionObserver((entries) => {
    inView = entries[entries.length - 1].isIntersecting;
    apply();
    if (inView) {
      // 访客真的滚进来了：前后几块长条图这时候才开始预先下。
      if (scene && scene.fill) scene.fill();
      if (!frame) frame = win.requestAnimationFrame(loop);
    }
    // 滚出视口的那一刻画面直接到位：不然滚得快时惯性还没追上循环就停了，页头的颜色会停在半路。
    if (!inView && scene) scene.frame(progress, win.performance.now(), true);
  });
  observer.observe(track);

  // 离这一节还有一屏的时候挂上画面（先只下眼前这一两块长条图和鱼）。
  let timer = 0;
  const nearby = new win.IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      nearby.disconnect();
      // 这一节紧挨着首屏：页面刚打开时它就算「快到了」。访客还在首屏，就等首屏那段入场动画放完再挂，别抢它的帧；
      // 已经滚下来了（在过闸中间刷新、带着锚点进来），马上挂。
      const atTop = win.scrollY < win.innerHeight * 0.5;
      timer = win.setTimeout(mount, atTop ? Math.max(0, 3500 - win.performance.now()) : 0);
    },
    { rootMargin: '100% 0px 100% 0px' },
  );
  nearby.observe(track);

  const onChange = () => apply();
  win.addEventListener('scroll', onChange, { passive: true });

  // 滚轮一格走一段（用户：「能不能做成滚轮滚一下，就切换一下场景」）。只在舞台粘住的时候接管滚轮：
  // 滚一下，页面用 0.7 秒滑到下一段的停点（画面再带着惯性追过去）；滑的途中、或者触控板一次手势里连着来的滚轮都算这一下，
  // 不会连跳好几段；手停下（0.25 秒没有滚轮）再滚才是下一下。第一段往上、最后一段往下照常滚出这一节。
  // 键盘、触屏、拖滚动条照旧，不接管。
  const stops = stopsOf(readReef(canvas));
  let glide = null;
  let lastWheel = -1e9;
  let held = false; // 这一下手势已经被接管：手停下之前连着来的滚轮（触控板的惯性尾巴也是）都吞掉
  // 页面里有元素拿着焦点时 base.css 开着平滑滚动，scrollTo 每一帧都会变成一段慢慢滚，所以写明 instant
  const jump = (y) => {
    try {
      win.scrollTo({ top: y, behavior: 'instant' });
    } catch {
      win.scrollTo(0, y);
    }
  };
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  const glideTo = (target) => {
    const rect = track.getBoundingClientRect();
    const range = rect.height - win.innerHeight;
    const top = win.scrollY + rect.top;
    const from = win.scrollY;
    const to = Math.round(top + range * target);
    const start = win.performance.now();
    const duration = 700;
    if (glide) win.cancelAnimationFrame(glide.frame);
    glide = { target, frame: 0 };
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      jump(Math.round(from + (to - from) * easeInOut(t)));
      if (t < 1) glide.frame = win.requestAnimationFrame(tick);
      else glide = null;
    };
    glide.frame = win.requestAnimationFrame(tick);
  };
  const onWheel = (event) => {
    if (event.ctrlKey || !event.deltaY) return;
    const now = win.performance.now();
    const sameGesture = now - lastWheel < 250;
    lastWheel = now;
    if (sameGesture && held) {
      event.preventDefault();
      return;
    }
    held = false;
    const rect = track.getBoundingClientRect();
    const range = rect.height - win.innerHeight;
    if (range <= 0 || rect.top > 1 || rect.bottom < win.innerHeight - 1) return;
    // 正在滑：从要去的那一段算，不从滑到一半的位置算（滑的途中隔一会儿再滚一下，接着去再下一段）
    const from = glide ? glide.target : progressOf(rect, win.innerHeight);
    const target = nextStop(stops, from, Math.sign(event.deltaY));
    if (target === null) return;
    event.preventDefault();
    held = true;
    glideTo(target);
  };
  win.addEventListener('wheel', onWheel, { passive: false });
  win.addEventListener('resize', onChange);

  apply();
  root.dataset.lockLive = 'true';

  return {
    // 收干净：这一节要退回静态的清单（转屏以后放不下了），不能留着舞台的状态。
    destroy() {
      win.removeEventListener('scroll', onChange);
      win.removeEventListener('wheel', onWheel);
      if (glide) win.cancelAnimationFrame(glide.frame);
      win.removeEventListener('resize', onChange);
      observer.disconnect();
      nearby.disconnect();
      win.clearTimeout(timer);
      if (frame) win.cancelAnimationFrame(frame);
      if (scene) scene.destroy();
      scene = null;
      delete root.dataset.lockLive;
      delete root.dataset.lockScene;
      delete root.dataset.beat;
      root.removeAttribute('data-lock-film');
      rootVars.clear('--lock-progress');
      headerVars.clear('--rise');
      chambers.forEach((chamber) => {
        chamber.removeAttribute('data-current');
        chamber.removeAttribute('data-past');
      });
      ticks.forEach((tick) => {
        tick.removeAttribute('data-current');
        tick.removeAttribute('data-past');
      });
      tags.forEach((tag) => {
        tag.removeAttribute('data-in');
        tag.removeAttribute('data-now');
      });
    },
  };
}
