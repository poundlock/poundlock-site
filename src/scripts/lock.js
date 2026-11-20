// 过闸：画面停在视口里，滚动推进，八拍，对应 S1 到 S8。
// 默认的版式是静态的（八个阶段的清单加一张升满了的图）；这里只在系统没要求减少动效时接管。
// 接管以后有两种画法：先试三维的（lock3d.js，要 WebGL）；起不来，就用平面的那张图（要动效库）。
// beatAt、progressOf 是纯函数，Node 里能直接测。

import { lockStateAt } from './lock-state.js';
import { createFpsWatchdog } from './motion.js';

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

// 三维的画法。画面跟着滚动位置走，带一点惯性，不是一格一格跳。
async function mountSpace(root, canvas) {
  const { mountLock3D } = await import('./lock3d.js');
  const space = mountLock3D(root, canvas);
  const layer = root.querySelector('[data-lock-water]');
  let shown = null;
  let last = null;
  return {
    kind: 'space',
    // snap：不带惯性，直接到位。
    frame(progress, now, snap = false) {
      // 第一帧直接到位（刷新、带锚点进来时不从头演一遍）；之后带着惯性追。
      const dt = last === null ? 0 : Math.min(0.1, (now - last) / 1000);
      last = now;
      shown = shown === null || snap ? progress : shown + (progress - shown) * (1 - Math.exp(-dt * 7));
      const state = lockStateAt(shown, BEATS);
      space.frame(state, now / 1000);
      // 天亮以后，压在画面上的字换成浅色段的颜色。
      const day = state.day > 0.5;
      root.toggleAttribute('data-day', day);
      if (layer) layer.classList.toggle('on-light', day);
      // 页头固定在最上面，压着这块画面：天亮了它也换成浅色。
      root.ownerDocument.documentElement.style.setProperty('--header-day', day ? '1' : '0');
    },
    lowerQuality: () => space.lowerQuality(),
    destroy() {
      space.destroy();
      root.ownerDocument.documentElement.style.removeProperty('--header-day');
      root.removeAttribute('data-day');
      if (layer) layer.classList.remove('on-light');
    },
  };
}

// 平面的画法：那张八片的图。动效库的时间线管每一拍里各个动作的缓动，走到哪由滚动进度定。
function mountFlat(root, anime) {
  const waterLayer = root.querySelector('[data-lock-water]');
  const svg = waterLayer && waterLayer.querySelector('.lock__svg');
  const stage = root.querySelector('.lock__stage');
  if (!svg || !stage) return null;

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
    stage.style.setProperty('--surface', state.surface.toFixed(4));
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

  // 和三维的那一版一样：第一帧直接到位，之后带着惯性追滚动位置。
  let shown = null;
  let last = null;
  return {
    kind: 'flat',
    frame(progress, now, snap = false) {
      const dt = last === null ? 0 : Math.min(0.1, (now - last) / 1000);
      last = now;
      shown = shown === null || snap ? progress : shown + (progress - shown) * (1 - Math.exp(-dt * 7));
      timeline.seek(shown * BEATS * BEAT);
      render();
    },
    destroy() {
      if (timeline.revert) timeline.revert();
    },
  };
}

