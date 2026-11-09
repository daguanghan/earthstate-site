// EarthState live globe.
// The scene is drawn in an Earth-centred equatorial frame (ECI-like), mapped to three.js axes as
//   ECI x (vernal equinox) -> +X,  ECI z (north celestial pole) -> +Y,  ECI y -> -Z.
// The Earth turns about +Y by Greenwich Mean Sidereal Time, so the texture's longitudes line up with
// the real sky. Sun and Moon directions come from the low-precision formulas of the Astronomical Almanac.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const HALF_TURN = Math.acos(-1);
const D2R = HALF_TURN / 180;
const R2D = 180 / HALF_TURN;

const SUN_DIST = 60;      // scene units (1 = Earth radius); compressed, true direction
const MOON_DIST = 5;
const MOON_RADIUS = 0.3;
const ATM_RADIUS = 1.04;
const MARK_RADIUS = 1.008;

const COLOURS = {
  hub: '#c2711c',          // pulsing ring around the hub
  hubCore: '#f3e3cf',
  consulting: '#c2711c',
  rd: '#5fb8aa',
  expert: '#dcd8cf',
};

const params = new URLSearchParams(location.search);
const CHECK = params.has('check');
let timeOffset = 0;
if (CHECK && params.get('t')) {
  const t0 = Date.parse(params.get('t'));
  if (!Number.isNaN(t0)) timeOffset = t0 - Date.now();
}
const nowMs = () => Date.now() + timeOffset;

/* ------------------------------------------------------------------ astronomy */

const wrap360 = (x) => ((x % 360) + 360) % 360;
const wrap180 = (x) => wrap360(x + 180) - 180;

export function julianDate(ms) {
  return ms / 86400000 + 2440587.5;
}

// IAU 1982 Greenwich Mean Sidereal Time (UT1 taken as UTC), in degrees.
export function gmstDeg(jd) {
  const T = (jd - 2451545.0) / 36525;
  const sec = 67310.54841 + (876600 * 3600 + 8640184.812866) * T + 0.093104 * T * T - 6.2e-6 * T * T * T;
  return wrap360(sec / 240);
}

// Astronomical Almanac low-precision Sun (about 0.01 degree, 1950-2050).
export function sunPosition(jd) {
  const n = jd - 2451545.0;
  const L = wrap360(280.460 + 0.9856474 * n);
  const g = wrap360(357.528 + 0.9856003 * n) * D2R;
  const lam = wrap360(L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g));
  const eps = 23.439 - 0.0000004 * n;
  const l = lam * D2R, e = eps * D2R;
  const ra = Math.atan2(Math.cos(e) * Math.sin(l), Math.cos(l));
  const dec = Math.asin(Math.sin(e) * Math.sin(l));
  return { lambda: lam, eps, ra: wrap360(ra * R2D), dec: dec * R2D };
}

// Astronomical Almanac low-precision Moon (about 0.3 degree in longitude), geocentric.
export function moonPosition(jd, epsDeg) {
  const T = (jd - 2451545.0) / 36525;
  const s = (deg) => Math.sin(deg * D2R);
  const lam = 218.32 + 481267.881 * T
    + 6.29 * s(135.0 + 477198.87 * T) - 1.27 * s(259.3 - 413335.36 * T)
    + 0.66 * s(235.7 + 890534.22 * T) + 0.21 * s(269.9 + 954397.74 * T)
    - 0.19 * s(357.5 + 35999.05 * T) - 0.11 * s(186.5 + 966404.03 * T);
  const bet = 5.13 * s(93.3 + 483202.02 * T) + 0.28 * s(228.2 + 960400.89 * T)
    - 0.28 * s(318.3 + 6003.15 * T) - 0.17 * s(217.6 - 407332.21 * T);
  const l = wrap360(lam) * D2R, b = bet * D2R, e = epsDeg * D2R;
  const xe = Math.cos(b) * Math.cos(l), ye = Math.cos(b) * Math.sin(l), ze = Math.sin(b);
  const x = xe, y = ye * Math.cos(e) - ze * Math.sin(e), z = ye * Math.sin(e) + ze * Math.cos(e);
  return { lambda: wrap360(lam), beta: bet, ra: wrap360(Math.atan2(y, x) * R2D), dec: Math.asin(z) * R2D };
}

// Right ascension / declination (degrees) to a unit vector in scene axes.
function eqToVec(raDeg, decDeg, out = new THREE.Vector3()) {
  const a = raDeg * D2R, d = decDeg * D2R, c = Math.cos(d);
  return out.set(c * Math.cos(a), Math.sin(d), -c * Math.sin(a));
}

// Geographic latitude / longitude to the Earth's local (body-fixed) frame.
function geoToLocal(lat, lon, r = 1, out = new THREE.Vector3()) {
  const la = lat * D2R, lo = lon * D2R, c = Math.cos(la);
  return out.set(r * c * Math.cos(lo), r * Math.sin(la), -r * c * Math.sin(lo));
}

export function skyNow(ms) {
  const jd = julianDate(ms);
  const gmst = gmstDeg(jd);
  const sun = sunPosition(jd);
  const moon = moonPosition(jd, sun.eps);
  const sunVec = eqToVec(sun.ra, sun.dec);
  const moonVec = eqToVec(moon.ra, moon.dec);
  const elong = Math.acos(THREE.MathUtils.clamp(sunVec.dot(moonVec), -1, 1));
  const illum = (1 - Math.cos(elong)) / 2;
  const waxing = wrap360(moon.lambda - sun.lambda) < 180;
  return {
    ms, jd, gmst, sun, moon, sunVec, moonVec, illum, waxing,
    subsolar: { lat: sun.dec, lon: wrap180(sun.ra - gmst) },
    sublunar: { lat: moon.dec, lon: wrap180(moon.ra - gmst) },
  };
}

