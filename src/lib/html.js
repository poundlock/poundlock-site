// 带转义的模板标签。插值里的字符串一律转义；html`` 的结果和 raw() 的结果是 Raw，原样拼进去。

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ENTITIES[ch]);
}

class Raw {
  constructor(text) {
    this.text = text;
  }
  toString() {
    return this.text;
  }
}

export function raw(text) {
  return new Raw(String(text));
}

function render(value) {
  if (value === null || value === undefined || value === false) return '';
  if (value instanceof Raw) return value.text;
  if (Array.isArray(value)) return value.map(render).join('');
  return escapeHtml(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
  return new Raw(out);
}
