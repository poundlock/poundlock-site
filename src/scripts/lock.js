// 过闸：画面停在视口里，滚动推进一条时间线，八拍，对应 S1 到 S8。
// 默认的版式是静态的（八个阶段的清单加一张升满了的图）；这里只在动效库在、系统没要求减少动效时接管。
// beatAt、progressOf 是纯函数，Node 里能直接测。

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

const BEAT = 1000; // 时间线上一拍的长度
const BEATS = 8;

export function initLock(root, anime, { reduced = false } = {}) {
  if (reduced || !anime) return { destroy() {} };

  const doc = root.ownerDocument;
  const win = doc.defaultView;
  const track = root.querySelector('[data-lock-track]');
  const waterLayer = root.querySelector('[data-lock-water]');
  // 水下那一张才是要驱动的；水面以上那一张是静态的。
  const svg = waterLayer && waterLayer.querySelector('.lock__svg');
  const chambers = [...root.querySelectorAll('[data-stage]')];
  const tags = [...root.querySelectorAll('[data-ledger-beat]')];
  const stage = root.querySelector('.lock__stage');
  if (!track || !svg || !waterLayer) return { destroy() {} };

  const { createTimeline, onScroll } = anime;
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

  // 这一拍、这一段的文字、账本里已经落下的产物：直接跟着滚动位置走，不等时间线的缓动。
  let shownBeat = -1;
  const apply = () => {
    const p = progressOf(track.getBoundingClientRect(), win.innerHeight);
    const beat = beatAt(p, BEATS);
    root.style.setProperty('--lock-progress', p.toFixed(4));
    doc.documentElement.style.setProperty('--rise', p.toFixed(4));
    if (beat === shownBeat) return;
    shownBeat = beat;
    root.dataset.beat = String(beat);
    chambers.forEach((chamber, i) => chamber.toggleAttribute('data-current', i === beat));
    tags.forEach((tag) => tag.toggleAttribute('data-in', Number(tag.dataset.ledgerBeat) <= beat));
  };

  // 画面的状态是一个普通对象，时间线只管把里面的数算出来；怎么写进页面由 render 一处决定。
  // 这样往回滚、刷新、改窗口大小，画面都只取决于时间线走到哪。
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

  const timeline = createTimeline({
    defaults: { ease: 'linear' },
    autoplay: onScroll({ target: track, enter: 'top top', leave: 'bottom bottom', sync: 0.6 }),
    onUpdate: render,
  });

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

  // 这一节在视口里的时候每帧做两件事：读一次滚动位置（不单靠 scroll 事件——有的浏览器在惯性滚动、
  // 或者脚本滚动之后，事件来得晚），再把时间线算出来的状态画上去（它带着缓动追滚动位置）。不在视口里就停。
  let frame = 0;
  let inView = false;
  const loop = () => {
    apply();
    render();
    frame = inView ? win.requestAnimationFrame(loop) : 0;
  };
  const observer = new win.IntersectionObserver((entries) => {
    inView = entries[entries.length - 1].isIntersecting;
    apply();
    if (inView && !frame) frame = win.requestAnimationFrame(loop);
  });
  observer.observe(track);

  const onChange = () => apply();
  win.addEventListener('scroll', onChange, { passive: true });
  win.addEventListener('resize', onChange);

  root.dataset.lockLive = 'true';
  apply();
  render();

  return {
    destroy() {
      win.removeEventListener('scroll', onChange);
      win.removeEventListener('resize', onChange);
      observer.disconnect();
      if (frame) win.cancelAnimationFrame(frame);
      if (timeline.revert) timeline.revert();
      delete root.dataset.lockLive;
    },
  };
}