function phaseName(k, waxing) {
  if (k < 0.02) return 'new moon';
  if (k > 0.98) return 'full moon';
  if (Math.abs(k - 0.5) < 0.04) return waxing ? 'first quarter' : 'last quarter';
  return (waxing ? 'waxing ' : 'waning ') + (k < 0.5 ? 'crescent' : 'gibbous');
}

/* ------------------------------------------------------------------ shaders */

const earthVert = /* glsl */`
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vW;
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const earthFrag = /* glsl */`
  uniform sampler2D uDay;
  uniform vec3 uSun;
  uniform vec3 uAtmo;
  uniform vec3 uTwilight;
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vW;
  void main() {
    vec3 N = normalize(vN);
    vec3 V = normalize(cameraPosition - vW);
    vec3 L = normalize(uSun);
    vec3 tex = texture2D(uDay, vUv).rgb;
    float ndl = dot(N, L);

    // soft terminator: full night below about -8 degrees of solar elevation, full day above about +6
    float dayF = smoothstep(-0.14, 0.10, ndl);
    float lambert = clamp(ndl, 0.0, 1.0);
    vec3 dayCol = tex * (0.42 + 0.95 * pow(lambert, 0.6));

    // night: the same imagery, darkened and tinted deep blue (no city lights)
    float lum = dot(tex, vec3(0.2126, 0.7152, 0.0722));
    vec3 nightCol = mix(vec3(lum), tex, 0.35) * vec3(0.10, 0.15, 0.34) + vec3(0.0016, 0.0028, 0.0085);

    vec3 col = mix(nightCol, dayCol, dayF);

    // a faint warm band along the terminator
    float tw = exp(-pow(ndl / 0.075, 2.0));
    col += uTwilight * tw * (0.004 + 0.08 * lum);

    // ocean glint; the water mask is read from a blurred mip level so it stays smooth
    vec3 m = sqrt(texture2D(uDay, vUv, 3.0).rgb);
    float ocean = smoothstep(0.03, 0.10, m.b - m.r) * (1.0 - smoothstep(0.34, 0.50, m.g));
    vec3 H = normalize(L + V);
    float nh = max(dot(N, H), 0.0);
    float spec = (pow(nh, 160.0) * 0.30 + pow(nh, 32.0) * 0.03) * ocean * smoothstep(0.0, 0.15, ndl);
    col += vec3(1.0, 0.93, 0.80) * spec;

    // haze towards the limb on the lit side
    float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
    col += uAtmo * rim * smoothstep(-0.15, 0.45, ndl) * 0.42;

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;

const atmoVert = /* glsl */`
  varying vec3 vW;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

// Thin scattering shell: brightness follows the chord length of the view ray through the shell,
// coloured by the sunlight at the ray's lowest point (blue by day, warm at the terminator, dark at night).
const atmoFrag = /* glsl */`
  uniform vec3 uSun;
  uniform vec3 uAtmo;
  uniform vec3 uTwilight;
  uniform float uR0;
  uniform float uR1;
  varying vec3 vW;
  void main() {
    vec3 ro = cameraPosition;
    vec3 rd = normalize(vW - ro);
    float tca = -dot(ro, rd);
    vec3 pc = ro + rd * tca;
    float b = length(pc);
    float r1 = uR1 * uR1;
    float Lmax = 2.0 * sqrt(r1 - uR0 * uR0);
    float L;
    vec3 P;
    float w;
    if (b < uR0) {
      float th0 = sqrt(uR0 * uR0 - b * b);
      L = sqrt(max(r1 - b * b, 0.0)) - th0;
      P = ro + rd * (tca - th0);
      w = 0.22;
    } else {
      L = 2.0 * sqrt(max(r1 - b * b, 0.0));
      P = pc;
      float alt = clamp((b - uR0) / (uR1 - uR0), 0.0, 1.0);
      w = exp(-alt * 2.6);
    }
    float glow = clamp(L / Lmax, 0.0, 1.0) * w;
    float mu = dot(normalize(P), normalize(uSun));
    float lit = smoothstep(-0.24, 0.20, mu);
    vec3 col = mix(uTwilight, uAtmo, smoothstep(-0.10, 0.25, mu)) * lit;
    col += vec3(0.010, 0.018, 0.045) * (1.0 - lit);
    float forward = pow(max(dot(rd, normalize(uSun)), 0.0), 10.0);
    col *= 1.0 + 2.5 * forward;
    gl_FragColor = vec4(col * glow * 1.35, 1.0);
    #include <colorspace_fragment>
  }`;

const moonVert = /* glsl */`
  varying vec3 vObj;
  varying vec3 vN;
  void main() {
    vObj = normalize(position);
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const moonFrag = /* glsl */`
  uniform vec3 uSun;
  varying vec3 vObj;
  varying vec3 vN;
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x),
                   mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x),
                   mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; }
    return s;
  }
  vec3 hash3(vec3 p) {
    p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
    return fract(sin(p) * 43758.5453123);
  }
  float craters(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    float res = 0.0;
    for (int z = -1; z <= 1; z++)
    for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++) {
      vec3 g = vec3(float(x), float(y), float(z));
      vec3 o = hash3(i + g);
      if (o.y < 0.45) continue;
      float d = length(g + o - f);
      float rad = 0.22 + 0.22 * o.x;
      float rim = smoothstep(rad * 0.72, rad * 0.95, d) * (1.0 - smoothstep(rad * 0.95, rad * 1.2, d));
      float flo = 1.0 - smoothstep(rad * 0.55, rad * 0.88, d);
      res += rim * 0.06 - flo * 0.05;
    }
    return res;
  }
  void main() {
    vec3 p = vObj;
    float base = 0.58 + 0.26 * (fbm(p * 5.0) - 0.5);
    float maria = smoothstep(0.47, 0.60, fbm(p * 1.6 + vec3(3.1, 1.7, 0.4)) + 0.12 * p.z);
    float alb = mix(base, base * 0.55, maria);
    alb += craters(p * 6.0) + 0.8 * craters(p * 14.0 + 7.0) + 0.6 * craters(p * 29.0 + 3.0);
    alb = clamp(alb, 0.08, 0.95);
    vec3 N = normalize(vN);
    float ndl = dot(N, normalize(uSun));
    float lit = smoothstep(-0.02, 0.10, ndl) * (0.55 + 0.45 * max(ndl, 0.0));
    vec3 col = vec3(alb) * vec3(1.0, 0.985, 0.96) * (lit * 1.15 + 0.012);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;

const markVert = /* glsl */`
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aIdx;
  uniform float uPR;
  uniform float uHover;
  varying vec3 vColor;
  varying float vFade;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vec3 n = normalize(w.xyz);
    vFade = smoothstep(-0.02, 0.2, dot(n, normalize(cameraPosition - w.xyz)));
    vColor = aColor;
    float s = aSize * (abs(aIdx - uHover) < 0.5 ? 1.6 : 1.0);
    gl_PointSize = s * uPR * 2.4;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const markFrag = /* glsl */`
  varying vec3 vColor;
  varying float vFade;
  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float r = length(c);
    if (r > 1.0) discard;
    float R = 0.40;
    float core = 1.0 - smoothstep(R - 0.05, R, r);
    float edge = smoothstep(R - 0.15, R - 0.07, r);
    vec3 dotCol = mix(vColor, vColor * 0.18, edge * 0.9);
    dotCol = mix(dotCol, vec3(1.0), (1.0 - smoothstep(0.0, R * 0.55, r)) * 0.28);
    float halo = 1.0 - smoothstep(R, 1.0, r);
    halo = halo * halo * 0.5;
    vec3 col = mix(vColor, dotCol, core);
    float a = max(core, halo) * vFade;
    if (a < 0.01) discard;
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }`;

const ringFrag = /* glsl */`
  uniform float uTime;
  uniform float uAnim;
  varying vec3 vColor;
  varying float vFade;
  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float r = length(c);
    if (r > 1.0) discard;
    float ph = uAnim > 0.5 ? fract(uTime * 0.45) : 0.45;
    float ringR = mix(0.22, 0.96, ph);
    float ring = 1.0 - smoothstep(0.0, 0.06, abs(r - ringR));
    float a = ring * (1.0 - ph) * 0.85 * vFade;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor, a);
    #include <colorspace_fragment>
  }`;

const arcVert = /* glsl */`
  attribute float aT;
  attribute float aSeed;
  attribute vec3 aColor;
  varying float vT;
  varying float vSeed;
  varying vec3 vColor;
  void main() {
    vT = aT;
    vSeed = aSeed;
    vColor = aColor;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const arcFrag = /* glsl */`
  uniform float uTime;
  uniform float uAnim;
  varying float vT;
  varying float vSeed;
  varying vec3 vColor;
  void main() {
    float head = fract(uTime * 0.14 + vSeed);
    float d = head - vT;
    float trail = d >= 0.0 ? exp(-d * 8.0) : 0.0;
    float g = trail * uAnim;
    float a = 0.34 + 0.62 * g;
    vec3 col = vColor * (0.85 + 0.7 * g);
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }`;

const starVert = /* glsl */`
  attribute float aSize;
  attribute float aBright;
  attribute vec3 aColor;
  uniform float uPR;
  varying float vBright;
  varying vec3 vColor;
  void main() {
    vBright = aBright;
    vColor = aColor;
    gl_PointSize = aSize * uPR;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const starFrag = /* glsl */`
  varying float vBright;
  varying vec3 vColor;
  void main() {
    float r = length(gl_PointCoord * 2.0 - 1.0);
    if (r > 1.0) discard;
    float a = vBright * (1.0 - smoothstep(0.15, 1.0, r));
    gl_FragColor = vec4(vColor, a);
    #include <colorspace_fragment>
  }`;

/* ------------------------------------------------------------------ page */

const $ = (id) => document.getElementById(id);
const stage = $('stage');
const canvas = $('globe');
const statusEl = $('status');
const tip = $('tip');
const ui = $('ui');
const compactQuery = matchMedia('(max-width: 680px)');
const sideQuery = matchMedia('(max-width: 680px) and (max-height: 500px) and (min-aspect-ratio: 6/5)');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const coarse = matchMedia('(pointer: coarse)');

function showStatus(text) {
  statusEl.textContent = text;
  statusEl.hidden = false;
}

function main() {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch (err) {
    showStatus('This globe needs WebGL, which is turned off or not supported in this browser.');
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x0f1317, 1);

  let renderNow = () => {};
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 5000);
  camera.up.set(0, 1, 0);

  const shared = {
    uSun: { value: new THREE.Vector3(1, 0, 0) },
    uTime: { value: 0 },
    uAnim: { value: reduceMotion.matches ? 0 : 1 },
    uPR: { value: renderer.getPixelRatio() },
    uAtmo: { value: new THREE.Color('#5b9fe6') },
    uTwilight: { value: new THREE.Color('#ff8b45') },
  };

  /* Earth */
  const placeholder = new THREE.DataTexture(new Uint8Array([22, 36, 60, 255]), 1, 1);
  placeholder.colorSpace = THREE.SRGBColorSpace;
  placeholder.needsUpdate = true;
  const earthMat = new THREE.ShaderMaterial({
    uniforms: { uDay: { value: placeholder }, uSun: shared.uSun, uAtmo: shared.uAtmo, uTwilight: shared.uTwilight },
    vertexShader: earthVert,
    fragmentShader: earthFrag,
  });
  const earth = new THREE.Group();
  earth.add(new THREE.Mesh(new THREE.SphereGeometry(1, 160, 80), earthMat));
  scene.add(earth);

  const small = window.innerWidth < 768 || (window.devicePixelRatio || 1) < 1.5 || renderer.capabilities.maxTextureSize < 4096;
  const texSize = CHECK && /^(2k|4k)$/.test(params.get('tex') || '') ? params.get('tex') : (small ? '2k' : '4k');
  new THREE.TextureLoader().load(`textures/earth_day_${texSize}.jpg`, (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    earthMat.uniforms.uDay.value = tex;
    statusEl.hidden = true;
    renderNow();
  }, undefined, () => showStatus('The Earth imagery could not be loaded.'));

  /* atmosphere */
  const atmo = new THREE.Mesh(
    new THREE.SphereGeometry(ATM_RADIUS, 160, 80),
    new THREE.ShaderMaterial({
      uniforms: { uSun: shared.uSun, uAtmo: shared.uAtmo, uTwilight: shared.uTwilight, uR0: { value: 1.0 }, uR1: { value: ATM_RADIUS } },
      vertexShader: atmoVert,
      fragmentShader: atmoFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  atmo.renderOrder = 2;
  scene.add(atmo);

  /* Sun: glow sprite on the true direction, far out */
  const sunTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grd.addColorStop(0.0, 'rgba(255,255,252,1)');
    grd.addColorStop(0.07, 'rgba(255,250,232,1)');
    grd.addColorStop(0.11, 'rgba(255,224,170,0.75)');
    grd.addColorStop(0.22, 'rgba(255,186,110,0.28)');
    grd.addColorStop(0.5, 'rgba(255,150,70,0.07)');
    grd.addColorStop(1.0, 'rgba(255,140,60,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  sun.scale.setScalar(15);
  sun.renderOrder = 1;
  scene.add(sun);
  const sunLight = new THREE.DirectionalLight(0xffffff, 1);   // kept on the Sun for any standard material
  scene.add(sunLight);

  /* Moon: procedural surface, near side kept towards the Earth, lit by the true Sun direction */
  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(MOON_RADIUS, 64, 32),
    new THREE.ShaderMaterial({ uniforms: { uSun: shared.uSun }, vertexShader: moonVert, fragmentShader: moonFrag }),
  );
  scene.add(moon);

  /* stars, fixed in the celestial frame */
  {
    const N = 2400;
    const pos = new Float32Array(N * 3), size = new Float32Array(N), bright = new Float32Array(N), col = new Float32Array(N * 3);
    let seed = 20261109;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const tint = [new THREE.Color('#a9c4ff'), new THREE.Color('#ffffff'), new THREE.Color('#fff1d8'), new THREE.Color('#ffd2a8')];
    for (let i = 0; i < N; i++) {
      const z = rnd() * 2 - 1, a = rnd() * 2 * HALF_TURN, r = Math.sqrt(1 - z * z);
      pos.set([1500 * r * Math.cos(a), 1500 * z, 1500 * r * Math.sin(a)], i * 3);
      const m = Math.pow(rnd(), 3.2);
      size[i] = 1.0 + 2.2 * m;
      bright[i] = 0.18 + 0.7 * m;
      const c = tint[Math.min(3, Math.floor(rnd() * 4.2))];
      col.set([c.r, c.g, c.b], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aBright', new THREE.BufferAttribute(bright, 1));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    const stars = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: { uPR: shared.uPR }, vertexShader: starVert, fragmentShader: starFrag,
      transparent: true, depthWrite: false,
    }));
    stars.renderOrder = -1;
    stars.frustumCulled = false;
    scene.add(stars);
  }

  /* controls */
  const controls = new OrbitControls(camera, canvas);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.zoomSpeed = 0.8;
  controls.minDistance = 1.3;
  controls.maxDistance = 16;
  controls.autoRotateSpeed = 0.35;     // about three minutes per orbit
  controls.autoRotate = !reduceMotion.matches;

  /* layout: keep the globe centred in the space left free by the overlays */
  let bandFrac = 1, widthFrac = 1;
  function layout() {
    const w = Math.max(1, stage.clientWidth), h = Math.max(1, stage.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const r0 = stage.getBoundingClientRect();
    const box = (sel) => document.querySelector(sel).getBoundingClientRect();
    let left = 0, right = w, top = 0, bottom = h;
    if (sideQuery.matches) {
      right = box('.titlebox').left - r0.left - 6;
      bottom = box('.credit').top - r0.top;
    } else if (compactQuery.matches) {
      top = box('.controls').bottom - r0.top;
      bottom = box('.legendbox').top - r0.top;
    } else {
      bottom = box('.credit').top - r0.top;
    }
    if (bottom - top < h * 0.3) { top = 0; bottom = h; }
    if (right - left < w * 0.3) { left = 0; right = w; }
    bandFrac = (bottom - top) / h;
    widthFrac = (right - left) / w;
    camera.setViewOffset(w, h, -((left + right) / 2 - w / 2), -((top + bottom) / 2 - h / 2), w, h);
    camera.updateProjectionMatrix();
    shared.uPR.value = renderer.getPixelRatio();
    renderNow();
  }
  function effHalf() {
    const tv = Math.tan(camera.fov * D2R / 2);
    return Math.min(Math.atan(tv * bandFrac), Math.atan(tv * camera.aspect * widthFrac));
  }
  const fitDistance = (frac) => ATM_RADIUS / Math.sin(effHalf() * frac);
  // distance for a regional view: the visible half-height at the surface scales with s
  const regionDistance = (s) => 1 + s * Math.tan(20 * D2R) / Math.tan(effHalf());

  /* sky state */
  let sky = skyNow(nowMs());
  function applySky() {
    sky = skyNow(nowMs());
    earth.rotation.y = sky.gmst * D2R;
    shared.uSun.value.copy(sky.sunVec);
    sun.position.copy(sky.sunVec).multiplyScalar(SUN_DIST);
    sunLight.position.copy(sky.sunVec);
    moon.position.copy(sky.moonVec).multiplyScalar(MOON_DIST);
    moon.lookAt(0, 0, 0);
    earth.updateMatrixWorld();
  }
  applySky();

  const geoToWorld = (lat, lon, r = 1) => geoToLocal(lat, lon, r).applyQuaternion(earth.quaternion);

  /* first view: between the hub and the subsolar point, so day, night and the UK are all in view */
  const HUB_DEFAULT = { lat: 52.5, lon: -1.5 };
  layout();
  {
    const h = geoToWorld(HUB_DEFAULT.lat, HUB_DEFAULT.lon);
    const s = sky.sunVec.clone();
    let dir = h.dot(s) > -0.97 ? h.clone().lerp(s, 0.32).normalize() : h.clone();
    const lat = THREE.MathUtils.clamp(Math.asin(dir.y) * R2D, -8, 38) * D2R;
    const az = Math.atan2(dir.x, dir.z);
    dir = new THREE.Vector3(Math.cos(lat) * Math.sin(az), Math.sin(lat), Math.cos(lat) * Math.cos(az));
    camera.position.copy(dir.multiplyScalar(fitDistance(0.8)));
    camera.lookAt(0, 0, 0);
    controls.update();
  }

  /* camera flights */
  let flight = null;
  let resumeTimer = 0;
  function scheduleResume(ms) {
    clearTimeout(resumeTimer);
    if (reduceMotion.matches) return;
    resumeTimer = setTimeout(() => { if (!flight) controls.autoRotate = true; }, ms);
  }
  function flyTo(dirWorld, dist) {
    clearTimeout(resumeTimer);
    controls.autoRotate = false;
    const toDir = dirWorld.clone().normalize();
    // keep clear of the poles, where the orbit controls flip
    const maxLat = 82 * D2R;
    if (Math.abs(Math.asin(toDir.y)) > maxLat) {
      const az = Math.atan2(toDir.x, toDir.z), la = Math.sign(toDir.y) * maxLat;
      toDir.set(Math.cos(la) * Math.sin(az), Math.sin(la), Math.cos(la) * Math.cos(az));
    }
    dist = THREE.MathUtils.clamp(dist, controls.minDistance, controls.maxDistance);
    if (reduceMotion.matches) {
      camera.position.copy(toDir).multiplyScalar(dist);
      controls.update();
      return;
    }
    controls.enableDamping = false;
    controls.update();
    const fromDir = camera.position.clone().normalize();
    flight = {
      t0: performance.now(), dur: 1700, fromDir,
      q: new THREE.Quaternion().setFromUnitVectors(fromDir, toDir),
      d0: camera.position.length(), d1: dist,
    };
  }
  const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
  const qId = new THREE.Quaternion(), qTmp = new THREE.Quaternion();
  function stepFlight(t) {
    if (!flight) return;
    const k = Math.min(1, (t - flight.t0) / flight.dur), e = ease(k);
    qTmp.slerpQuaternions(qId, flight.q, e);
    camera.position.copy(flight.fromDir).applyQuaternion(qTmp)
      .multiplyScalar(THREE.MathUtils.lerp(flight.d0, flight.d1, e));
    if (k >= 1) {
      flight = null;
      controls.enableDamping = true;
      scheduleResume(10000);
    }
  }

  // Put the camera on the far side of the Earth from a body, turned sideways until the body sits
  // clear of the Earth's limb, so both are in view.
  function focusBody(bodyPos, earthFrac, bodyFrac) {
    const half = effHalf();
    const d = ATM_RADIUS / Math.sin(half * earthFrac);
    const u = bodyPos.clone().normalize();
    const p = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), u);
    if (p.lengthSq() < 1e-6) p.set(1, 0, 0);
    p.normalize();
    if (p.dot(camera.position) < 0) p.negate();
    const target = half * bodyFrac;
    const C = new THREE.Vector3(), toBody = new THREE.Vector3();
    let lo = 0, hi = 85 * D2R;
    for (let i = 0; i < 40; i++) {
      const a = (lo + hi) / 2;
      C.copy(u).multiplyScalar(-Math.cos(a)).addScaledVector(p, Math.sin(a)).multiplyScalar(d);
      toBody.subVectors(bodyPos, C);
      const ang = C.clone().negate().angleTo(toBody);
      if (ang < target) lo = a; else hi = a;
    }
    flyTo(C, d);
  }

  const focus = {
    uk: () => flyTo(geoToWorld(54.0, -2.5), regionDistance(0.75)),
    europe: () => flyTo(geoToWorld(50.0, 12.0), regionDistance(1.25)),
    sun: () => focusBody(sun.position, 0.42, 0.78),
    moon: () => focusBody(moon.position, 0.36, 0.7),
  };
  document.querySelectorAll('[data-focus]').forEach((b) => b.addEventListener('click', () => focus[b.dataset.focus]()));

  controls.addEventListener('start', () => {
    flight = null;
    controls.enableDamping = true;
    controls.autoRotate = false;
    clearTimeout(resumeTimer);
    canvas.classList.add('dragging');
  });
  controls.addEventListener('end', () => {
    canvas.classList.remove('dragging');
    scheduleResume(4000);
  });

  /* ---------------------------------------------------------------- network overlay */

  const markMat = (extra = {}) => new THREE.ShaderMaterial({
    uniforms: { uPR: shared.uPR, uHover: { value: -1 }, uTime: shared.uTime, uAnim: shared.uAnim },
    vertexShader: markVert, fragmentShader: markFrag,
    transparent: true, depthWrite: false, ...extra,
  });
  const arcMat = new THREE.ShaderMaterial({
    uniforms: { uTime: shared.uTime, uAnim: shared.uAnim },
    vertexShader: arcVert, fragmentShader: arcFrag,
    transparent: true, depthWrite: false,
  });

  const overlay = new THREE.Group();
  earth.add(overlay);
  let data = null;
  let mode = 'experts';
  const show = { rd: true, consulting: true };
  let pickables = [];
  let activePoints = null;
  let hubPoints = null;

  function pointsFrom(items, material) {
    const n = items.length;
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n), idx = new Float32Array(n);
    const c = new THREE.Color();
    items.forEach((it, i) => {
      pos.set([it.local.x, it.local.y, it.local.z], i * 3);
      c.set(it.color);
      col.set([c.r, c.g, c.b], i * 3);
      size[i] = it.size;
      idx[i] = i;
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aIdx', new THREE.BufferAttribute(idx, 1));
    const pts = new THREE.Points(g, material);
    pts.frustumCulled = false;
    pts.renderOrder = 4;
    return pts;
  }

  function arcsFrom(hubUnit, items) {
    const SEG = 72;
    const pos = [], tt = [], seed = [], col = [];
    const a = hubUnit, p = new THREE.Vector3(), q = new THREE.Vector3(), c = new THREE.Color();
    items.forEach((it, k) => {
      const b = it.local.clone().normalize();
      const om = Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1));
      if (om < 0.6 * D2R) return;
      const h = 0.025 + 0.30 * (om / HALF_TURN);
      const so = Math.sin(om);
      const at = (t, out) => {
        out.copy(a).multiplyScalar(Math.sin((1 - t) * om) / so).addScaledVector(b, Math.sin(t * om) / so);
        return out.normalize().multiplyScalar(1.004 + h * Math.sin(HALF_TURN * t));
      };
      c.set(it.color);
      const s = (k * 0.6180339) % 1;
      for (let i = 0; i < SEG; i++) {
        const t0 = i / SEG, t1 = (i + 1) / SEG;
        at(t0, p); at(t1, q);
        pos.push(p.x, p.y, p.z, q.x, q.y, q.z);
        tt.push(t0, t1);
        seed.push(s, s);
        col.push(c.r, c.g, c.b, c.r, c.g, c.b);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aT', new THREE.Float32BufferAttribute(tt, 1));
    g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 3));
    const lines = new THREE.LineSegments(g, arcMat);
    lines.frustumCulled = false;
    lines.renderOrder = 3;
    return lines;
  }

  function clearOverlay() {
    for (const o of [...overlay.children]) {
      overlay.remove(o);
      o.geometry.dispose();
      if (o.material !== arcMat) o.material.dispose();
    }
  }

  function buildOverlay() {
    if (!data) return;
    clearOverlay();
    const hub = data.hub;
    const hubLocal = geoToLocal(hub.lat, hub.lon, MARK_RADIUS);
    const hubItem = { kind: 'hub', local: hubLocal, color: COLOURS.hubCore, size: 10, d: hub };
    let items;
    if (mode === 'experts') {
      items = data.experts.map((e) => ({
        kind: 'expert', d: e, color: COLOURS.expert,
        local: geoToLocal(e.lat, e.lon, MARK_RADIUS),
        size: 6.5 + 2.4 * Math.sqrt(Math.max(0, (e.count || 1) - 1)),
      }));
    } else {
      items = data.projects.filter((p) => show[p.type === 'rd' ? 'rd' : 'consulting']).map((p) => ({
        kind: 'project', d: p, color: p.type === 'rd' ? COLOURS.rd : COLOURS.consulting,
        local: geoToLocal(p.lat, p.lon, MARK_RADIUS), size: 7.5,
      }));
    }
    overlay.add(arcsFrom(hubLocal.clone().normalize(), items));
    activePoints = pointsFrom(items, markMat());
    overlay.add(activePoints);
    hubPoints = pointsFrom([hubItem], markMat());
    const ring = pointsFrom([{ ...hubItem, color: COLOURS.hub, size: 20 }], markMat({ fragmentShader: ringFrag }));
    overlay.add(ring, hubPoints);
    pickables = items.map((it, i) => ({ ...it, i, layer: activePoints })).concat([{ ...hubItem, i: 0, layer: hubPoints }]);
    renderLegend(items);
    hideTip();
    renderNow();
  }

  function legendRow(color, label, n, hub = false) {
    const li = document.createElement('li');
    const dot = document.createElement('span');
    dot.className = hub ? 'dot hub' : 'dot';
    dot.style.background = color;
    const t = document.createElement('span');
    t.textContent = label;
    li.append(dot, t);
    if (n !== undefined) {
      const c = document.createElement('span');
      c.className = 'n';
      c.textContent = n;
      li.append(c);
    }
    return li;
  }

  function renderLegend(items) {
    const ul = $('legend');
    ul.replaceChildren();
    ul.append(legendRow(COLOURS.hubCore, 'Hub, United Kingdom', undefined, true));
    if (mode === 'experts') {
      const kinds = new Map();
      for (const e of data.experts) {
        const k = kinds.get(e.kind) || { places: 0, people: 0 };
        k.places += 1;
        k.people += e.count || 1;
        kinds.set(e.kind, k);
      }
      for (const [kind, k] of kinds) {
        ul.append(legendRow(COLOURS.expert, `${kind}s`, `${k.people} in ${k.places} places`));
      }
    } else {
      const total = { rd: 0, consulting: 0 };
      for (const p of data.projects) total[p.type === 'rd' ? 'rd' : 'consulting'] += 1;
      ul.append(legendRow(COLOURS.rd, 'R&D projects', show.rd ? total.rd : `0 of ${total.rd}`));
      ul.append(legendRow(COLOURS.consulting, 'Consulting projects', show.consulting ? total.consulting : `0 of ${total.consulting}`));
    }
  }

  fetch('network.json')
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((json) => {
      data = json;
      const total = { rd: 0, consulting: 0 };
      for (const p of data.projects) total[p.type === 'rd' ? 'rd' : 'consulting'] += 1;
      $('n-rd').textContent = total.rd;
      $('n-consulting').textContent = total.consulting;
      buildOverlay();
    })
    .catch(() => showStatus('The network data could not be loaded.'));

  document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    mode = b.dataset.mode;
    document.querySelectorAll('[data-mode]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    $('filters').hidden = mode !== 'projects';
    buildOverlay();
    layout();
  }));
  document.querySelectorAll('[data-type]').forEach((b) => b.addEventListener('click', () => {
    const t = b.dataset.type;
    show[t] = !show[t];
    b.setAttribute('aria-pressed', String(show[t]));
    buildOverlay();
  }));

  /* ---------------------------------------------------------------- picking and tooltip */

  const v = new THREE.Vector3();
  let hovered = null;
  let tipPinned = false;

  function pick(clientX, clientY, radius) {
    const rect = canvas.getBoundingClientRect();
    const mx = clientX - rect.left, my = clientY - rect.top;
    let best = null, bestD = radius;
    for (const it of pickables) {
      v.copy(it.local).applyMatrix4(earth.matrixWorld);
      if (v.dot(camera.position) <= v.lengthSq() + 0.004) continue;   // on the far side of the globe
      v.project(camera);
      const sx = (v.x + 1) / 2 * rect.width, sy = (1 - v.y) / 2 * rect.height;
      const d = Math.hypot(sx - mx, sy - my) - (it.kind === 'hub' ? 0 : 0.5);
      if (d < bestD) { bestD = d; best = it; }
    }
    return best;
  }

  function setHover(it) {
    if (hovered && hovered.layer && hovered.layer.material) hovered.layer.material.uniforms.uHover.value = -1;
    hovered = it;
    if (it && it.layer) it.layer.material.uniforms.uHover.value = it.i;
    canvas.classList.toggle('pointing', !!it);
  }

  function tipContent(it) {
    tip.replaceChildren();
    const line = (cls, text) => { const d = document.createElement('div'); d.className = cls; d.textContent = text; return d; };
    const tag = (color, text) => {
      const d = document.createElement('div');
      d.className = 'k';
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = color;
      d.append(dot, document.createTextNode(text));
      return d;
    };
    const d = it.d;
    if (it.kind === 'expert') {
      const t = line('t', `${d.kind} · ${d.place}`);
      if ((d.count || 1) > 1) {
        const x = document.createElement('span');
        x.className = 'x';
        x.textContent = `×${d.count}`;
        t.append(x);
      }
      tip.append(t);
    } else if (it.kind === 'project') {
      tip.append(line('t', d.title));
      if (d.note) tip.append(line('n', d.note));
      tip.append(tag(it.color, `${d.type === 'rd' ? 'R&D' : 'Consulting'} · ${d.country}`));
    } else {
      tip.append(line('t', d.place));
      tip.append(tag(COLOURS.hub, 'Hub of the network'));
    }
  }

  function placeTip(clientX, clientY) {
    const r = stage.getBoundingClientRect();
    let x = clientX - r.left + 14, y = clientY - r.top + 14;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    if (x + w > r.width - 8) x = clientX - r.left - w - 14;
    if (y + h > r.height - 8) y = clientY - r.top - h - 14;
    tip.style.left = `${Math.max(8, x)}px`;
    tip.style.top = `${Math.max(8, y)}px`;
  }

  function showTipFor(it, clientX, clientY) {
    tipContent(it);
    tip.hidden = false;
    placeTip(clientX, clientY);
  }
  function hideTip() {
    tip.hidden = true;
    tipPinned = false;
    setHover(null);
  }

  let down = null;
  canvas.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY, t: performance.now() };
    if (e.pointerType !== 'mouse') { tip.hidden = true; }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || e.buttons) return;
    const it = pick(e.clientX, e.clientY, 14);
    if (it) {
      if (it !== hovered) setHover(it);
      showTipFor(it, e.clientX, e.clientY);
    } else if (!tipPinned) {
      tip.hidden = true;
      setHover(null);
    }
  });
  canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !tipPinned) hideTip(); });
  canvas.addEventListener('pointerup', (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const quick = performance.now() - down.t < 500;
    down = null;
    if (moved > 6 || !quick) return;
    const it = pick(e.clientX, e.clientY, e.pointerType === 'mouse' ? 14 : 24);
    if (it) {
      setHover(it);
      showTipFor(it, e.clientX, e.clientY);
      tipPinned = e.pointerType !== 'mouse';
    } else {
      hideTip();
    }
  });

  if (coarse.matches) $('hint').textContent = 'Drag to turn · pinch to zoom · tap a marker for details';

  /* ---------------------------------------------------------------- info panel */

  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = (n) => String(n).padStart(2, '0');
  const fmtLat = (x) => `${Math.abs(x).toFixed(1)}° ${x >= 0 ? 'N' : 'S'}`;
  const fmtLon = (x) => `${Math.abs(x).toFixed(1)}° ${x >= 0 ? 'E' : 'W'}`;
  const fmtRA = (deg) => {
    const hrs = wrap360(deg) / 15, h = Math.floor(hrs), m = Math.floor((hrs - h) * 60);
    return `${h}h ${pad(m)}m`;
  };
  const moonIcon = $('moonicon');
  function drawMoonIcon(k, waxing) {
    const g = moonIcon.getContext('2d');
    const W = moonIcon.width, c = W / 2, r = W / 2 - 1.5;
    g.clearRect(0, 0, W, W);
    g.fillStyle = '#2b333b';
    g.beginPath(); g.arc(c, c, r, 0, 2 * HALF_TURN); g.fill();
    const s = waxing ? 1 : -1;
    g.fillStyle = '#e9e7e1';
    g.beginPath();
    g.arc(c, c, r, -HALF_TURN / 2, HALF_TURN / 2, s < 0);
    g.ellipse(c, c, Math.max(0.01, Math.abs(r * (1 - 2 * k))), r, 0, HALF_TURN / 2, -HALF_TURN / 2, (s > 0) === (k < 0.5));
    g.fill();
  }
  let lastSecond = -1;
  function updateInfo() {
    const sec = Math.floor(sky.ms / 1000);
    if (sec === lastSecond) return;
    lastSecond = sec;
    const d = new Date(sky.ms);
    $('utc').textContent = `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
    const ss = $('subsolar');
    ss.textContent = `${fmtLat(sky.subsolar.lat)}, ${fmtLon(sky.subsolar.lon)}`;
    ss.title = `Sun: right ascension ${fmtRA(sky.sun.ra)}, declination ${sky.sun.dec.toFixed(2)}°`;
    const pct = Math.round(sky.illum * 100);
    const m = $('moon');
    m.textContent = `${pct}% illuminated, ${phaseName(sky.illum, sky.waxing)}`;
    m.title = `Moon: right ascension ${fmtRA(sky.moon.ra)}, declination ${sky.moon.dec.toFixed(2)}°`;
    if (sec % 60 === 0 || moonIcon.dataset.k === undefined) {
      drawMoonIcon(sky.illum, sky.waxing);
      moonIcon.dataset.k = pct;
    }
  }

  /* ---------------------------------------------------------------- check mode (?check) */

  let checkMarks = null;
  if (CHECK) {
    const places = [
      { name: 'Subsolar point', color: '#ffe14d', geo: () => sky.subsolar },
      { name: 'Sublunar point', color: '#b9c2cc', geo: () => sky.sublunar },
      { name: 'London', color: '#ff3b3b', geo: () => ({ lat: 51.5, lon: -0.13 }) },
      { name: 'Sydney', color: '#39e07a', geo: () => ({ lat: -33.87, lon: 151.21 }) },
    ];
    checkMarks = places.map((p) => {
      const label = document.createElement('div');
      label.className = 'checklabel';
      label.textContent = p.name;
      stage.append(label);
      const pts = pointsFrom([{ local: new THREE.Vector3(), color: p.color, size: 9 }], markMat());
      earth.add(pts);
      return { ...p, pts, label };
    });
    window.globeCheck = {
      THREE, camera, controls, earth, sun, moon, get sky() { return sky; }, geoToWorld, focus, flyTo,
      skyAt: (iso) => skyNow(Date.parse(iso)),
      render: () => renderNow(),
      // advance the animation by hand (for checks where animation frames do not run)
      run: (seconds, fps = 30) => { for (let i = 0; i < seconds * fps; i++) draw(1 / fps, performance.now() + i * 1000 / fps); },
    };
  }
  function updateCheck() {
    if (!checkMarks) return;
    const rect = canvas.getBoundingClientRect();
    for (const m of checkMarks) {
      const g = m.geo();
      const loc = geoToLocal(g.lat, g.lon, MARK_RADIUS);
      m.pts.geometry.attributes.position.setXYZ(0, loc.x, loc.y, loc.z);
      m.pts.geometry.attributes.position.needsUpdate = true;
      v.copy(loc).applyMatrix4(earth.matrixWorld);
      const visible = v.dot(camera.position) > v.lengthSq();
      v.project(camera);
      m.label.style.display = visible ? 'block' : 'none';
      m.label.style.left = `${(v.x + 1) / 2 * rect.width}px`;
      m.label.style.top = `${(1 - v.y) / 2 * rect.height}px`;
    }
  }

  /* ---------------------------------------------------------------- loop */

  let raf = 0, running = false, last = 0, inView = true;
  function frame(t) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, Math.max(0, (t - last) / 1000));
    last = t;
    draw(dt, t);
  }
  // one frame, also used outside the loop so a still image appears even when animation frames are held back
  function draw(dt, t = performance.now()) {
    if (shared.uAnim.value > 0) shared.uTime.value += dt;
    applySky();
    stepFlight(t);
    const dist = camera.position.length();
    controls.rotateSpeed = THREE.MathUtils.clamp(0.18 + 0.16 * (dist - 1), 0.18, 0.9);
    controls.update(dt);
    updateInfo();
    updateCheck();
    if (tip.hidden === false && hovered && tipPinned) {
      // keep a tapped tooltip with its marker as the globe moves
      v.copy(hovered.local).applyMatrix4(earth.matrixWorld);
      if (v.dot(camera.position) <= v.lengthSq()) hideTip();
    }
    renderer.render(scene, camera);
  }
  renderNow = () => draw(0);
  function start() {
    if (running) return;
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    running = false;
    cancelAnimationFrame(raf);
  }
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : inView && start()));
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      inView = entries.some((e) => e.isIntersecting);
      if (inView && !document.hidden) start(); else stop();
    }).observe(stage);
  }
  new ResizeObserver(() => layout()).observe(stage);
  compactQuery.addEventListener('change', layout);
  sideQuery.addEventListener('change', layout);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);
  reduceMotion.addEventListener('change', () => {
    shared.uAnim.value = reduceMotion.matches ? 0 : 1;
    controls.autoRotate = !reduceMotion.matches && !flight;
  });

  updateInfo();
  renderNow();
  if (!document.hidden) start();
}

main();
