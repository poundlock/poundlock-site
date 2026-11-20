// 复制安装命令的按钮。命令本来就在页面上、能手动选；这里只是省一步。
// 浏览器给剪贴板就直接复制；不给（没有这个接口、或者被拒绝）就把那段命令选中，让访客自己按复制。
// copyText 是纯逻辑，Node 里能直接测。

export async function copyText(text, { clipboard, legacyCopy } = {}) {
  if (clipboard && typeof clipboard.writeText === 'function') {
    try {
      await clipboard.writeText(text);
      return 'copied';
    } catch {
      // 被拒绝（没有权限、页面不在前台……）：走下面选中的那一路。
    }
  }
  if (legacyCopy) legacyCopy(text);
  return 'selected';
}

const RESET_MS = 2000;

// root 里的每个 button[data-copy]，复制离它最近的那段 pre[data-copy-source]。
// 按钮上的 data-label-copied / data-label-fallback 是两种结果各自要显示的字，两秒后换回原来的。
export function initCopyButtons(root) {
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  for (const button of root.querySelectorAll('button[data-copy]')) {
    const scope = button.closest('[data-copy-scope]') ?? button.parentElement;
    const source = scope && scope.querySelector('pre[data-copy-source]');
    if (!source) continue;
    const label = button.querySelector('[data-copy-label]') ?? button;
    const idle = label.textContent;
    let timer = 0;

    const select = () => {
      const range = doc.createRange();
      range.selectNodeContents(source);
      const selection = win.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    };

    button.addEventListener('click', async () => {
      const result = await copyText(source.textContent, { clipboard: win.navigator.clipboard, legacyCopy: select });
      label.textContent = result === 'copied' ? button.dataset.labelCopied : button.dataset.labelFallback;
      button.dataset.copyState = result;
      win.clearTimeout(timer);
      timer = win.setTimeout(() => {
        label.textContent = idle;
        delete button.dataset.copyState;
      }, RESET_MS);
    });
  }
}
