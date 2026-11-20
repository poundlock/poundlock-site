// 首屏的水面：一段手写的 WebGL 片元着色器，画水下的光影。
// 减少动效、拿不到 WebGL、丢了上下文、帧率撑不住，都落到静态：画布标 data-mode="static"，由样式显示渐变。
// 导入时不碰 window、document，Node 里能直接测。

import { createFpsWatchdog } from './motion.js';

const VERTEX = `
attribute vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

// 颜色不写在着色器里：挂上去的时候从调色板读（--scene-0、--scene-1、--scene-glow），读不到用下面的默认色。
const DEFAULT_COLORS = {
  '--scene-0': [0.067, 0.376, 0.416],
  '--scene-1': [0.031, 0.196, 0.247],
  '--scene-glow': [0.498, 0.906, 0.839],
};

// '#11606A' → [0.067, 0.376, 0.416]。不是六位十六进制色值就返回 null。
export function hexToRgb(value) {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(value ?? '').trim());
  return match ? match.slice(1).map((part) => parseInt(part, 16) / 255) : null;
}

const FRAGMENT = `
precision mediump float;
uniform vec2 u_res;
uniform float u_time;
uniform vec2 u_pointer;
uniform float u_ripple;
uniform vec3 u_deep0;
uniform vec3 u_deep1;
uniform vec3 u_glow;

#define DEEP0 u_deep0
#define DEEP1 u_deep1
#define GLOW u_glow

// 几层互相扭曲的波，取它们的脊线，就是水底那种一格一格晃动的光。
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
  return pow(clamp(sum / 1.85, 0.0, 1.0), 5.0);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;

  // 指针划过的涟漪：一圈往外扩、很快衰减的环。
  vec2 d = p - u_pointer;
  float r = length(d);
  float ring = sin(r * 34.0 - u_time * 5.0) * exp(-r * 5.5) * u_ripple;
  p += normalize(d + 0.0001) * ring * 0.03;

  // 底色：左上亮、右下暗，和图标的方向一致。
  float g = clamp((uv.x + (1.0 - uv.y)) * 0.5, 0.0, 1.0);
  vec3 col = mix(DEEP0, DEEP1, smoothstep(0.0, 0.85, g));

  // 左上角那一抹光。
  float halo = exp(-length((uv - vec2(0.18, 0.92)) * vec2(1.0, 1.25)) * 2.4);
  col += GLOW * 0.2 * halo;

  // 从左上斜着照下来的几道光，很淡，慢慢摆。
  vec2 q = uv - vec2(0.08, 1.08);
  float angle = atan(q.y, q.x);
  float rays = 0.5 + 0.5 * sin(angle * 24.0 + sin(u_time * 0.2) * 1.3 + sin(angle * 7.0 - u_time * 0.12) * 2.0);
  col += GLOW * pow(rays, 3.0) * smoothstep(1.35, 0.15, length(q)) * 0.07;

  // 水下的光影：越靠上越亮，往深处淡下去。
  float c = caustic(p * 2.4, u_time);
  float depth = smoothstep(0.0, 1.0, uv.y * 0.9 + 0.1);
  col += GLOW * c * (0.1 + 0.24 * depth);
  col += GLOW * ring * 0.06;

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
  const colors = { '--scene-0': 'u_deep0', '--scene-1': 'u_deep1', '--scene-glow': 'u_glow' };
  for (const [name, uniform] of Object.entries(colors)) {
    gl.uniform3fv(gl.getUniformLocation(program, uniform), hexToRgb(css.getPropertyValue(name)) ?? DEFAULT_COLORS[name]);
  }

  const pointer = { x: 0, y: 0, strength: 0 };
  let running = false;
  let visible = true;
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
    }
  };

  const watchdog = createFpsWatchdog({ onDegrade: () => goStatic(true) });

  const draw = (time) => {
    frame = 0;
    if (!running) return;
    if (lastTime !== null) elapsed += Math.min(time - lastTime, 100);
    lastTime = time;
    watchdog.tick();
    if (mode === 'static') return;
    resize();
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
    canvas.removeEventListener('webglcontextlost', onLost);
    canvas.ownerDocument.removeEventListener('visibilitychange', onVisibility);
    win.removeEventListener('pointermove', onPointer);
    cleanup = () => {};
  };

  canvas.dataset.mode = 'webgl';
  resize();
  sync();
  return handle;
}
