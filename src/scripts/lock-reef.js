// 过闸：一条鱼游过八段景——珊瑚礁、海草床、海藻森林、岩石峡谷、船闸闸室、水母群、清澈的河道、浅水出水。
// 景是 Blender 离线渲好的长条图（tools/reef/，清单在 assets/reef/manifest.json），分远景、中景两层，再垫一条水的底色；
// 滚动推着镜头往右走，远景慢、中景快（视差）。在网页里实时叠上去的：
//   水面投下来晃动的光斑（只落在被阳光直射的地方，辅助图的红通道）、海葵海扇海草随水摆（辅助图的绿通道）、
//   斜斜的光柱、漂浮的微粒、气泡（闸室的输水廊道口最多）、小鱼群、水母（深水那一段）、浅水的水面；
// 鱼是渲好的序列帧（停着、游着两套，一圈 24 帧），按动量在两套之间过渡，自己不定时窜一下、抬头低头。
// 滚动只管主线进度；时间一直在走（停下时胸鳍、腮、嘴照样动，光斑照样晃）；主线进度用软弹簧追滚动，停下有惯性。
// 用户的话：「滚动停下画面还能动」「停顿的时候要有个惯性」「每个场景都要大变样」「务必做的真实」。
// 画不动（帧率看门狗）、丢了上下文、清单取不到就交给 onFail。

import { createFollower } from './follow.js';
import { styleWriter } from './style-writer.js';
import { createFpsWatchdog } from './motion.js';

// 主线进度的弹簧硬度：比别的画面软（12），停下时有惯性地滑停
export const REEF_FOLLOW = 7;
// 动量：滚动一来很快就起（时间常数 0.15 秒），停了以后慢慢泄（1.2 秒）
export const MOMENTUM_RISE = 0.15;
export const MOMENTUM_FALL = 1.2;
// 页头在哪一刻换成浅色（出了水、头顶是天）
export const DAY_AT = 0.955;

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (t) => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};

// 一阶的不对称平滑：往大了走用 rise、往小了走用 fall（看绝对值）。纯函数，Node 里能测。
export function momentumStep(current, target, dt, rise = MOMENTUM_RISE, fall = MOMENTUM_FALL) {
  if (!(dt > 0)) return current;
  const tau = Math.abs(target) > Math.abs(current) ? rise : fall;
  return current + (target - current) * (1 - Math.exp(-dt / tau));
}

// 镜头中心走到哪了（米，中景的尺度）
export function cameraX(progress, m) {
  return m.xStart + clamp01(progress) * (m.xEnd - m.xStart);
}

// 第 k 段在 x 处有多少（0 到 1），和 tools/reef/journey.py 的 presence 一样：段内是 1，交界带里和相邻那段此消彼长
export function presence(k, x, m) {
  const n = m.scenes.length;
  const a = k * m.sceneLen;
  const b = (k + 1) * m.sceneLen;
  const left = k === 0 ? 1 : smooth((x - (a - m.blend)) / (2 * m.blend));
  const right = k === n - 1 ? 1 : 1 - smooth((x - (b - m.blend)) / (2 * m.blend));
  return left * right;
}

// 这一层在视口里露出哪几块（第几块到第几块，含两头）
export function visibleTiles(layer, camX, aspect, viewH) {
  const half = ((viewH / layer.scale) * aspect) / 2;
  const a = Math.floor((camX - half - layer.x0) / layer.tileM);
  const b = Math.floor((camX + half - layer.x0) / layer.tileM);
  return [Math.max(0, a), Math.min(layer.tiles - 1, b)];
}

// 出水：路线最后 1.4 米（镜头中心）里水线从画面上方扫下来，0 是水下、1 是水面以上
export function aboveAt(camX, m) {
  return smooth((camX - (m.xEnd - 1.4)) / 1.2);
}

// 每段的实时效果有多强：光柱、光斑、微粒、气泡、小鱼群、水母、摆动、水面
const EFFECTS = {
  coral: { rays: 0.55, caustic: 1.0, motes: 0.5, bubbles: 0.12, school: 0.35, jelly: 0, sway: 1.0, surface: 0 },
  seagrass: { rays: 0.6, caustic: 1.0, motes: 0.4, bubbles: 0.1, school: 0.25, jelly: 0, sway: 1.0, surface: 0 },
  kelp: { rays: 1.0, caustic: 0.6, motes: 0.6, bubbles: 0.1, school: 0.8, jelly: 0, sway: 1.0, surface: 0 },
  canyon: { rays: 0.3, caustic: 0.4, motes: 0.75, bubbles: 0.12, school: 1.0, jelly: 0, sway: 0.6, surface: 0 },
  lock: { rays: 0.2, caustic: 0.25, motes: 0.85, bubbles: 1.0, school: 0.1, jelly: 0, sway: 0.4, surface: 0 },
  jelly: { rays: 0.15, caustic: 0.0, motes: 1.0, bubbles: 0.05, school: 0, jelly: 1.0, sway: 0.4, surface: 0 },
  river: { rays: 0.8, caustic: 1.2, motes: 0.3, bubbles: 0.1, school: 0.45, jelly: 0, sway: 1.0, surface: 0.15 },
  shallow: { rays: 1.0, caustic: 1.25, motes: 0.3, bubbles: 0.2, school: 0.2, jelly: 0, sway: 1.0, surface: 1.0 },
};

export function effectsAt(x, m) {
  const out = { rays: 0, caustic: 0, motes: 0, bubbles: 0, school: 0, jelly: 0, sway: 0, surface: 0 };
  m.scenes.forEach((scene, k) => {
    const w = presence(k, x, m);
    if (!w) return;
    const e = EFFECTS[scene.key] || EFFECTS.coral;
    for (const key of Object.keys(out)) out[key] += e[key] * w;
  });
  return out;
}

function hexRgb(hex) {
  const h = String(hex).trim().replace('#', '');
  if (h.length !== 6) return [0, 0, 0];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
}

// 这里的水是什么颜色（画面下沿、上沿），按段插值
export function waterAt(x, m) {
  const low = [0, 0, 0];
  const high = [0, 0, 0];
  m.scenes.forEach((scene, k) => {
    const w = presence(k, x, m);
    if (!w) return;
    const lo = hexRgb(scene.low);
    const hi = hexRgb(scene.high);
    for (let i = 0; i < 3; i++) {
      low[i] += lo[i] * w;
      high[i] += hi[i] * w;
    }
  });
  return { low, high };
}

