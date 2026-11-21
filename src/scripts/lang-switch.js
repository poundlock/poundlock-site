// 语言切换：换到另一种语言时，落在访客正在看的那一节，不是页顶。
// 链接本身是普通的链接（没有脚本也能换语言，只是到页顶）；这里在点它之前给它补上锚点。
// sectionAt、withHash 是纯函数，Node 里能直接测。

// sections：按页面顺序的 [{ id, top }]，top 是这一节顶边相对视口的位置；line：视口里的一条线。
// 顶边已经过了这条线的最后一节，就是正在看的那一节。
export function sectionAt(sections, line) {
  let current = null;
  for (const section of sections) {
    if (section.top <= line) current = section.id;
  }
  return current;
}

// 给链接带上锚点。还在第一节、或者不知道在哪，就不带：到另一页的页顶。
export function withHash(href, id, firstId) {
  const bare = href.split('#')[0];
  return id && id !== firstId ? `${bare}#${id}` : bare;
}

export function initLangSwitch(root) {
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  const links = [...doc.querySelectorAll('[data-lang-switch]')];
  const sections = [...doc.querySelectorAll('[data-section]')];
  if (!links.length || !sections.length) return;
  const update = () => {
    const id = sectionAt(
      sections.map((section) => ({ id: section.id, top: section.getBoundingClientRect().top })),
      win.innerHeight * 0.4,
    );
    for (const link of links) link.setAttribute('href', withHash(link.getAttribute('href'), id, sections[0].id));
  };
  // 指上去、键盘聚焦、点下去之前，各补一次：右键「在新标签页打开」拿到的也是带锚点的地址。
  for (const link of links) {
    for (const type of ['pointerenter', 'pointerdown', 'focus', 'click']) link.addEventListener(type, update);
  }
}
