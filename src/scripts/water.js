// 首屏的水面：一段手写的 WebGL 片元着色器。画的是「从水下往上看」：上半屏是水面的底面（按透视铺开的波），
// 顶上偏右一扇亮窗透进天光，光柱从那里往下照，水里飘着细细的微尘。
// 终端后面那一块画成糊开、压暗的水（终端的底是半透明的，看起来是一块磨砂的深色玻璃）；标题那一块的波光压淡，字读得清。
// 减少动效、拿不到 WebGL、丢了上下文、帧率撑不住，都落到静态：画布标 data-mode="static"，由样式显示渐变，终端也回到实心的底。
// 导入时不碰 window、document，Node 里能直接测。

import { createFpsWatchdog } from './motion.js';

const VERTEX = `
attribute vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

// 颜色不写在着色器里：挂上去的时候从调色板读，读不到用下面的默认色。
const DEFAULT_COLORS = {
  '--scene-0': [0.043, 0.376, 0.533],
  '--scene-1': [0.016, 0.106, 0.2],
  '--scene-glow': [0.498, 0.89, 1],
  '--scene-surface': [0.812, 0.957, 1],
  '--zd-bg': [0.02, 0.122, 0.22],
};

const UNIFORM_OF = {
  '--scene-0': 'u_deep0',
  '--scene-1': 'u_deep1',
  '--scene-glow': 'u_glow',
  '--scene-surface': 'u_surface',
  '--zd-bg': 'u_floor',
};

// '#11606A' → [0.067, 0.376, 0.416]。不是六位十六进制色值就返回 null。
export function hexToRgb(value) {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(value ?? '').trim());
  return match ? match.slice(1).map((part) => parseInt(part, 16) / 255) : null;
}

const FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 u_res;
uniform float u_time;
uniform vec2 u_pointer;
uniform float u_ripple;
uniform vec3 u_deep0;
uniform vec3 u_deep1;
uniform vec3 u_glow;
uniform vec3 u_surface;
uniform vec3 u_floor;
// 终端、标题在画布里的位置（像素，原点在左下）：x、y、宽、高；宽是 0 就是没有
uniform vec4 u_glass;
uniform vec4 u_calm;

// 水面远到看不清的那条线（屏幕从下往上 0 到 1）
const float HORIZON = 0.52;
// 亮窗的中心，在屏幕上沿外面一点、偏右
const vec2 SUN = vec2(0.72, 1.12);

float hash(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

// 水面的波光：几层互相扭曲的波取脊线
float caustic(vec2 p, float t) {
  float sum = 0.0;
  float amp = 1.0;
  for (int i = 0; i < 3; i++) {
    float k = float(i);
    p += vec2(sin(p.y * 1.7 + t * 0.55 + k * 1.3), cos(p.x * 1.5 - t * 0.45 + k * 2.1)) * 0.42;
    float w = sin(p.x * 2.1 + t * 0.3) * cos(p.y * 2.3 - t * 0.26);
    sum += amp * (1.0 - abs(w));
    amp *= 0.55;
    p *= 1.65;
  }
  return clamp(sum / 1.85, 0.0, 1.0);
}

// 一个矩形里面是 1、外面是 0，边上软 soft 像素
float inRect(vec2 px, vec4 r, float soft) {
  if (r.z <= 0.0) return 0.0;
  vec2 d = max(r.xy - px, px - (r.xy + r.zw));
  return 1.0 - smoothstep(-soft, soft, max(d.x, d.y));
}

void main() {
  vec2 px = gl_FragCoord.xy;
  vec2 uv = px / u_res;
  float aspect = u_res.x / u_res.y;
  float t = u_time;
  // 终端后面：糊开、压暗；标题那一块：波光、微尘压淡
  float glass = inRect(px, u_glass, 2.0);
  float calm = inRect(px, u_calm, u_res.y * 0.1) * 0.5;
  float detail = 1.0 - glass;

  // 指针划过的涟漪：一圈往外扩、很快衰减的环
  vec2 p = (px - 0.5 * u_res) / u_res.y;
  vec2 d = p - u_pointer;
  float ring = sin(length(d) * 34.0 - t * 5.0) * exp(-length(d) * 5.5) * u_ripple;
  vec2 warp = normalize(d + 0.0001) * ring * 0.02;

  // 水体：越往下越深、越暗，最底下收到下一节的底色
  float below = clamp((HORIZON - uv.y) / HORIZON, 0.0, 1.0);
  vec3 col = mix(u_deep0, u_deep1, smoothstep(0.0, 1.0, below));
  col = mix(col, u_floor, smoothstep(0.6, 1.0, below));

  // 水面（远处那条线以上）：按透视铺开的波；亮窗里透着天光，窗外是水面反射的深水色
  vec2 rs = (uv - SUN) * vec2(aspect, 1.0);
  float window = 0.0;
  float above = uv.y - HORIZON;
  if (above > 0.0) {
    float z = 0.32 / (above + 0.04);
    vec2 plane = vec2((uv.x - 0.5) * aspect * z, z) + warp * 4.0;
    // 终端后面看到的是放大、糊开的波光（同一片水面，频率低三倍），不是一片死板的暗色
    float waveFull = caustic(plane * 4.2 + vec2(0.0, t * 0.08), t * 0.7);
    float waveSoft = caustic(plane * 1.4 + vec2(0.0, t * 0.04), t * 0.45);
    float wave = mix(waveSoft, waveFull, detail);
    float far = smoothstep(0.0, 0.2, above);
    vec2 q = (uv - SUN) * vec2(aspect * 0.78, 1.25);
    float r = length(q);
    window = 1.0 - smoothstep(0.24, 0.40, r);
    float rim = exp(-pow((r - 0.34) / 0.04, 2.0));
    // 水面从下面看是一片晃动的天花板：一格一格的亮、格子之间的脊线更亮。窗里是青的、不发白
    float ridge = smoothstep(0.6, 0.97, wave);
    vec3 outside = mix(u_deep0, u_glow, 0.16 + 0.3 * wave * wave);
    vec3 inside = mix(u_deep0, u_glow, 0.42 + 0.4 * pow(wave, 3.0));
    vec3 surf = mix(outside, inside, window);
    surf += u_glow * rim * 0.16;
    surf += u_surface * ridge * (0.1 + 0.3 * window) * mix(0.45, 1.0, detail);
    // 远处：糊进水里的雾色
    surf = mix(u_deep0 * 1.1, surf, smoothstep(0.0, 0.12, above));
    col = mix(col, surf, far);
  }

  // 光柱：从亮窗往下照，跟着水面晃
  float ang = atan(rs.x, -rs.y);
  float dist = length(rs);
  float slow = noise(vec2(ang * 7.0 + t * 0.04, t * 0.12));
  float fine = noise(vec2(ang * 21.0 - t * 0.07, t * 0.27));
  float beams = mix(slow, slow * 0.55 + fine * 0.45, detail);
  beams = pow(smoothstep(0.32, 1.0, beams), 1.5);
  float fall = exp(-dist * 0.95) * smoothstep(0.03, 0.3, dist) * smoothstep(1.25, 0.15, abs(ang));
  float rays = beams * fall;
  col += u_glow * rays * 0.22;

  // 微尘：三层远近，慢慢往上飘、左右晃，被光柱照到的地方亮
  float motes = 0.0;
  for (int i = 0; i < 3; i++) {
    float k = float(i);
    float scale = 6.0 + k * 7.0;
    vec2 g = vec2(uv.x * aspect, uv.y) * scale;
    g += vec2(sin(t * 0.06 + k * 2.0) * 0.8, -t * (0.035 + 0.02 * k));
    vec2 cell = floor(g);
    vec2 f = fract(g) - 0.5;
    float h = hash(cell + k * 17.0);
    vec2 off = (vec2(hash(cell + 3.1), hash(cell + 7.7)) - 0.5) * 0.6;
    float size = mix(0.06, 0.028, k * 0.5);
    float m = (1.0 - smoothstep(size * 0.25, size, length(f - off))) * step(0.62, h);
    float twinkle = 0.55 + 0.45 * sin(t * (0.6 + h) + h * 40.0);
    motes += m * twinkle * mix(1.0, 0.5, k * 0.5);
  }
  col += u_surface * motes * (0.05 + 1.3 * rays + 0.12 * window) * detail;

  // 指针的涟漪带一点亮
  col += u_glow * ring * 0.05;

  // 标题那一块：稍微压回一点海水蓝（字本身还有一圈暗晕，见 hero.css），水面照样看得见
  col = mix(col, mix(u_deep0, u_deep1, 0.25), calm);

  // 终端后面：压暗一大半，玻璃本身是深色的
  col = mix(col, mix(col, u_floor, 0.62), glass);

  gl_FragColor = vec4(col, 1.0);
}
`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
}

