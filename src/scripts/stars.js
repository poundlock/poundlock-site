// 星标数。取不到（仓库还没公开、被限流、断网）就只显示按钮，不显示数字。
// 导入时不碰 window、document，Node 里能直接测。

// 不到 1000 原样；1000 到 9999 保留一位小数加 k，去掉 .0；一万以上取整加 k。
export function formatStars(n) {
  if (n < 1000) return String(n);
  if (n >= 10000) return `${Math.round(n / 1000)}k`;
  const tenths = Math.round(n / 100);
  return tenths >= 100 ? '10k' : `${tenths % 10 === 0 ? tenths / 10 : (tenths / 10).toFixed(1)}k`;
}

function defaultStorage() {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function readCache(storage, key) {
  try {
    const value = storage && storage.getItem(key);
    return value !== null && value !== undefined && /^\d+$/.test(value) ? Number(value) : null;
  } catch {
    return null;
  }
}

function writeCache(storage, key, n) {
  try {
    if (storage) storage.setItem(key, String(n));
  } catch {
    // 存不进去不要紧：下次再取一遍。
  }
}

// 返回星标数；取不到返回 null，从不抛。取到的数在这次会话里缓存。
export async function loadStars({ api, fetchImpl = globalThis.fetch, storage = defaultStorage(), key = 'pl-stars' }) {
  const cached = readCache(storage, key);
  if (cached !== null) return cached;
  try {
    const response = await fetchImpl(api);
    if (!response.ok) return null;
    const data = await response.json();
    const n = data && data.stargazers_count;
    if (!Number.isInteger(n) || n < 0) return null;
    writeCache(storage, key, n);
    return n;
  } catch {
    return null;
  }
}

// 给页面上每个放数字的位置填上并显示；n 是 null 时什么都不动。
export function mountStars(doc, n) {
  if (n === null || n === undefined) return;
  for (const element of doc.querySelectorAll('[data-star-count]')) {
    element.textContent = formatStars(n);
    element.hidden = false;
  }
}
