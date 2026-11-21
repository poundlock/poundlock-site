// 过闸：画面停在视口里，滚动推进，八拍，对应 S1 到 S8。
// 默认的版式是静态的（八个阶段的清单加一张升满了的图）；这里只在系统没要求减少动效时接管。
// 接管以后有两种画法：先用影片（lock-film.js：离线渲染好的一串画面，滚到哪画哪一帧）；
// 页面没带影片、访客开了省流量、画面下不来，就用平面的那张图（要动效库）。
// beatAt、progressOf 是纯函数，Node 里能直接测。

import { lockStateAt } from './lock-state.js';
import { mountFilm } from './lock-film.js';
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

// 画布上带着影片的清单（生成页面时写进去的）；没带、或者写坏了，就是没有影片。
function readFilm(canvas) {
  if (!canvas || !canvas.dataset.film) return null;
  try {
    const film = JSON.parse(canvas.dataset.film);
    return film && film.sets && Object.keys(film.sets).length ? film : null;
  } catch {
    return null;
  }
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

  // 和影片那一版一样：第一帧直接到位，之后带着惯性追滚动位置。
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
      for (const element of [...slabs.map((slab) => slab.water), ...Object.values(gateOf), ...lanes, boat, float]) element.removeAttribute('style');
      stage.style.removeProperty('--surface');
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
  const tags = [...root.querySelectorAll('[data-ledger-beat]')];

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
    // data-in：已经落下的产物；data-now：这一拍刚落下的（手机上放不下全部，只显示这些）。
    tags.forEach((tag) => {
      const at = Number(tag.dataset.ledgerBeat);
      tag.toggleAttribute('data-in', at <= beat);
      tag.toggleAttribute('data-now', at === beat);
    });
  };

  let scene = null;
  let inView = false;
  const film = readFilm(canvas);
  const saveData = Boolean(win.navigator.connection && win.navigator.connection.saveData);
  const useFilm = Boolean(film) && !saveData;
  // 有影片就一开始把这一节标成影片版：平面的那张图从头收着，不会在影片到之前先闪出来
  // （在过闸中间刷新时，它闪出来的是停在开场的样子，和文字对不上）。
  if (useFilm) root.setAttribute('data-lock-film', '');

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

  // 影片一帧都下不来：收起画布，换成平面的那张图。
  const toFlat = () => {
    if (scene) scene.destroy();
    root.removeAttribute('data-lock-film');
    show(anime ? mountFlat(root, anime) : null);
  };

  const mount = () => {
    if (scene) return;
    let mounted = null;
    if (useFilm) {
      mounted = mountFilm(root, canvas, film, { onFail: toFlat });
      if (!mounted) root.removeAttribute('data-lock-film');
    }
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
      // 访客真的滚进来了：影片其余的帧这时候才开始下。
      if (scene && scene.fill) scene.fill();
      if (!frame) frame = win.requestAnimationFrame(loop);
    }
    // 滚出视口的那一刻画面直接到位：不然滚得快时惯性还没追上循环就停了，页头的颜色会停在半路。
    if (!inView && scene) scene.frame(progress, win.performance.now(), true);
  });
  observer.observe(track);

  // 离这一节还有一屏的时候挂上画面（影片先只下头一遍稀的，一两 MB）。
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
  win.addEventListener('resize', onChange);

  apply();
  root.dataset.lockLive = 'true';

  return {
    // 收干净：这一节要退回静态的清单（转屏以后放不下了），不能留着舞台的状态。
    destroy() {
      win.removeEventListener('scroll', onChange);
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
      root.style.removeProperty('--lock-progress');
      doc.documentElement.style.removeProperty('--rise');
      chambers.forEach((chamber) => chamber.removeAttribute('data-current'));
      tags.forEach((tag) => {
        tag.removeAttribute('data-in');
        tag.removeAttribute('data-now');
      });
    },
  };
}