function buildProgram(gl) {
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  if (!vertex || !fragment) return null;
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  return gl.getProgramParameter(program, gl.LINK_STATUS) ? program : null;
}

// 画布的像素比页面的少：光影是软的，用不着满分辨率，省下的全是帧率。
const RESOLUTION = 0.6;

export function mountWater(canvas, { reduced = false, onDegrade } = {}) {
  let mode = 'webgl';
  let frame = 0;
  let cleanup = () => {};
  // 首屏上标 hero--glass：终端的底换成半透明（hero.css），透出后面着色器画的糊开的水。水落到静态就撤掉
  const heroOf = () => (canvas.closest ? canvas.closest('.hero') : null);
  const glassOff = () => heroOf()?.classList.remove('hero--glass');
  const handle = {
    get mode() {
      return mode;
    },
    destroy() {
      cleanup();
    },
  };

  const goStatic = (tell) => {
    if (mode === 'static') return handle;
    mode = 'static';
    canvas.dataset.mode = 'static';
    glassOff();
    cleanup();
    if (tell && onDegrade) onDegrade();
    return handle;
  };

  if (reduced) return goStatic(false);

  let gl = null;
  try {
    gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
  } catch {
    gl = null;
  }
  if (!gl) return goStatic(false);

  const program = buildProgram(gl);
  if (!program) return goStatic(true);

  // 从这里往下只在浏览器里跑。
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, 'a_pos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  const uRes = gl.getUniformLocation(program, 'u_res');
  const uTime = gl.getUniformLocation(program, 'u_time');
  const uPointer = gl.getUniformLocation(program, 'u_pointer');
  const uRipple = gl.getUniformLocation(program, 'u_ripple');

  const win = canvas.ownerDocument.defaultView;

  // 从调色板取色。
  const css = win.getComputedStyle(canvas);
  for (const [name, uniform] of Object.entries(UNIFORM_OF)) {
    gl.uniform3fv(gl.getUniformLocation(program, uniform), hexToRgb(css.getPropertyValue(name)) ?? DEFAULT_COLORS[name]);
  }
  const uGlass = gl.getUniformLocation(program, 'u_glass');
  const uCalm = gl.getUniformLocation(program, 'u_calm');

  // 终端、标题在画布里的位置。它们只在版式变了（改窗口大小、演示挂上）时才动，不用每帧量：隔 30 帧量一次。
  // 终端只在演示量好尺寸（data-ready）以后才算：之前它还没出现，后面的水不该糊。
  const hero = heroOf();
  const rectIn = (element) => {
    if (!element) return [0, 0, 0, 0];
    const c = canvas.getBoundingClientRect();
    const r = element.getBoundingClientRect();
    if (!c.width || !r.width) return [0, 0, 0, 0];
    const s = canvas.width / c.width;
    return [(r.left - c.left) * s, (c.bottom - r.bottom) * s, r.width * s, r.height * s];
  };
  // 终端（玻璃）和标题在画布里的位置：平时隔 30 帧量一次；窗口一变（拖窗口宽度、转屏、字体换上），
  // 接下来半秒每帧都量。不然终端已经挪了，它后面那块糊开、压暗的水还留在原地，看着像拖影（用户拖窗口时看到过）。
  let measureIn = 0;
  let burst = 0;
  const measure = () => {
    measureIn = burst > 0 ? 0 : 30;
    if (burst > 0) burst--;
    gl.uniform4fv(uGlass, rectIn(hero && hero.querySelector('.hero__demo[data-ready] .ph-win')));
    gl.uniform4fv(uCalm, rectIn(hero && hero.querySelector('.hero__copy')));
  };

  const pointer = { x: 0, y: 0, strength: 0 };
  let running = false;
  // 页面可能是在后台打开的：一开始就看标签页现在可不可见。
  let visible = !canvas.ownerDocument.hidden;
  let onScreen = true;
  let elapsed = 0;
  let lastTime = null;

  const resize = () => {
    const ratio = Math.min(win.devicePixelRatio || 1, 2) * RESOLUTION;
    const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
      burst = 30;
      measureIn = 0;
    }
  };
  // 终端、标题自己的大小变了（窗口变了、演示挂上、字体换上）也马上重量
  const watchLayout = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(() => {
    burst = 30;
    measureIn = 0;
  }) : null;
  if (watchLayout && hero) {
    for (const el of [hero.querySelector('.hero__demo'), hero.querySelector('.hero__copy')]) if (el) watchLayout.observe(el);
  }

  const watchdog = createFpsWatchdog({ onDegrade: () => goStatic(true) });

  const draw = (time) => {
    frame = 0;
    if (!running) return;
    if (lastTime !== null) elapsed += Math.min(time - lastTime, 100);
    lastTime = time;
    watchdog.tick();
    if (mode === 'static') return;
    resize();
    if (measureIn-- <= 0) measure();
    pointer.strength *= 0.965;
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uTime, elapsed / 1000);
    gl.uniform2f(uPointer, pointer.x, pointer.y);
    gl.uniform1f(uRipple, pointer.strength);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    frame = win.requestAnimationFrame(draw);
  };

  const sync = () => {
    const shouldRun = visible && onScreen && mode === 'webgl';
    if (shouldRun && !running) {
      running = true;
      lastTime = null;
      frame = win.requestAnimationFrame(draw);
    } else if (!shouldRun && running) {
      running = false;
      if (frame) win.cancelAnimationFrame(frame);
      frame = 0;
    }
  };

  const onPointer = (event) => {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    pointer.x = (event.clientX - rect.left - rect.width / 2) / rect.height;
    pointer.y = -(event.clientY - rect.top - rect.height / 2) / rect.height;
    pointer.strength = Math.min(1, pointer.strength + 0.25);
  };

  const onVisibility = () => {
    visible = !canvas.ownerDocument.hidden;
    sync();
  };

  const onLost = (event) => {
    event.preventDefault();
    goStatic(true);
  };

  let observer = null;
  if (win.IntersectionObserver) {
    observer = new win.IntersectionObserver((entries) => {
      onScreen = entries[entries.length - 1].isIntersecting;
      sync();
    });
    observer.observe(canvas);
  }

  canvas.addEventListener('webglcontextlost', onLost);
  canvas.ownerDocument.addEventListener('visibilitychange', onVisibility);
  win.addEventListener('pointermove', onPointer, { passive: true });

  cleanup = () => {
    running = false;
    watchdog.stop();
    if (frame) win.cancelAnimationFrame(frame);
    frame = 0;
    if (observer) observer.disconnect();
    if (watchLayout) watchLayout.disconnect();
    canvas.removeEventListener('webglcontextlost', onLost);
    canvas.ownerDocument.removeEventListener('visibilitychange', onVisibility);
    win.removeEventListener('pointermove', onPointer);
    glassOff();
    cleanup = () => {};
  };

  canvas.dataset.mode = 'webgl';
  hero?.classList.add('hero--glass');
  resize();
  sync();
  return handle;
}
