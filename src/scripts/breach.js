// 闯闸：六种偷懒的办法，点一个，看对应的那道门禁怎么关上。
// 六种办法和各自「门禁说的话」本来就在页面上（不靠脚本也读得到）；这里把它变成可以点的演示。
// createBreachState 是纯函数，Node 里能直接测。

export function createBreachState(ids) {
  const known = new Set(ids);
  const tried = new Set();
  return {
    attempt(id) {
      if (!known.has(id)) throw new RangeError(`不认识的办法：${id}`);
      const first = !tried.has(id);
      tried.add(id);
      return { id, first, tried: tried.size, allTried: tried.size === known.size };
    },
    reset() {
      tried.clear();
    },
  };
}

// anime 是 null（减少动效，或者动效库没加载出来）时，点了直接是关上的样子，不演过程。
export function initBreach(root, anime, { reduced = false } = {}) {
  const buttons = [...root.querySelectorAll('button[data-attempt]')];
  const out = root.querySelector('[data-breach-out]');
  const all = root.querySelector('[data-breach-all]');
  const scene = root.querySelector('.breach__svg');
  if (!buttons.length || !out) return;

  const state = createBreachState(buttons.map((button) => button.dataset.attempt));
  const still = reduced || !anime;

  const boat = scene && scene.querySelector('.breach__boat');
  const gate = scene && scene.querySelector('.breach__gate');
  const ring = scene && scene.querySelector('.breach__ring');
  let running = null;

  // 船冲向闸门，闸门带着分量关上，船被挡回来。
  const slam = () => {
    if (!scene) return;
    scene.dataset.closed = 'true';
    if (still) return;
    if (running) running.cancel();
    running = anime
      .createTimeline()
      .add(gate, { scaleY: [0, 1], duration: 300, ease: 'outBack' }, 150)
      .add(boat, { translateX: [0, 44], duration: 210, ease: 'inQuad' }, 0)
      .add(boat, { translateX: [44, -10], duration: 260, ease: 'outQuad' }, 210)
      .add(boat, { translateX: [-10, 0], duration: 420, ease: 'outQuad' }, 470)
      .add(ring, { scale: [0.3, 1.8], opacity: [0.9, 0], duration: 520, ease: 'outQuad' }, 200);
  };

  const show = (id) => {
    const button = buttons.find((item) => item.dataset.attempt === id);
    const result = state.attempt(id);

    for (const item of buttons) item.setAttribute('aria-pressed', String(item === button));
    button.dataset.tried = 'true';

    const badge = root.querySelector(`[data-gate="${button.dataset.gateRef}"]`);
    if (badge) badge.dataset.lit = 'true';

    // 门禁说的话取自页面上已有的那一条，不在脚本里另存一份。
    const says = root.querySelector(`[data-says-for="${id}"]`);
    out.replaceChildren(...[...says.childNodes].map((node) => node.cloneNode(true)));
    out.dataset.shown = 'true';
    if (!still) anime.animate(out, { opacity: [0, 1], translateY: [10, 0], duration: 320, ease: 'outQuart' });

    if (all && result.allTried) all.hidden = false;
    slam();
  };

  for (const button of buttons) button.addEventListener('click', () => show(button.dataset.attempt));

  if (all) all.hidden = true;
  root.dataset.breachLive = 'true';
}