// 可重复的随机数（同一个种子同一串）
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// 鱼的行为：在画面右边一块地方游（左边是字）；滚动时往前游、摆尾快，停着时悬着、胸鳍划水；
// 不定时窜出去一小段、抬头低头。step(dt, …) 返回这一帧的姿态（屏幕坐标：x、y 以画面中心为 0，高为 1）。
export function createFishBehavior(seed = 7) {
  const random = rng(seed);
  const state = { x: 0.3, y: 0.02, vx: 0, vy: 0, tilt: 0, phase: 0, effort: 0 };
  let nextDart = 3 + random() * 4;
  let dartUntil = -1;
  let dart = { x: 0, y: 0 };
  let clock = 0;
  // left：鱼的中心最左到哪（按画面高算、从画面中线起），宽屏上说明那一栏在左边时由页面量出来，鱼尾不伸进字里
  return function step(dt, { momentum = 0, aspect = 1.6, above = 0, left = -0.05 } = {}) {
    clock += dt;
    const right = Math.max(left + 0.06, Math.min(0.62, 0.5 * aspect - 0.32));
    const home = { x: Math.max(0.05, right * 0.45, left + 0.05), y: 0.03 };
    if (clock > nextDart) {
      dart = { x: (random() - 0.35) * 0.32, y: (random() - 0.5) * 0.22 };
      dartUntil = clock + 1.0 + random() * 0.8;
      nextDart = clock + 5 + random() * 6;
    }
    const darting = clock < dartUntil;
    const wander = {
      x: 0.07 * Math.sin(clock * 0.21) + 0.03 * Math.sin(clock * 0.57 + 1.3),
      y: 0.05 * Math.sin(clock * 0.29 + 0.7) + 0.02 * Math.sin(clock * 0.83),
    };
    const push = Math.max(-0.12, Math.min(0.12, momentum * 2.0));
    let tx = home.x + wander.x + (darting ? dart.x : 0) + push;
    let ty = home.y + wander.y + (darting ? dart.y : 0) - above * 0.6;
    tx = Math.max(left, Math.min(right, tx));
    ty = Math.max(-0.32, Math.min(0.22, ty));
    const k = darting ? 12 : 3.0;
    const c = 2 * Math.sqrt(k) * 0.9;
    state.vx += (k * (tx - state.x) - c * state.vx) * dt;
    state.vy += (k * (ty - state.y) - c * state.vy) * dt;
    state.x += state.vx * dt;
    state.y += state.vy * dt;
    // 窜一下的弹簧会冲过头一点：左边那条线不让冲过去
    if (state.x < left - 0.01) {
      state.x = left - 0.01;
      state.vx = Math.max(0, state.vx);
    }
    const speed = Math.hypot(state.vx, state.vy);
    // 抬头低头：跟着上下的速度
    const tilt = Math.max(-0.35, Math.min(0.35, state.vy * 1.4));
    state.tilt += (tilt - state.tilt) * (1 - Math.exp(-dt * 4));
    const effort = clamp01(speed * 2.6 + Math.abs(momentum) * 9 + (darting ? 0.5 : 0));
    state.effort += (effort - state.effort) * (1 - Math.exp(-dt * 3));
    // 一圈（摆一次尾、呼吸一次）多快：停着 1.6 秒一圈，使劲游 0.45 秒一圈
    state.phase = (state.phase + dt / (1.6 - 1.15 * state.effort)) % 1;
    return { x: state.x, y: state.y, tilt: state.tilt, phase: state.phase, effort: state.effort };
  };
}

const RESOLUTION = 0.75;
// 显卡里最多留几块长条图（中景另带同样多的辅助图）：眼前两块、往前两块、往后一块。一块 2048×1800 要 15 MB 显存
const TEX_LIMIT = { mid: 5, far: 4 };
// 出水停下时水线在画面从上往下的哪里（清单里没写就用这个）
const ABOVE_TO = 0.74;

const QUAD_VS = `
attribute vec2 a_pos;
uniform vec4 u_rect;
uniform vec4 u_uv;
uniform float u_rot;
uniform vec2 u_half;
varying vec2 v_uv;
varying vec2 v_screen;
void main() {
  vec2 p = mix(u_rect.xy, u_rect.zw, a_pos);
  // 绕方块中心转 u_rot（在像素空间里转，免得被画布的宽高比拉歪）
  vec2 c = (u_rect.xy + u_rect.zw) * 0.5;
  vec2 d = (p - c) * u_half;
  float cr = cos(u_rot);
  float sr = sin(u_rot);
  p = c + vec2(d.x * cr - d.y * sr, d.x * sr + d.y * cr) / u_half;
  v_uv = mix(u_uv.xy, u_uv.zw, a_pos);
  v_screen = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}
`;

// 各层的着色：u_mode 0 底色和远景（原样），1 中景（摆动 + 光斑），2 鱼（蒙一层水色）
const QUAD_FS = `
precision mediump float;
varying vec2 v_uv;
varying vec2 v_screen;
uniform sampler2D u_tex;
uniform sampler2D u_aux;
uniform sampler2D u_tex2;
uniform float u_mode;
uniform float u_time;
uniform vec2 u_world;
uniform float u_viewH;
uniform float u_sway;
uniform float u_caustic;
uniform vec3 u_water;
uniform float u_mix;
uniform float u_alpha;
uniform float u_wl;
uniform float u_aspect;

// 出水的水线：几道长短不一的波叠起来慢慢走（x 按画面的高归一）。水面以上那一层和水线下的光用同一条，两边才对得上
float waterWave(float x, float t) {
  return 0.0045 * sin(x * 19.0 + t * 1.5) + 0.0025 * sin(x * 47.0 - t * 2.2) + 0.0012 * sin(x * 113.0 + t * 3.3);
}

vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}

// 光斑：两层慢慢动的泰森格，格与格的边上亮（水面起伏把光聚成的网）
float cells(vec2 p, float t) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float d1 = 8.0;
  float d2 = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = hash2(i + g);
      o = 0.5 + 0.42 * sin(t + 6.2831 * o);
      float d = length(g + o - f);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
    }
  }
  return d2 - d1;
}

float caustic(vec2 p, float t) {
  // 两张网叠起来：交叉的地方最亮，像真的光斑（一根根亮线会像划痕）
  float a = cells(p * 3.0, t * 0.8);
  float b = cells(p * 3.9 + vec2(3.1, 1.7), -t * 0.6 + 1.3);
  float na = 1.0 - smoothstep(0.0, 0.34, a);
  float nb = 1.0 - smoothstep(0.0, 0.34, b);
  float c = na * (0.35 + 0.65 * nb);
  return c * c;
}

void main() {
  if (u_mode < 0.5) {
    vec4 c = texture2D(u_tex, v_uv);
    gl_FragColor = c * u_alpha;
    return;
  }
  if (u_mode < 1.5) {
    vec4 aux = texture2D(u_aux, v_uv);
    float wx = u_world.x + v_uv.x * u_world.y;
    float sy = (1.0 - v_uv.y) * u_viewH;
    float wave = sin(u_time * 1.1 + wx * 2.3 + sy * 1.7) * 0.65 + sin(u_time * 0.63 + wx * 0.9 + 1.7) * 0.35;
    float edge = smoothstep(0.0, 0.035, v_uv.x) * smoothstep(1.0, 0.965, v_uv.x);
    float off = aux.g * u_sway * 0.022 * wave * edge;
    vec2 uv = v_uv + vec2(off / u_world.y, 0.0);
    vec4 c = texture2D(u_tex, uv);
    float lit = texture2D(u_aux, uv).r;
    float ca = caustic(vec2(wx, sy * 1.5), u_time);
    c.rgb += c.a * lit * ca * u_caustic * vec3(0.4, 0.44, 0.38);
    gl_FragColor = c * u_alpha;
    return;
  }
  if (u_mode > 2.5) {
    // 水面以上那一层：只露水线以上（水线跟着波起伏，边上软一个多像素）；贴着水线那一窄条跟着波纹上下晃一点，像隔着水面的弯月面
    float top = 1.0 - v_screen.y;
    float x = v_screen.x * u_aspect;
    float d = u_wl + waterWave(x, u_time) - top;
    float near = smoothstep(0.035, 0.0, d);
    vec2 uv = v_uv + vec2(0.0, near * 0.004 * sin(x * 61.0 + u_time * 2.4));
    vec4 c = texture2D(u_tex, uv);
    gl_FragColor = c * smoothstep(-0.0012, 0.0012, d);
    return;
  }
  // 鱼：两套序列帧按 u_mix 过渡（停着 → 游着），整条蒙一层这里的水色
  vec4 a = texture2D(u_tex, v_uv);
  vec4 b = texture2D(u_tex2, v_uv);
  vec4 c = mix(a, b, u_mix);
  c.rgb = mix(c.rgb, u_water * c.a, 0.16);
  gl_FragColor = c * u_alpha;
}
`;

