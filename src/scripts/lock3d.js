// 过闸的三维版：一段八级的船闸，一级比一级高，镜头跟着船往前走。
// 滚动就是前进：船开进一室，身后的闸门关上，水把船托高一级，前面的闸门打开，接着往前。
// 最后船驶出最高一级，镜头拉起来回看整段梯级，天亮。
//
// 只负责画：每一帧拿到 lock-state.js 算出来的状态，摆好船、水位、闸门和镜头。
// 颜色从 tokens.css 的调色板读，不写在这里。three.js 有七百多 KB，所以这个模块只在要用的时候才被动态导入。

import * as THREE from '../vendor/three/three.module.min.js';

// 场景的尺寸（单位随意，下面都按它算）。
const N = 8; // 八室
const LENGTH = 12; // 一室多长
const WIDTH = 6; // 一室多宽（水面）
const LIFT = 1.5; // 一级升多高
const DEPTH = 3.4; // 室底在低水位以下多深
const QUAY = 5; // 两边闸墙多厚（顶上是码头面）
const RIM = 1.1; // 墙顶比这一室的满水位高多少
const MITRE = 0.32; // 人字门关上时两扇门的夹角（弧度）

const zOf = (position) => -position * LENGTH;
const yOf = (level) => level * LIFT;

const FRAGMENT_WATER = `
uniform float uTime;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uGlow;
uniform vec3 uFog;
uniform float uFogNear;
uniform float uFogFar;
uniform vec3 uBoat;
uniform vec3 uEye;
varying vec3 vWorld;
varying float vDist;

// 和首屏水面同一个写法：几层互相扭曲的波，取脊线，就是水面上晃动的光。
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
  return pow(clamp(sum / 1.85, 0.0, 1.0), 4.0);
}

void main() {
  vec2 p = vWorld.xz * 0.42;

  // 船周围一圈圈往外的涟漪。
  vec2 d = vWorld.xz - uBoat.xz;
  float r = length(d);
  float ring = sin(r * 4.2 - uTime * 2.6) * exp(-r * 0.5);
  p += normalize(d + 0.0001) * ring * 0.06;

  float c = caustic(p, uTime);

  // 视线越贴着水面，水面越亮。
  vec3 view = normalize(uEye - vWorld);
  float graze = pow(1.0 - clamp(view.y, 0.0, 1.0), 3.0);

  vec3 col = mix(uDeep, uShallow, 0.3 + 0.7 * c);
  col += uGlow * (c * 0.5 + graze * 0.4 + ring * 0.07);

  col = mix(col, uFog, smoothstep(uFogNear, uFogFar, vDist));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

const VERTEX_WATER = `
varying vec3 vWorld;
varying float vDist;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vec4 view = viewMatrix * world;
  vDist = -view.z;
  gl_Position = projectionMatrix * view;
}
`;

// 从调色板取一个颜色。读不到就用后备值。
function paletteColor(style, name, fallback) {
  const value = style.getPropertyValue(name).trim();
  return new THREE.Color(/^#[0-9a-f]{6}$/i.test(value) ? value : fallback);
}

// 夜里（水下那一段的配色）和天亮以后（浅色段的配色）各一套，按 day 在两者之间取。
function readPalette(style) {
  const c = (name, fallback) => paletteColor(style, name, fallback);
  return {
    night: {
      sky: c('--zd-bg', '#051F38'),
      wall: c('--zd-raise', '#0A3A5C'),
      wallTop: c('--zd-line', '#1B4667'),
      shallow: c('--mint-mid', '#3ECBE6'),
      deep: c('--mint-lo', '#0A86A3'),
      glow: c('--scene-glow', '#7FE3FF'),
      gate: c('--zd-line', '#1B4667'),
      strip: c('--zd-accent', '#7FE3FF'),
      hull: c('--zd-fg', '#F1F9FF'),
      sail: c('--water-mid-0', '#8EEBFA'),
    },
    day: {
      sky: c('--zl-bg', '#F3F9FC'),
      wall: c('--zl-bg-2', '#E2EEF5'),
      wallTop: c('--zl-bg', '#F3F9FC'),
      shallow: c('--blue-mid-0', '#27A4DD'),
      deep: c('--blue-hi', '#1E4FC4'),
      glow: c('--water-hi-0', '#FFFFFF'),
      gate: c('--zl-line', '#CFE0EA'),
      strip: c('--zl-accent', '#0A6A9B'),
      hull: c('--water-hi-0', '#FFFFFF'),
      sail: c('--blue-hi-0', '#3F7FEA'),
    },
  };
}

function box(width, height, depth, material, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.position.set(x, y, z);
  return mesh;
}

// 船：俯视是一头尖一头圆的船身，一面四分之一圆的帆（和页面上别处那只船是同一个形）。
function buildBoat(materials) {
  const boat = new THREE.Group();

  const outline = new THREE.Shape();
  outline.moveTo(-0.62, 1.5);
  outline.lineTo(0.62, 1.5);
  outline.quadraticCurveTo(0.95, 0.1, 0, -1.9);
  outline.quadraticCurveTo(-0.95, 0.1, -0.62, 1.5);
  const hullGeometry = new THREE.ExtrudeGeometry(outline, { depth: 0.55, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 2, curveSegments: 16 });
  hullGeometry.rotateX(Math.PI / 2);
  const hull = new THREE.Mesh(hullGeometry, materials.hull);
  hull.position.y = 0.32;
  boat.add(hull);

  const sailShape = new THREE.Shape();
  sailShape.moveTo(0, 0);
  sailShape.lineTo(0, 2.5);
  sailShape.absellipse(0, 0, 1.75, 2.5, Math.PI / 2, 0, true);
  sailShape.lineTo(0, 0);
  const sailGeometry = new THREE.ExtrudeGeometry(sailShape, { depth: 0.06, bevelEnabled: false, curveSegments: 20 });
  sailGeometry.translate(-0.55, 0, -0.03);
  const sail = new THREE.Mesh(sailGeometry, materials.sail);
  sail.position.set(0, 0.55, -0.1);
  // 稍微偏一点角度，镜头从正后方看也有厚度。
  sail.rotation.y = -0.35;
  boat.add(sail);
  boat.scale.setScalar(1.35);

  return boat;
}

export function mountLock3D(root, canvas) {
  const doc = root.ownerDocument;
  const win = doc.defaultView;

  // 拿不到 WebGL 时这里会抛，调用方接住，改用平面的那一版。
  // failIfMajorPerformanceCaveat：浏览器只有软件渲染（没有可用的显卡）时不给上下文，直接走平面版，
  // 不让人先卡上几秒再降级。
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance', failIfMajorPerformanceCaveat: true });
  const palette = readPalette(win.getComputedStyle(root));
  const mix = { sky: new THREE.Color(), wall: new THREE.Color(), wallTop: new THREE.Color(), shallow: new THREE.Color(), deep: new THREE.Color(), glow: new THREE.Color(), gate: new THREE.Color(), strip: new THREE.Color(), hull: new THREE.Color(), sail: new THREE.Color() };

  const scene = new THREE.Scene();
  scene.background = new THREE.Color();
  scene.fog = new THREE.Fog(0x000000, 22, 84);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 500);

  const hemisphere = new THREE.HemisphereLight(0xffffff, 0x000000, 1.25);
  scene.add(hemisphere);
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(-9, 16, 12);
  scene.add(sun);

  const materials = {
    wall: new THREE.MeshLambertMaterial(),
    wallTop: new THREE.MeshLambertMaterial(),
    gate: new THREE.MeshLambertMaterial(),
    strip: new THREE.MeshBasicMaterial({ fog: false }),
    hull: new THREE.MeshLambertMaterial(),
    sail: new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }),
    rim: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55 }),
    water: new THREE.ShaderMaterial({
      vertexShader: VERTEX_WATER,
      fragmentShader: FRAGMENT_WATER,
      uniforms: {
        uTime: { value: 0 },
        uShallow: { value: mix.shallow },
        uDeep: { value: mix.deep },
        uGlow: { value: mix.glow },
        uFog: { value: mix.sky },
        uFogNear: { value: 22 },
        uFogFar: { value: 84 },
        uBoat: { value: new THREE.Vector3() },
        uEye: { value: camera.position },
      },
    }),
  };

  // —— 八室：两边的闸墙（顶上是一条亮一点的码头面）、室底、水面、贴着墙的两道水线 ——
  const waters = [];
  const waterlines = [];
  const half = WIDTH / 2;
  for (let i = 0; i < N; i++) {
    const top = yOf(i + 1) + RIM;
    const bottom = yOf(i) - DEPTH;
    const height = top - bottom;
    const z = zOf(i + 0.5);
    for (const side of [-1, 1]) {
      scene.add(box(QUAY, height, LENGTH, materials.wall, side * (half + QUAY / 2), bottom + height / 2, z));
      scene.add(box(QUAY, 0.12, LENGTH, materials.wallTop, side * (half + QUAY / 2), top + 0.06, z));
      scene.add(box(0.06, 0.06, LENGTH, materials.rim, side * (half + 0.03), top + 0.13, z));
      // 这一室比下一室矮一截，露出来的那一小面墙头也描一道。
      scene.add(box(QUAY, 0.06, 0.06, materials.rim, side * (half + QUAY / 2), top + 0.13, z - LENGTH / 2 + 0.03));
    }
    scene.add(box(WIDTH, 0.4, LENGTH, materials.wall, 0, bottom, z));

    const water = new THREE.Mesh(new THREE.PlaneGeometry(WIDTH, LENGTH, 1, 1), materials.water);
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, yOf(i), z);
    scene.add(water);
    waters.push(water);

    const lines = new THREE.Group();
    for (const side of [-1, 1]) lines.add(box(0.07, 0.07, LENGTH - 0.5, materials.strip, side * (half - 0.035), 0, 0));
    lines.position.set(0, yOf(i), z);
    scene.add(lines);
    waterlines.push(lines);
  }

  // —— 下游的河和上游的水面：很宽，一直伸到雾里 ——
  const river = new THREE.Mesh(new THREE.PlaneGeometry(900, 500), materials.water);
  river.rotation.x = -Math.PI / 2;
  river.position.set(0, yOf(0), zOf(0) + 250);
  scene.add(river);
  const pound = new THREE.Mesh(new THREE.PlaneGeometry(900, 500), materials.water);
  pound.rotation.x = -Math.PI / 2;
  pound.position.set(0, yOf(N), zOf(N) - 250);
  scene.add(pound);
  // 最高一级外面两边还有一段矮堤。
  for (const side of [-1, 1]) scene.add(box(QUAY, 1.4, 26, materials.wall, side * (half + QUAY / 2), yOf(N) - 0.1, zOf(N) - 13));

  // —— 九道人字门：每道两扇，铰在闸墙上；门顶一道亮条 ——
  const gates = [];
  const leafWidth = half / Math.cos(MITRE);
  for (let g = 0; g <= N; g++) {
    const bottom = yOf(Math.max(g - 1, 0)) - DEPTH;
    const top = yOf(Math.min(g + 1, N)) + 0.55;
    const height = top - bottom;
    const leaves = [];
    for (const side of [-1, 1]) {
      const hinge = new THREE.Group();
      hinge.position.set(side * half, 0, zOf(g));
      hinge.add(box(leafWidth, height, 0.42, materials.gate, (-side * leafWidth) / 2, bottom + height / 2, 0));
      hinge.add(box(leafWidth, 0.14, 0.5, materials.strip, (-side * leafWidth) / 2, top + 0.07, 0));
      scene.add(hinge);
      leaves.push({ hinge, side });
    }
    gates.push(leaves);
  }

  const boat = buildBoat(materials);
  scene.add(boat);

  // —— 夜里水面上漂着的光点，天亮就散了 ——
  const moteCount = 260;
  const motePositions = new Float32Array(moteCount * 3);
  for (let i = 0; i < moteCount; i++) {
    // 位置用一个固定的伪随机序列，每次打开都一样。
    const a = Math.sin(i * 12.9898) * 43758.5453;
    const b = Math.sin(i * 78.233) * 12543.123;
    const c = Math.sin(i * 39.425) * 9631.777;
    motePositions[i * 3] = ((a - Math.floor(a)) - 0.5) * 34;
    motePositions[i * 3 + 1] = (b - Math.floor(b)) * (yOf(N) + 9) + 0.4;
    motePositions[i * 3 + 2] = zOf((c - Math.floor(c)) * (N + 2) - 1);
  }
  const moteGeometry = new THREE.BufferGeometry();
  moteGeometry.setAttribute('position', new THREE.BufferAttribute(motePositions, 3));
  const moteMaterial = new THREE.PointsMaterial({ size: 0.09, transparent: true, opacity: 0.7, depthWrite: false, sizeAttenuation: true });
  const motes = new THREE.Points(moteGeometry, moteMaterial);
  scene.add(motes);

  // 画面给左边的文字让位置：宽屏把景往右挪，窄屏（文字在下面）把景往上挪。
  const resize = () => {
    const width = canvas.clientWidth || 1;
    const height = canvas.clientHeight || 1;
    renderer.setPixelRatio(Math.min(win.devicePixelRatio || 1, pixelCap));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    const narrow = width < 768;
    if (narrow) camera.setViewOffset(width, height, 0, height * 0.27, width, height);
    else camera.setViewOffset(width, height, -width * 0.17, 0, width, height);
    camera.fov = narrow ? 52 : 40;
    camera.updateProjectionMatrix();
  };
  let pixelCap = 1.75;

  const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
  const onPointer = (event) => {
    pointer.x = (event.clientX / win.innerWidth) * 2 - 1;
    pointer.y = (event.clientY / win.innerHeight) * 2 - 1;
  };
  win.addEventListener('pointermove', onPointer, { passive: true });
  win.addEventListener('resize', resize);
  resize();

  const chase = new THREE.Vector3();
  const chaseLook = new THREE.Vector3();
  const over = new THREE.Vector3();
  const overLook = new THREE.Vector3();
  const look = new THREE.Vector3();
  const smooth = (t) => t * t * (3 - 2 * t);

  // state 是 lockStateAt() 的结果，seconds 是页面打开以来的秒数。
  const frame = (state, seconds) => {
    const day = smooth(state.day);

    // 颜色：夜和昼之间取。
    for (const key of Object.keys(mix)) mix[key].lerpColors(palette.night[key], palette.day[key], day);
    scene.background.copy(mix.sky);
    scene.fog.color.copy(mix.sky);
    scene.fog.near = 22 + day * 38;
    scene.fog.far = 84 + day * 116;
    materials.wall.color.copy(mix.wall);
    materials.wallTop.color.copy(mix.wallTop);
    materials.gate.color.copy(mix.gate);
    materials.strip.color.copy(mix.strip);
    materials.hull.color.copy(mix.hull);
    materials.hull.emissive.copy(mix.hull).multiplyScalar(0.3 * (1 - day));
    materials.sail.color.copy(mix.sail);
    materials.sail.emissive.copy(mix.sail).multiplyScalar(0.55 * (1 - day));
    materials.rim.color.copy(mix.strip);
    materials.wall.emissive.copy(mix.wall).multiplyScalar(0.25 * (1 - day));
    materials.wallTop.emissive.copy(mix.wallTop).multiplyScalar(0.35 * (1 - day));
    hemisphere.color.copy(mix.glow).lerp(mix.sky, 0.5 + day * 0.4);
    hemisphere.groundColor.copy(mix.sky);
    // 天亮以后光不能再加：闸墙本来就是浅色，再亮就和天糊成一片，看不出台阶。
    hemisphere.intensity = 1.7 - day * 0.45;
    sun.intensity = 1.8 + day * 0.5;
    moteMaterial.color.copy(mix.glow);
    moteMaterial.opacity = 0.7 * (1 - day);
    motes.position.y = Math.sin(seconds * 0.12) * 0.35;

    const uniforms = materials.water.uniforms;
    uniforms.uTime.value = seconds;
    uniforms.uFogNear.value = scene.fog.near;
    uniforms.uFogFar.value = scene.fog.far;

    // 水位、水线、闸门。
    for (let i = 0; i < N; i++) {
      const y = yOf(i + state.water[i]);
      waters[i].position.y = y;
      waterlines[i].position.y = y + 0.03;
    }
    for (let g = 0; g <= N; g++) {
      // 开着的时候门扇贴在墙上，关上的时候两扇在中间碰成一个朝上游的尖。
      const angle = (Math.PI / 2 - 0.06) + (MITRE - (Math.PI / 2 - 0.06)) * state.gates[g];
      for (const leaf of gates[g]) leaf.hinge.rotation.y = -leaf.side * angle;
    }

    // 船：浮在水面上，轻轻晃。
    const bz = zOf(state.boat);
    const by = yOf(state.level);
    boat.position.set(0, by + Math.sin(seconds * 1.3) * 0.045, bz);
    boat.rotation.z = Math.sin(seconds * 0.9) * 0.025;
    boat.rotation.x = Math.sin(seconds * 1.1 + 1) * 0.015;
    uniforms.uBoat.value.set(0, by, bz);

    // 镜头：平时跟在船的斜后方；天亮时拉起来，从前上方回看整段梯级。
    pointer.sx += (pointer.x - pointer.sx) * 0.05;
    pointer.sy += (pointer.y - pointer.sy) * 0.05;
    chase.set(1.8 + pointer.sx * 1.2, by + 9.2 - pointer.sy * 0.7, bz + 14.5);
    chaseLook.set(0, by + 0.2, bz - 9);
    over.set(-24, yOf(N) + 17, zOf(-1.6));
    overLook.set(3, yOf(N * 0.42), zOf(N * 0.55));
    camera.position.lerpVectors(chase, over, day);
    look.lerpVectors(chaseLook, overLook, day);
    camera.lookAt(look);

    renderer.render(scene, camera);
  };

  return {
    frame,
    resize,
    // 画不动的时候先把清晰度降下来。
    lowerQuality() {
      pixelCap = 1;
      resize();
    },
    destroy() {
      win.removeEventListener('pointermove', onPointer);
      win.removeEventListener('resize', resize);
      scene.traverse((object) => {
        if (object.geometry) object.geometry.dispose();
      });
      for (const material of Object.values(materials)) material.dispose();
      moteMaterial.dispose();
      renderer.dispose();
    },
  };
}
