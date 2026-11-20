// 过闸的影片：离线渲染好的一串画面（tools/film/），滚到哪就画哪一帧。
// 画面有横版、竖版两套；一套有一两百帧，先稀后密地加载——头十几帧到了就能拖，其余的在后面补齐。
// frameAt、loadOrder、nearestLoaded、coverRect、pickSet 是纯函数，Node 里能直接测。


// 进度（0 到 1）对应第几帧。
export function frameAt(progress, count) {
  const p = Math.min(1, Math.max(0, progress));
  return Math.min(count - 1, Math.max(0, Math.round(p * (count - 1))));
}

// 加载的先后：先每隔十六帧取一帧铺满整段（连最后一帧），再每隔八帧、四帧、两帧，最后补齐。
export function loadOrder(count) {
  const seen = new Set();
  const order = [];
  const push = (i) => {
    if (i < 0 || i >= count || seen.has(i)) return;
    seen.add(i);
    order.push(i);
  };
  for (let stride = 16; stride >= 1; stride /= 2) {
    for (let i = 0; i < count; i += stride) push(i);
    if (stride === 16) push(count - 1);
  }
  return order;
}

// 要画第 index 帧，它还没到：用已经到了的里面最近的一帧。一帧都没到返回 -1。
export function nearestLoaded(index, has, count) {
  for (let d = 0; d < count; d++) {
    if (index - d >= 0 && has(index - d)) return index - d;
    if (index + d < count && has(index + d)) return index + d;
  }
  return -1;
}

// 把 fw×fh 的画面铺满 vw×vh 的视口，画面的中心落在视口的 (ax, ay) 处（0 到 1）。
// 横向照 ax 摆（为此可以把画面放得比「刚好铺满」大）；竖向尽量照 ay，摆不下就贴边，不露底。
export function coverRect(fw, fh, vw, vh, ax = 0.5, ay = 0.5) {
  const scale = Math.max(vh / fh, (2 * Math.max(ax, 1 - ax) * vw) / fw);
  const w = fw * scale;
  const h = fh * scale;
  const x = ax * vw - w / 2;
  const y = Math.min(0, Math.max(vh - h, ay * vh - h / 2));
  return { x, y, w, h };
}

// 视口是横的用横版，竖的用竖版；只有一版就用那一版。
export function pickSet(sets, vw, vh) {
  const order = vw >= vh ? ['wide', 'tall'] : ['tall', 'wide'];
  return order.find((name) => sets && sets[name]) ?? null;
}

const PARALLEL = 6; // 同时下载几帧
// 影片里天亮的那一刻（进度）：太阳刚从运河尽头冒出来，画面顶上已经是亮的。
// 是照着渲染脚本里的天色定的（tools/film/render.py 的 sky_time），改那里要一起改。
export const DAY_AT = 0.955;

// film = { base, sets: { wide: { dir, ext, count, width, height }, tall: {…} } }
// 返回 { kind: 'film', frame(progress, now, snap), destroy() }；画不了返回 null。
// onFail：画面一帧都下不来的时候调一次（调用方换成平面的那张图）。
export function mountFilm(root, canvas, film, { onFail } = {}) {
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx || !film || !film.sets) return null;

  let name = null;
  let set = null;
  let images = [];
  let loaded = new Set();
  let queue = [];
  let active = 0;
  let generation = 0;
  let failures = 0;
  let wanted = 0;
  let drawn = -1;
  let shown = null;
  let last = null;
  let anchor = { x: 0.5, y: 0.5 };
  let dead = false;

  const paint = (force) => {
    if (!set) return;
    const index = nearestLoaded(wanted, (i) => loaded.has(i), set.count);
    if (index < 0 || (index === drawn && !force)) return;
    const rect = coverRect(set.width, set.height, canvas.width, canvas.height, anchor.x, anchor.y);
    ctx.drawImage(images[index], rect.x, rect.y, rect.w, rect.h);
    drawn = index;
    canvas.dataset.frame = String(index);
    if (!root.hasAttribute('data-lock-film-ready')) root.setAttribute('data-lock-film-ready', '');
  };

  const pump = () => {
    while (!dead && active < PARALLEL && queue.length) {
      const index = queue.shift();
      const mine = generation;
      const image = new win.Image();
      image.decoding = 'async';
      image.onload = () => {
        if (mine !== generation) return;
        active--;
        images[index] = image;
        loaded.add(index);
        // 新到的这一帧比现在画着的更接近要画的那一帧，就换上。
        if (drawn < 0 || Math.abs(index - wanted) < Math.abs(drawn - wanted)) paint(false);
        pump();
      };
      image.onerror = () => {
        if (mine !== generation) return;
        active--;
        failures++;
        if (failures >= PARALLEL && loaded.size === 0 && !dead) {
          dead = true;
          if (onFail) onFail();
          return;
        }
        pump();
      };
      image.src = `${film.base}${set.dir}/f${String(index).padStart(4, '0')}.${set.ext}`;
      active++;
    }
  };

  // 量画布、读画面中心该落在哪（样式里的 --film-x、--film-y），按视口是横是竖挑一套画面。
  const layout = () => {
    const ratio = Math.min(win.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const css = win.getComputedStyle(canvas);
    const read = (prop, fallback) => {
      const value = parseFloat(css.getPropertyValue(prop));
      return Number.isFinite(value) ? value : fallback;
    };
    anchor = { x: read('--film-x', 0.5), y: read('--film-y', 0.5) };
    const next = pickSet(film.sets, canvas.clientWidth, canvas.clientHeight);
    if (next !== name) {
      name = next;
      set = film.sets[name];
      generation++;
      images = new Array(set.count);
      loaded = new Set();
      queue = loadOrder(set.count);
      active = 0;
      drawn = -1;
      canvas.dataset.filmSet = name;
      pump();
    }
    if (shown !== null) wanted = frameAt(shown, set.count);
    paint(true);
  };

  // 拖到一段还没下完的地方：把这附近的帧提到队伍最前面。
  let nudged = 0;
  const hurry = (now) => {
    if (!queue.length || loaded.has(wanted) || now - nudged < 200) return;
    nudged = now;
    const near = [];
    const rest = [];
    for (const index of queue) (Math.abs(index - wanted) <= 6 ? near : rest).push(index);
    near.sort((a, b) => Math.abs(a - wanted) - Math.abs(b - wanted));
    queue = near.concat(rest);
  };

  const onResize = () => layout();
  win.addEventListener('resize', onResize);
  layout();

  return {
    kind: 'film',
    // snap：不带惯性，直接到位。
    frame(progress, now, snap = false) {
      if (dead || !set) return;
      // 第一帧直接到位（刷新、带锚点进来时不从头演一遍）；之后带着惯性追。
      const dt = last === null ? 0 : Math.min(0.1, (now - last) / 1000);
      last = now;
      shown = shown === null || snap ? progress : shown + (progress - shown) * (1 - Math.exp(-dt * 7));
      wanted = frameAt(shown, set.count);
      hurry(now);
      paint(false);
      // 页头固定在最上面，压着这块画面：天亮以后画面顶上是亮的，它换成浅色段的样子。
      const day = shown >= DAY_AT;
      root.toggleAttribute('data-day', day);
      doc.documentElement.style.setProperty('--header-day', day ? '1' : '0');
    },
    destroy() {
      dead = true;
      generation++;
      queue = [];
      win.removeEventListener('resize', onResize);
      doc.documentElement.style.removeProperty('--header-day');
      root.removeAttribute('data-day');
      root.removeAttribute('data-lock-film-ready');
      delete canvas.dataset.frame;
      delete canvas.dataset.filmSet;
    },
  };
}