export function initLock(root, anime, { reduced = false } = {}) {
  const none = { destroy() {} };
  if (reduced) return none;

  const doc = root.ownerDocument;
  const win = doc.defaultView;
  const track = root.querySelector('[data-lock-track]');
  const canvas = root.querySelector('[data-lock-canvas]');
  const chambers = [...root.querySelectorAll('[data-stage]')];
  const tags = [...root.querySelectorAll('[data-ledger-beat]')];
  if (!track) return none;

  // 这一拍、这一段的文字、账本里已经落下的产物：直接跟着滚动位置走。
  let progress = 0;
  let shownBeat = -1;
  const apply = () => {
    progress = progressOf(track.getBoundingClientRect(), win.innerHeight);
    const beat = beatAt(progress, BEATS);
    root.style.setProperty('--lock-progress', progress.toFixed(4));
    doc.documentElement.style.setProperty('--rise', progress.toFixed(4));
    if (beat === shownBeat) return;
    shownBeat = beat;
    root.dataset.beat = String(beat);
    chambers.forEach((chamber, i) => chamber.toggleAttribute('data-current', i === beat));
    tags.forEach((tag) => tag.toggleAttribute('data-in', Number(tag.dataset.ledgerBeat) <= beat));
  };

  // 画面（三维的，或者平面的）等快滚到这一节了才去加载：三维的库很大，页面一打开就加载它，
  // 会让首屏卡一下——出过一次事：首屏的水面因此被当成「设备画不动」关掉了。
  let scene = null;
  let mounting = false;
  let strikes = 0;
  let watchdog = null;

  // 三维的画不动时：先降清晰度；还不行，换成平面的。
  const watch = () => {
    watchdog = createFpsWatchdog({
      minFps: 30,
      onDegrade: () => {
        strikes++;
        if (!scene || scene.kind !== 'space') return;
        if (strikes === 1) {
          scene.lowerQuality();
          watch();
        } else if (anime) {
          scene.destroy();
          root.removeAttribute('data-lock-3d');
          scene = mountFlat(root, anime);
          if (scene) root.dataset.lockScene = scene.kind;
        }
      },
    });
  };

  const mount = async () => {
    if (scene || mounting) return;
    mounting = true;
    let mounted = null;
    if (canvas) {
      try {
        root.setAttribute('data-lock-3d', 'true');
        mounted = await mountSpace(root, canvas);
      } catch (error) {
        root.removeAttribute('data-lock-3d');
        console.warn('[poundlock] 三维的过闸没起来，改用平面的。', error);
      }
    }
    if (!mounted && anime) mounted = mountFlat(root, anime);
    mounting = false;
    if (!mounted) return;
    scene = mounted;
    root.dataset.lockScene = scene.kind;
    if (scene.kind === 'space') watch();
    apply();
    scene.frame(progress, win.performance.now(), true);
  };

  // 这一节在视口里的时候每帧做两件事：读一次滚动位置（不单靠 scroll 事件——有的浏览器在惯性滚动、
  // 或者脚本滚动之后，事件来得晚），再画一帧。不在视口里就停。
  let frame = 0;
  let inView = false;
  const loop = (now) => {
    apply();
    if (scene) scene.frame(progress, now);
    if (watchdog && scene && scene.kind === 'space') watchdog.tick();
    frame = inView ? win.requestAnimationFrame(loop) : 0;
  };
  const observer = new win.IntersectionObserver((entries) => {
    inView = entries[entries.length - 1].isIntersecting;
    apply();
    if (inView && !frame) frame = win.requestAnimationFrame(loop);
    // 滚出视口的那一刻画面直接到位：不然滚得快时惯性还没追上循环就停了，页头的颜色会停在半路。
    if (!inView && scene) scene.frame(progress, win.performance.now(), true);
  });
  observer.observe(track);

  // 离这一节还有一屏的时候开始加载画面。
  const nearby = new win.IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      // 这一节紧挨着首屏：页面刚打开时它就算「快到了」。等首屏那段入场动画放完再加载，别抢它的帧。
      win.setTimeout(mount, Math.max(0, 3500 - win.performance.now()));
    },
    { rootMargin: '100% 0px 100% 0px' },
  );
  nearby.observe(track);

  const onChange = () => apply();
  win.addEventListener('scroll', onChange, { passive: true });
  win.addEventListener('resize', onChange);

  apply();
  root.dataset.lockLive = 'true';

  return {
    destroy() {
      win.removeEventListener('scroll', onChange);
      win.removeEventListener('resize', onChange);
      observer.disconnect();
      nearby.disconnect();
      if (frame) win.cancelAnimationFrame(frame);
      if (watchdog) watchdog.stop();
      if (scene) scene.destroy();
      delete root.dataset.lockLive;
      delete root.dataset.lockScene;
      root.removeAttribute('data-lock-3d');
    },
  };
}
