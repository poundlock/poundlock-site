// 往一个元素上写样式变量：值变了才真的写。
// 过闸这一节滚动时每帧都会调到；同一个值反复写，浏览器也会把读这个变量的那一整棵子树重算一遍样式。
// 写在谁身上也要挑：写在 <html> 上会让整页重算，所以只写在真正读它的那个元素上。

export function styleWriter(element) {
  const last = new Map();
  return {
    set(name, value) {
      if (!element || last.get(name) === value) return;
      last.set(name, value);
      element.style.setProperty(name, value);
    },
    clear(name) {
      if (!element) return;
      last.delete(name);
      element.style.removeProperty(name);
    },
  };
}
