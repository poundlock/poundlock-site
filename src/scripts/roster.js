// 团队那张图：指到或聚焦一个角色，它和它连着的线亮起来，线另一头的角色也标出来。
// 角色管什么的文字本来就在页面上，这里只管高亮。edgesOf、linkedTo 是纯函数，Node 里能直接测。

// 一条线写成 "谁>谁"。id 这个角色连着的线：派进来的、派出去的都算。
export function edgesOf(id, edges) {
  return edges.filter((edge) => {
    const [from, to] = edge.split('>');
    return from === id || to === id;
  });
}

// 线另一头的角色。
export function linkedTo(id, edges) {
  return edgesOf(id, edges).map((edge) => {
    const [from, to] = edge.split('>');
    return from === id ? to : from;
  });
}

const mark = (element, name, on) => {
  if (on) element.setAttribute(name, 'true');
  else element.removeAttribute(name);
};

export function initRoster(root) {
  const nodes = [...root.querySelectorAll('[data-role-node]')];
  const paths = [...root.querySelectorAll('[data-edge]')];
  const edges = paths.map((path) => path.dataset.edge);
  let hovered = null;
  let focused = null;
  let shown = null;

  const show = () => {
    // 键盘聚焦的优先；没有聚焦的，看鼠标指着谁。
    const id = focused ?? hovered;
    if (id === shown) return;
    shown = id;
    const live = new Set(id ? edgesOf(id, edges) : []);
    const linked = new Set(id ? linkedTo(id, edges) : []);
    for (const path of paths) {
      const on = live.has(path.dataset.edge);
      mark(path, 'data-active', on);
      // 亮着的线挪到最后画，压在别的线上面。
      if (on) path.parentNode.appendChild(path);
    }
    for (const node of nodes) {
      mark(node, 'data-active', node.dataset.roleNode === id);
      mark(node, 'data-linked', linked.has(node.dataset.roleNode));
    }
    mark(root, 'data-roster-focus', Boolean(id));
  };

  for (const node of nodes) {
    const id = node.dataset.roleNode;
    node.addEventListener('pointerenter', () => {
      hovered = id;
      show();
    });
    node.addEventListener('pointerleave', () => {
      if (hovered === id) hovered = null;
      show();
    });
    node.addEventListener('focus', () => {
      focused = id;
      show();
    });
    node.addEventListener('blur', () => {
      if (focused === id) focused = null;
      show();
    });
  }
  root.dataset.rosterLive = 'true';
}