// 叠在上面的：光柱（全屏，叠加）、微粒、气泡、小鱼群、水母（每个是一个小方块，在片元里画出形状）
const FX_VS = `
attribute vec2 a_pos;
attribute vec2 a_uv;
attribute vec4 a_info;
varying vec2 v_uv;
varying vec4 v_info;
void main() {
  v_uv = a_uv;
  v_info = a_info;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FX_FS = `
precision mediump float;
varying vec2 v_uv;
varying vec4 v_info;
uniform float u_time;
uniform vec3 u_light;
uniform vec3 u_deep;
uniform vec2 u_res;

float hash(float n) { return fract(sin(n) * 43758.5453); }
// 出水的水线：几道长短不一的波叠起来慢慢走（x 按画面的高归一）。水面以上那一层和水线下的光用同一条，两边才对得上
float waterWave(float x, float t) {
  return 0.0045 * sin(x * 19.0 + t * 1.5) + 0.0025 * sin(x * 47.0 - t * 2.2) + 0.0012 * sin(x * 113.0 + t * 3.3);
}


void main() {
  float kind = v_info.x;
  float phase = v_info.y;
  float alpha = v_info.z;
  vec2 p = v_uv * 2.0 - 1.0;
  if (kind < 0.5) {
    // 光柱：从画面上方斜着照下来，几道宽窄不一，慢慢晃，越往下越淡
    vec2 s = v_uv;
    float x = s.x * u_res.x / u_res.y + (1.0 - s.y) * 0.32;
    float beams = 0.0;
    for (int i = 0; i < 5; i++) {
      float fi = float(i);
      float w = 0.05 + 0.06 * hash(fi * 3.7);
      float c = fract(hash(fi * 7.1) * 3.0 + 0.04 * sin(u_time * (0.07 + 0.03 * fi) + fi)) * 2.4 - 0.2 + phase;
      float d = abs(fract((x - c) / 2.4 + 0.5) - 0.5) * 2.4;
      beams += smoothstep(w, 0.0, d) * (0.5 + 0.5 * sin(u_time * (0.21 + 0.05 * fi) + fi * 2.0));
    }
    float fade = smoothstep(0.0, 0.85, s.y);
    gl_FragColor = vec4(u_light * beams * fade * alpha * 0.09, 0.0);
    return;
  }
  if (kind < 1.5) {
    // 微粒：一个软的小亮点
    float d = length(p);
    float m = smoothstep(1.0, 0.0, d);
    gl_FragColor = vec4(u_light * m * m * alpha, m * m * alpha * 0.5);
    return;
  }
  if (kind < 2.5) {
    // 气泡：透明的圆，边上一圈亮，左上一点高光
    float d = length(p);
    float ring = smoothstep(1.0, 0.82, d) * smoothstep(0.55, 0.95, d);
    float spec = smoothstep(0.32, 0.0, length(p - vec2(-0.35, 0.38)));
    float m = (ring * 0.8 + spec) * step(d, 1.0);
    gl_FragColor = vec4(u_light * m * alpha, m * alpha * 0.6);
    return;
  }
  if (kind < 3.5) {
    // 小鱼：银色的纺锤形身子加一个叉尾，背深腹亮，身子随摆尾弯一点
    float bend = sin(phase * 6.2831) * 0.18;
    vec2 q = vec2(p.x, p.y - bend * (p.x + 0.4) * (p.x + 0.4) * 0.6);
    float body = length(vec2((q.x - 0.1) / 0.62, q.y / 0.26));
    float tailx = q.x + 0.72;
    float tail = step(-0.98, q.x) * step(q.x, -0.5) * step(abs(q.y), 0.08 + (0.5 - tailx) * 0.0 + abs(tailx + 0.3) * 0.0 + (-0.5 - q.x) * 0.55);
    float shape = max(smoothstep(1.0, 0.86, body), tail * 0.9);
    vec3 col = mix(u_deep * 0.55, u_light, smoothstep(0.15, -0.25, q.y));
    col += u_light * smoothstep(0.08, 0.0, abs(q.y + 0.02)) * 0.25;
    gl_FragColor = vec4(col * shape * alpha, shape * alpha);
    return;
  }
  if (kind > 4.5) {
    // 水面。phase 是这里有多少水面（浅水那一段），alpha 是出没出水（1 出水了），v_info.w 是水线离画面顶多远。
    vec2 s = v_uv;
    float top = 1.0 - s.y;
    float x = s.x * u_res.x / u_res.y;
    float line = v_info.w + waterWave(x, u_time) * alpha;
    float below = top - line;
    float rip = sin(x * 38.0 + u_time * 1.6 + sin(x * 9.0 - u_time) * 2.0) * 0.5 + 0.5;
    float rip2 = sin(x * 91.0 - u_time * 2.3 + top * 40.0) * 0.5 + 0.5;
    // 出水以前：画面顶上一窄条从下往上看到的水面底面，晃着碎光
    float band = phase * (1.0 - alpha) * smoothstep(0.06, 0.0, top) * (0.25 + 0.6 * rip * rip2);
    // 出水以后：水线下面紧贴着一窄条水面底面的碎光（全反射），再往下立刻压暗（水面下本来就比水上暗；
    // 原来压暗是从水线往下慢慢加深，头上六十来像素没压住，成了一条亮青色的带子，看着假）
    float tir = alpha * smoothstep(0.0, 0.002, below) * smoothstep(0.022, 0.0, below) * (0.3 + 0.7 * rip * rip2);
    float edge = alpha * exp(-pow(below / 0.0016, 2.0));
    float m = band * 0.22 + tir * 0.16 + edge * 0.22;
    float shade = alpha * (0.34 + 0.24 * smoothstep(0.0, 0.6, below)) * smoothstep(0.0, 0.003, below);
    gl_FragColor = vec4(u_light * m + u_deep * shade, shade);
    return;
  }
  // 水母：半透明的伞（边上亮、中间透），一张一缩；伞下垂着几条细触手
  float pulse = 0.5 + 0.5 * sin(phase * 6.2831);
  vec2 q = vec2(p.x / (0.78 + 0.12 * pulse), (p.y - 0.25) / (0.55 - 0.1 * pulse));
  float dome = step(0.0, q.y) * smoothstep(1.0, 0.9, length(q));
  float rim = dome * smoothstep(0.55, 1.0, length(q));
  float skirt = step(q.y, 0.05) * step(-0.12, q.y) * smoothstep(1.0, 0.85, abs(q.x));
  float tent = 0.0;
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float tx = -0.6 + fi * 0.24 + 0.06 * sin(p.y * 6.0 + u_time * 1.3 + fi);
    tent += smoothstep(0.03, 0.0, abs(p.x - tx)) * step(p.y, 0.2) * smoothstep(-1.0, 0.1, p.y);
  }
  float m = dome * 0.22 + rim * 0.55 + skirt * 0.35 + tent * 0.28;
  vec3 col = mix(u_light, vec3(0.75, 0.82, 1.0), 0.4);
  gl_FragColor = vec4(col * m * alpha, m * alpha * 0.8);
}
`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  console.warn('[poundlock] 过闸的着色器编译不过', gl.getShaderInfoLog && gl.getShaderInfoLog(shader));
  return null;
}

function program(gl, vs, fs) {
  const v = compile(gl, gl.VERTEX_SHADER, vs);
  const f = compile(gl, gl.FRAGMENT_SHADER, fs);
  if (!v || !f) return null;
  const p = gl.createProgram();
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  return gl.getProgramParameter(p, gl.LINK_STATUS) ? p : null;
}

function uniforms(gl, prog, names) {
  const out = {};
  for (const name of names) out[name] = gl.getUniformLocation(prog, name);
  return out;
}

// 读画布上带着的清单（生成页面时写进去的）
export function readReef(canvas) {
  if (!canvas || !canvas.dataset.reef) return null;
  try {
    const m = JSON.parse(canvas.dataset.reef);
    return m && m.layers && m.layers.mid && m.scenes && m.scenes.length ? m : null;
  } catch {
    return null;
  }
}

// 返回 { kind: 'reef', frame(progress, now, snap), fill(), destroy() }；拿不到 WebGL、着色器编译不过、没有清单返回 null。
export function mountReef(root, canvas, { onFail } = {}) {
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  const m = readReef(canvas);
  if (!m) return null;
  let gl = null;
  try {
    gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: true });
  } catch {
    gl = null;
  }
  if (!gl) return null;
  const quadProg = program(gl, QUAD_VS, QUAD_FS);
  const fxProg = program(gl, FX_VS, FX_FS);
  if (!quadProg || !fxProg) return null;

  const base = m.base || '';
  const uq = uniforms(gl, quadProg, ['u_wl', 'u_aspect', 'u_rot', 'u_half', 'u_rect', 'u_uv', 'u_tex', 'u_aux', 'u_tex2', 'u_mode', 'u_time', 'u_world', 'u_viewH', 'u_sway', 'u_caustic', 'u_water', 'u_mix', 'u_alpha']);
  const uf = uniforms(gl, fxProg, ['u_time', 'u_light', 'u_deep', 'u_res']);
  const aQuad = gl.getAttribLocation(quadProg, 'a_pos');
  const fxA = { pos: gl.getAttribLocation(fxProg, 'a_pos'), uv: gl.getAttribLocation(fxProg, 'a_uv'), info: gl.getAttribLocation(fxProg, 'a_info') };
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);
  const fxBuffer = gl.createBuffer();
  const MAX_FX = 420;
  const fxData = new Float32Array(MAX_FX * 6 * 8);

  // —— 贴图：按需下、一帧最多传一张进显卡、超过上限就丢掉最久没用的 ——
  const textures = new Map();
  const loading = new Set();
  const ready = [];
  let dead = false;
  // 长条图一块都下不来（断网、被拦、文件缺）：失败了几次、或者在视口里干等了十五秒还没有一块中景，就交给 onFail 退回平面图
  let failures = 0;
  let firstShown = false;
  let waited = 0;
  let urgent = 0;
  const blank = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, blank);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));

  // 下完、等着传进显卡的（还不在 textures 里）：也算已经要过了，不然每帧都会再要一遍，队伍越排越长
  const queued = new Set();
  // 一张 2048×1800 的图整张传进显卡要十几毫秒：滚动中途传就是一下卡顿（用户说「有的时候滚轮一卡一卡的」）。
  // 所以在后台线程解码、切成 512 宽的竖条，一帧只传一条。
  const PIECE = 512;
  const bitmaps = typeof win.createImageBitmap === 'function' && typeof win.fetch === 'function';
  const closeItem = (item) => {
    for (const piece of item.pieces || []) if (piece.close) piece.close();
  };
  const request = (key, url) => {
    if (textures.has(key) || loading.has(key) || queued.has(key) || dead) return;
    loading.add(key);
    const done = (item) => {
      loading.delete(key);
      if (dead) {
        closeItem(item);
        return;
      }
      queued.add(key);
      ready.push(item);
    };
    const failed = () => {
      loading.delete(key);
      failures++;
    };
    if (bitmaps) {
      win
        .fetch(url)
        .then((res) => (res.ok ? res.blob() : Promise.reject(new Error(String(res.status)))))
        .then((blob) => win.createImageBitmap(blob, { premultiplyAlpha: 'premultiply' }))
        .then((whole) => {
          const w = whole.width;
          const h = whole.height;
          const cuts = [];
          for (let x = 0; x < w; x += PIECE) cuts.push(win.createImageBitmap(whole, x, 0, Math.min(PIECE, w - x), h, { premultiplyAlpha: 'premultiply' }));
          return Promise.all(cuts).then((pieces) => {
            whole.close();
            return { key, w, h, pieces };
          });
        })
        .then(done, failed);
      return;
    }
    const img = new win.Image();
    img.decoding = 'async';
    img.src = url;
    const ok = () => done({ key, img, w: img.naturalWidth, h: img.naturalHeight });
    if (img.decode) img.decode().then(ok, failed);
    else {
      img.onload = ok;
      img.onerror = failed;
    }
  };
  const newTexture = () => {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  };
  let job = null;
  const upload = () => {
    if (!job) {
      // 先传眼前要用的（want 里标了的），别的往后排
      let at = ready.findIndex((r) => needed.has(r.key));
      if (at < 0) at = 0;
      const item = ready.splice(at, 1)[0];
      if (!item) return;
      queued.delete(item.key);
      if (textures.has(item.key)) {
        closeItem(item);
        return;
      }
      const tex = newTexture();
      if (!item.pieces) {
        // <img>：整张传，要 WebGL 帮着预乘透明度
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, item.img);
        textures.set(item.key, { tex, used: win.performance.now(), w: item.w, h: item.h });
        return;
      }
      // 竖条：先在显卡里占好整张的地方，之后一帧填一条；填满了才算有这张图
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, item.w, item.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      job = { ...item, tex, next: 0 };
    }
    gl.bindTexture(gl.TEXTURE_2D, job.tex);
    const piece = job.pieces[job.next];
    gl.texSubImage2D(gl.TEXTURE_2D, 0, job.next * PIECE, 0, gl.RGBA, gl.UNSIGNED_BYTE, piece);
    if (piece.close) piece.close();
    job.next++;
    if (job.next >= job.pieces.length) {
      textures.set(job.key, { tex: job.tex, used: win.performance.now(), w: job.w, h: job.h });
      job = null;
    }
  };
  const evict = (prefix, keep, limit) => {
    // 排着队等传、但已经不在要留的范围里的，从队里拿掉（滚得快时这一路上经过的块不用都传一遍）
    for (let i = ready.length - 1; i >= 0; i--) {
      if (ready[i].key.startsWith(prefix) && !keep.has(ready[i].key)) {
        queued.delete(ready[i].key);
        closeItem(ready.splice(i, 1)[0]);
      }
    }
    const own = [...textures.entries()].filter(([k]) => k.startsWith(prefix) && !keep.has(k));
    const count = [...textures.keys()].filter((k) => k.startsWith(prefix)).length;
    own.sort((a, b) => a[1].used - b[1].used);
    for (let i = 0; i < count - limit && i < own.length; i++) {
      gl.deleteTexture(own[i][1].tex);
      textures.delete(own[i][0]);
    }
  };
  const tex = (key) => {
    const t = textures.get(key);
    if (!t) return null;
    t.used = win.performance.now();
    return t;
  };

  const tileKey = (layer, i, aux = false) => `${layer}:${String(i).padStart(2, '0')}${aux ? '-aux' : ''}`;
  const tileUrl = (layer, i, aux = false) => `${base}${layer}/${String(i).padStart(2, '0')}${aux ? '-aux' : ''}.webp`;
  request('back', `${base}back.webp`);
  request('fish:idle', `${base}fish/idle.webp`);
  request('fish:swim', `${base}fish/swim.webp`);
  if (m.jelly) request('jelly', `${base}jelly.webp`);
  const jellies = [];
  const fishGrid = m.fish || { cols: 6, rows: 4, frames: 24, len: 0.3 };

  let filling = false;
  const needed = new Set();
  const want = (camX, aspect, dir) => {
    needed.clear();
    const keep = { mid: new Set(), far: new Set() };
    for (const name of ['far', 'mid']) {
      const layer = m.layers[name];
      const [a, b] = visibleTiles(layer, camX, aspect, m.viewH);
      const ahead = dir >= 0 ? [b + 1, b + 2, a - 1] : [a - 1, a - 2, b + 1];
      for (const i of [...Array(b - a + 1).keys()].map((n) => a + n).concat(filling ? ahead : [])) {
        if (i < 0 || i >= layer.tiles) continue;
        if (i >= a && i <= b) {
          needed.add(tileKey(name, i));
          needed.add(tileKey(name, i, true));
        }
        keep[name].add(tileKey(name, i));
        request(tileKey(name, i), tileUrl(name, i));
        if (layer.aux) {
          keep[name].add(tileKey(name, i, true));
          request(tileKey(name, i, true), tileUrl(name, i, true));
        }
      }
      evict(`${name}:`, keep[name], TEX_LIMIT[name] * (layer.aux ? 2 : 1));
    }
    const above = m.layers.above;
    if (above && (aboveAt(camX + 1.2, m) > 0 || filling)) {
      const [a, b] = visibleTiles(above, camX, aspect, m.viewH);
      for (let i = a; i <= b; i++) {
        needed.add(tileKey('above', i));
        request(tileKey('above', i), tileUrl('above', i));
      }
    }
  };

  const headerVars = styleWriter(doc.querySelector('[data-header]'));
  const follower = createFollower(REEF_FOLLOW);
  const behave = createFishBehavior(11);
  let last = null;
  let shown = 0;
  let momentum = 0;
  let flowX = 0;
  let lastCam = null;

  const fail = () => {
    if (dead) return;
    dead = true;
    if (onFail) onFail();
  };
  // 帧率看门狗放宽一点：长条图一块块传进显卡时会掉几帧，别因为这个就退回平面图
  const watchdog = createFpsWatchdog({ onDegrade: fail, minFps: 28 });
  const onLost = (event) => {
    event.preventDefault();
    fail();
  };
  canvas.addEventListener('webglcontextlost', onLost);

  // 鱼最左到哪：说明那一栏排在画面左边（宽屏版式）时，鱼尾要留在它右边。用户截图里鱼游过去压在了说明的字上。
  // 窄屏上字排在上面、横跨整个画面，不限。
  const copyEl = root.querySelector('.lock__water .lock__copy');
  let fishLeft = -0.05;
  let measuredAt = -1e9;
  const measureCopy = (now) => {
    measuredAt = now;
    fishLeft = -0.05;
    if (!copyEl) return;
    const c = canvas.getBoundingClientRect();
    const r = copyEl.getBoundingClientRect();
    if (!c.width || !c.height || !r.width || r.right - c.left > c.width * 0.55) return;
    const half = ((fishGrid.len / m.viewH) * c.height) / 2;
    fishLeft = Math.max(-0.05, (r.right - c.left + half * 0.85 + 16 - c.width / 2) / c.height);
  };
  const layout = (now) => {
    const ratio = Math.min(win.devicePixelRatio || 1, 2) * RESOLUTION;
    const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      measureCopy(now);
    } else if (now - measuredAt > 1000) measureCopy(now);
    gl.viewport(0, 0, canvas.width, canvas.height);
  };

  // 画一张贴图到屏幕上的一块（像素坐标，y 朝下）
  const drawQuad = (rect, uv, mode) => {
    const W = canvas.width;
    const H = canvas.height;
    gl.uniform4f(uq.u_rect, (rect[0] / W) * 2 - 1, 1 - (rect[3] / H) * 2, (rect[2] / W) * 2 - 1, 1 - (rect[1] / H) * 2);
    gl.uniform4f(uq.u_uv, uv[0], uv[3], uv[2], uv[1]);
    gl.uniform1f(uq.u_mode, mode);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  };

  // 微粒、气泡、小鱼群、水母的位置：按格子和时间算出来（同样的时间同样的位置），镜头走它们跟着视差走
  const fx = { n: 0 };
  const pushFx = (cx, cy, w, h, kind, phase, alpha, angle = 0, extra = 0) => {
    if (fx.n >= MAX_FX) return;
    const W = canvas.width;
    const H = canvas.height;
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    const corners = [
      [-1, -1, 0, 1],
      [1, -1, 1, 1],
      [-1, 1, 0, 0],
      [-1, 1, 0, 0],
      [1, -1, 1, 1],
      [1, 1, 1, 0],
    ];
    let o = fx.n * 48;
    for (const [sx, sy, u, v] of corners) {
      const dx = (sx * w) / 2;
      const dy = (sy * h) / 2;
      const px = cx + dx * ca - dy * sa;
      const py = cy + dx * sa + dy * ca;
      fxData[o++] = (px / W) * 2 - 1;
      fxData[o++] = 1 - (py / H) * 2;
      fxData[o++] = u;
      fxData[o++] = v;
      fxData[o++] = kind;
      fxData[o++] = phase;
      fxData[o++] = alpha;
      fxData[o++] = extra;
    }
    fx.n++;
  };

  const buildFx = (camX, time, eff, pxPerM, fishPose, dy, waterline = 0) => {
    const W = canvas.width;
    const H = canvas.height;
    fx.n = 0;
    const put = (cx, cy, ...rest) => pushFx(cx, cy + dy, ...rest);
    // 光柱：一个全屏的方块
    if (eff.rays > 0.01) pushFx(W / 2, H / 2, W, H, 0, (camX * 0.05) % 2.4, eff.rays);
    // 微粒：三层远近，越近越大越快
    const layers = [
      [0.35, 2.2, 90],
      [0.6, 3.2, 60],
      [1.0, 4.6, 40],
    ];
    layers.forEach(([depth, size, count], li) => {
      const cell = 0.5 / depth;
      const span = (W / (pxPerM * depth)) + cell * 2;
      const start = Math.floor((camX - span / 2) / cell);
      const n = Math.min(count, Math.ceil(span / cell) * 3);
      for (let i = 0; i < n; i++) {
        const ci = start + Math.floor(i / 3);
        const r = rng(ci * 7 + li * 1013 + (i % 3) * 31);
        const wx = (ci + r()) * cell;
        const yy = (r() + time * (0.004 + 0.006 * r()) * (r() < 0.5 ? 1 : -1)) % 1;
        const sx = W / 2 + (wx - camX) * pxPerM * depth + Math.sin(time * (0.2 + r() * 0.3) + i) * 6;
        const sy = (yy < 0 ? yy + 1 : yy) * H;
        if (sx < -10 || sx > W + 10) continue;
        const a = eff.motes * (0.25 + 0.5 * r()) * (0.6 + 0.4 * Math.sin(time * (0.5 + r()) + i));
        put(sx, sy, size * (H / 900), size * (H / 900), 1, 0, a * 0.6);
      }
    });
    // 气泡：从地面附近的几个口子冒上来（闸室最多），一路摇摆、越往上越大
    if (eff.bubbles > 0.02) {
      const vents = 6;
      for (let v = 0; v < vents; v++) {
        const r = rng(Math.floor(camX / 1.3) * 17 + v);
        const wx = (Math.floor(camX / 1.3) + (v - 2) * 0.55 + r() * 0.4) * 1.3;
        const strength = eff.bubbles * (r() < eff.bubbles ? 1 : 0.2);
        const per = Math.round(4 + 10 * strength);
        for (let b = 0; b < per; b++) {
          const rr = rng(v * 131 + b * 7 + Math.floor(wx * 10));
          const life = (time * (0.18 + 0.12 * rr()) + rr()) % 1;
          const sx = W / 2 + (wx - camX) * pxPerM + Math.sin(life * 12 + b) * 8 * life;
          const sy = H * (0.92 - life * 1.0);
          const size = (4 + 9 * life * rr()) * (H / 900);
          if (sx < -20 || sx > W + 20) continue;
          put(sx, sy, size, size, 2, 0, strength * (1 - life * 0.6));
        }
      }
    }
    // 小鱼群：一群银色的小鱼在背景里绕着转（峡谷那一段是一大团），慢慢往一边游
    if (eff.school > 0.02) {
      const count = Math.round(18 + 120 * eff.school * eff.school);
      const cx = W * 0.62 + Math.sin(time * 0.11) * W * 0.12;
      const cy = H * 0.32 + Math.sin(time * 0.17) * H * 0.06;
      const radius = H * (0.08 + 0.12 * eff.school);
      // 鱼游过时鱼团让开：离鱼近的往外推
      const fx0 = W / 2 + fishPose.x * H;
      const fy0 = H / 2 - fishPose.y * H + dy;
      for (let i = 0; i < count; i++) {
        const r = rng(i * 97 + 5);
        const orbit = time * (0.25 + 0.2 * r()) * (r() < 0.85 ? 1 : -1) + r() * 6.283;
        const rad = radius * (0.35 + 0.65 * Math.sqrt(r()));
        let x = cx + Math.cos(orbit) * rad * 1.6;
        let y = cy + Math.sin(orbit) * rad * 0.55 + (r() - 0.5) * radius * 0.5;
        const dx = x - fx0;
        const dy = y - fy0;
        const d = Math.hypot(dx, dy);
        const avoid = Math.max(0, 1 - d / (H * 0.18));
        x += (dx / (d || 1)) * avoid * H * 0.12;
        y += (dy / (d || 1)) * avoid * H * 0.12;
        const dir = Math.sin(orbit) > 0 ? -1 : 1;
        const size = H * (0.016 + 0.012 * r());
        const depthFade = 0.35 + 0.65 * r();
        put(x, y, size * 2.4, size, 3, (time * 3 + r()) % 1, eff.school * depthFade * 0.85, dir < 0 ? Math.PI : 0);
      }
    }
    // 水面（浅水那一段画面顶上的银色波纹）和出水时的水线：waterline 是水线离画面顶的比例
    const surface = Math.max(eff.surface, waterline > 0 ? 1 : 0);
    if (surface > 0.01) pushFx(W / 2, H / 2, W, H, 5, surface, waterline > 0 ? 1 : 0, 0, waterline / H);
    // 水母：几只在不同远近慢慢往上漂，一张一缩（有渲好的序列帧就用它，没有就在着色器里画个简单的）
    jellies.length = 0;
    if (eff.jelly > 0.02) {
      for (let i = 0; i < 18; i++) {
        const r = rng(i * 53 + 11);
        const depth = 0.25 + 0.75 * r() * r();
        const wx = Math.floor(camX / 6) * 6 + (i - 6) * 0.75 + r() * 0.6;
        const sx = W / 2 + (wx - camX) * pxPerM * depth + Math.sin(time * 0.1 + i) * 30;
        const sy = H * (1.1 - ((time * 0.012 * (0.5 + r()) + r()) % 1.25));
        const size = H * (0.045 + 0.11 * depth);
        if (sx < -size || sx > W + size) continue;
        const phase = (time * (0.35 + 0.15 * r()) + r()) % 1;
        const alpha = eff.jelly * (0.35 + 0.55 * depth);
        if (m.jelly && tex('jelly')) jellies.push({ x: sx, y: sy + dy, w: size * 1.1, h: size * 1.65, phase, alpha, depth });
        else put(sx, sy, size, size * 1.6, 4, phase, alpha);
      }
    }
  };

  const draw = (camX, time, dt, aspect, dy) => {
    const W = canvas.width;
    const H = canvas.height;
    const pxPerM = H / m.viewH;
    const eff = effectsAt(camX, m);
    const water = waterAt(camX, m);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(water.low[0], water.low[1], water.low[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(quadProg);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(aQuad);
    gl.vertexAttribPointer(aQuad, 2, gl.FLOAT, false, 0, 0);
    gl.uniform1i(uq.u_tex, 0);
    gl.uniform1i(uq.u_aux, 1);
    gl.uniform1i(uq.u_tex2, 2);
    gl.uniform1f(uq.u_time, time);
    gl.uniform1f(uq.u_viewH, m.viewH);
    gl.uniform1f(uq.u_alpha, 1);
    gl.uniform1f(uq.u_rot, 0);
    gl.uniform2f(uq.u_half, W / 2, H / 2);

    // 水的底色
    const back = tex('back');
    if (back) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, back.tex);
      const x0 = W / 2 + (m.back.x0 - camX) * pxPerM;
      const x1 = W / 2 + (m.back.x1 - camX) * pxPerM;
      drawQuad([x0, dy, x1, H + dy], [0, 0, 1, 1], 0);
    }
    // 远景、中景
    for (const name of ['far', 'mid']) {
      const layer = m.layers[name];
      const scale = pxPerM * layer.scale;
      const [a, b] = visibleTiles(layer, camX, aspect, m.viewH);
      gl.uniform1f(uq.u_sway, eff.sway);
      gl.uniform1f(uq.u_caustic, eff.caustic * (name === 'mid' ? 1 : 0));
      for (let i = a; i <= b; i++) {
        const t = tex(tileKey(name, i));
        if (!t) continue;
        const wx0 = layer.x0 + i * layer.tileM;
        const x0 = W / 2 + (wx0 - camX) * scale;
        const x1 = x0 + layer.tileM * scale;
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, t.tex);
        const aux = layer.aux ? tex(tileKey(name, i, true)) : null;
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, aux ? aux.tex : blank);
        gl.uniform2f(uq.u_world, wx0, layer.tileM);
        // 相邻两块之间多盖半个像素，免得接缝漏底
        drawQuad([Math.floor(x0) - 0.5, dy, Math.ceil(x1) + 0.5, H + dy], [0, 0, 1, 1], aux ? 1 : 0);
      }
    }
    return { eff, water, pxPerM };
  };

  // 水面以上：水线以上的部分（剪裁），从上面滑下来停到位
  const drawAbove = (camX, dy, above) => {
    const layer = m.layers.above;
    if (!layer || dy < 1) return;
    const W = canvas.width;
    const H = canvas.height;
    const scale = (H / m.viewH) * layer.scale;
    const slide = -(1 - above) * H * 0.3;
    gl.useProgram(quadProg);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(aQuad);
    gl.vertexAttribPointer(aQuad, 2, gl.FLOAT, false, 0, 0);
    gl.uniform1f(uq.u_wl, dy / H);
    gl.uniform1f(uq.u_aspect, W / H);
    const [a, b] = visibleTiles(layer, camX, W / H, m.viewH);
    for (let i = a; i <= b; i++) {
      const t = tex(tileKey('above', i));
      if (!t) continue;
      const x0 = W / 2 + (layer.x0 + i * layer.tileM - camX) * scale;
      const x1 = x0 + layer.tileM * scale;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      drawQuad([Math.floor(x0) - 0.5, slide, Math.ceil(x1) + 0.5, H + slide], [0, 0, 1, 1], 3);
    }
  };

  const drawFish = (pose, water, above, dy) => {
    const idle = tex('fish:idle');
    const swim = tex('fish:swim');
    if (!idle || !swim) return;
    const W = canvas.width;
    const H = canvas.height;
    const frames = fishGrid.frames;
    const f = Math.floor(pose.phase * frames) % frames;
    const col = f % fishGrid.cols;
    const row = Math.floor(f / fishGrid.cols);
    const u0 = col / fishGrid.cols;
    const v0 = row / fishGrid.rows;
    const u1 = u0 + 1 / fishGrid.cols;
    const v1 = v0 + 1 / fishGrid.rows;
    // 一帧的宽是鱼身长的多少倍（渲鱼时的取景）；鱼身长占画面高的比例由清单给
    const frameW = (fishGrid.len / m.viewH) * H * (fishGrid.frameOverLen || 1.45);
    const frameH = frameW * (fishGrid.frameH || 320) / (fishGrid.frameW || 640);
    const cx = W / 2 + pose.x * H;
    // 出水时鱼留在水里：水线以下那一截里（水线停在画面七成四的地方）
    const cy = H / 2 - pose.y * H + dy + above * H * 0.15;
    gl.useProgram(quadProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, idle.tex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, swim.tex);
    gl.uniform3fv(uq.u_water, water.high.map((v, i) => v * 0.6 + water.low[i] * 0.4));
    gl.uniform1f(uq.u_mix, smooth((pose.effort - 0.15) / 0.6));
    // 抬头低头：整张图绕鱼的中心转一点（往上游时头抬起来）
    const hw = frameW / 2;
    const hh = frameH / 2;
    gl.uniform4f(uq.u_uv, u0, v1, u1, v0);
    const rect = [cx - hw, cy - hh, cx + hw, cy + hh];
    gl.uniform4f(uq.u_rect, (rect[0] / W) * 2 - 1, 1 - (rect[3] / H) * 2, (rect[2] / W) * 2 - 1, 1 - (rect[1] / H) * 2);
    gl.uniform1f(uq.u_rot, pose.tilt);
    gl.uniform2f(uq.u_half, W / 2, H / 2);
    gl.uniform1f(uq.u_mode, 2);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.uniform1f(uq.u_rot, 0);
  };

  // 水母的序列帧：远的先画，近的后画
  const drawJellies = () => {
    const t = tex('jelly');
    if (!t || !jellies.length) return;
    const W = canvas.width;
    const H = canvas.height;
    const grid = m.jelly;
    gl.useProgram(quadProg);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(aQuad);
    gl.vertexAttribPointer(aQuad, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.uniform1f(uq.u_rot, 0);
    jellies.sort((a, b) => a.depth - b.depth);
    for (const j of jellies) {
      const f = Math.floor(j.phase * grid.frames) % grid.frames;
      const u0 = (f % grid.cols) / grid.cols;
      const v0 = Math.floor(f / grid.cols) / grid.rows;
      gl.uniform1f(uq.u_alpha, j.alpha);
      gl.uniform4f(uq.u_uv, u0, v0 + 1 / grid.rows, u0 + 1 / grid.cols, v0);
      const r = [j.x - j.w / 2, j.y - j.h / 2, j.x + j.w / 2, j.y + j.h / 2];
      gl.uniform4f(uq.u_rect, (r[0] / W) * 2 - 1, 1 - (r[3] / H) * 2, (r[2] / W) * 2 - 1, 1 - (r[1] / H) * 2);
      gl.uniform1f(uq.u_mode, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    gl.uniform1f(uq.u_alpha, 1);
  };

  const drawFx = (water, time) => {
    if (!fx.n) return;
    gl.useProgram(fxProg);
    gl.bindBuffer(gl.ARRAY_BUFFER, fxBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, fxData.subarray(0, fx.n * 48), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(fxA.pos);
    gl.enableVertexAttribArray(fxA.uv);
    gl.enableVertexAttribArray(fxA.info);
    gl.vertexAttribPointer(fxA.pos, 2, gl.FLOAT, false, 32, 0);
    gl.vertexAttribPointer(fxA.uv, 2, gl.FLOAT, false, 32, 8);
    gl.vertexAttribPointer(fxA.info, 4, gl.FLOAT, false, 32, 16);
    gl.uniform1f(uf.u_time, time);
    gl.uniform2f(uf.u_res, canvas.width, canvas.height);
    gl.uniform3fv(uf.u_light, water.high.map((v) => Math.min(1, v * 1.6 + 0.25)));
    gl.uniform3fv(uf.u_deep, water.low);
    gl.drawArrays(gl.TRIANGLES, 0, fx.n * 6);
    gl.disableVertexAttribArray(fxA.uv);
    gl.disableVertexAttribArray(fxA.info);
  };

  canvas.dataset.filmKind = 'reef';
  // 给核对和排错用：现在显卡里有哪几张图、还有几张在下、几张下完等着传
  canvas.reefDebug = () => ({ textures: [...textures.keys()], loading: [...loading], ready: ready.map((r) => r.key), failures });

  return {
    kind: 'reef',
    fill() {
      filling = true;
    },
    frame(progress, now, snap = false) {
      if (dead) return;
      const dt = last === null ? 0 : Math.min(0.1, (now - last) / 1000);
      last = now;
      shown = follower.step(progress, dt, snap);
      momentum = snap ? 0 : momentumStep(momentum, follower.velocity, dt);
      watchdog.tick();
      layout(now);
      const time = (now / 1000) % 3600;
      const aspect = canvas.width / canvas.height;
      const camX = cameraX(shown, m);
      const dir = lastCam === null ? 1 : Math.sign(camX - lastCam) || 1;
      lastCam = camX;
      want(camX, aspect, dir);
      upload();
      if (urgent < 24 && (ready.length || job)) {
        upload();
        upload();
        urgent++;
      }
      const above = m.layers.above ? aboveAt(camX, m) : 0;
      // 水线离画面顶多远；水下的画面只跟着往下沉三成五：停下时水线下面看到的是鱼和芦苇茎那一截，
      // 不是水下画面最上面那片最亮的水（整个往下沉的话，底下一截是亮青色的一片，像发白）
      const dy = above * (m.aboveTo || ABOVE_TO) * canvas.height;
      const sink = dy * 0.35;
      const pose = behave(dt, { momentum, aspect, above: 0, left: fishLeft });
      const { eff, water, pxPerM } = draw(camX, time, dt, aspect, sink);
      flowX = camX;
      buildFx(flowX, time, eff, pxPerM, pose, sink, dy);
      drawJellies();
      drawFish(pose, water, above, sink);
      drawFx(water, time);
      drawAbove(camX, dy, above);

      canvas.dataset.want = shown.toFixed(4);
      if (tex(tileKey('mid', visibleTiles(m.layers.mid, camX, aspect, m.viewH)[0]))) {
        firstShown = true;
        if (!root.hasAttribute('data-lock-film-ready')) root.setAttribute('data-lock-film-ready', '');
      } else if (!firstShown) {
        // 只按画了的帧累计（dt 每帧最多 0.1 秒）：滚出视口那段时间不算
        waited += dt;
        if (failures >= 3 || waited > 15) {
          fail();
          return;
        }
      }
      const day = shown >= DAY_AT;
      if (root.hasAttribute('data-day') !== day) root.toggleAttribute('data-day', day);
      headerVars.set('--header-day', day ? '1' : '0');
    },
    destroy() {
      dead = true;
      watchdog.stop();
      canvas.removeEventListener('webglcontextlost', onLost);
      for (const t of textures.values()) gl.deleteTexture(t.tex);
      textures.clear();
      for (const item of ready) closeItem(item);
      ready.length = 0;
      if (job) {
        closeItem({ pieces: job.pieces.slice(job.next) });
        gl.deleteTexture(job.tex);
        job = null;
      }
      headerVars.clear('--header-day');
      root.removeAttribute('data-day');
      root.removeAttribute('data-lock-film-ready');
      delete canvas.dataset.filmKind;
      delete canvas.dataset.want;
      delete canvas.reefDebug;
    },
  };
}
