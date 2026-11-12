// EarthState globe engine.
//
//   import { createGlobe } from './globe/globe.js';
//   const g = await createGlobe(container, { mode: 'background' | 'explorer', linkBase: '' });
//   g.setScene('platforms');                       // camera flight + layer emphasis
//   g.setLayers({ resources: true, rd: true, consulting: false });
//   g.onPick((item) => { ... });                   // click or tap on a point
//
// The scene is drawn in an Earth-centred equatorial frame: ECI x -> +X, ECI z (north pole) -> +Y, ECI y -> -Z.
// The Earth turns about +Y by Greenwich Mean Sidereal Time, so day, night, the Sun and the Moon are where they
// really are; the Sun and Moon come from the low-precision formulas of the Astronomical Almanac.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const HALF_TURN = Math.acos(-1);
const D2R = HALF_TURN / 180;
const R2D = 180 / HALF_TURN;
const HERE = new URL('./', import.meta.url);
const asset = (p) => new URL(p, HERE).href;

const ATM_RADIUS = 1.03;
const MARK_RADIUS = 1.006;
const SUN_DIST = 60;
const MOON_DIST = 5;
const MOON_RADIUS = 0.3;

export const COLOURS = {
  resources: '#cfe6ff',
  rd: '#5fd0bd',
  consulting: '#f0a44f',
  hub: '#fff3dc',
  hubRing: '#f6d7a6',
};
const CAT = { resources: 0, rd: 1, consulting: 2, hub: 3 };
const TYPE_LABEL = { resources: 'Universities and partners', rd: 'R&D project', consulting: 'Industry project', hub: 'Team lead' };

/* scenes: whole-Earth views use frac (Earth radius as a share of the half view), regional views use span
   (degrees of the surface visible top to bottom). side places the Earth in wide frames. emph = resources, rd, consulting */
export const SCENES = {
  hero: { lat: 22, frac: 1.0, orbit: 0.3, side: 'right', emph: [1, 1, 1] },
  platforms: { geo: [51.5, 3], span: 34, side: 'right', emph: [0.22, 1, 0.22] },
  advisory: { geo: [38, 88], frac: 0.86, side: 'left', emph: [0.18, 0.25, 1] },
  network: { geo: [42, -50], frac: 0.98, side: 'right', emph: [1, 0.18, 0.18] },
  projects: { geo: [31, 111], span: 40, side: 'left', emph: [0.18, 1, 1] },
  demos: { lat: 18, frac: 0.98, orbit: 0.3, side: 'right', emph: [1, 1, 1] },
  closing: { lat: 22, frac: 0.86, orbit: 0.16, side: 'center', emph: [0.65, 0.65, 0.65] },
  world: { lat: 24, frac: 0.92, orbit: 0.3, side: 'center' },
  uk: { geo: [54.2, -2.6], span: 13, side: 'center' },
  europe: { geo: [50, 10], span: 42, side: 'center' },
  namerica: { geo: [40, -88], span: 52, side: 'center' },
  eastasia: { geo: [31, 112], span: 36, side: 'center' },
};

/* ------------------------------------------------------------------ astronomy */

const wrap360 = (x) => ((x % 360) + 360) % 360;
const wrap180 = (x) => wrap360(x + 180) - 180;

export function julianDate(ms) {
  return ms / 86400000 + 2440587.5;
}

// IAU 1982 Greenwich Mean Sidereal Time (UT1 taken as UTC), degrees.
export function gmstDeg(jd) {
  const T = (jd - 2451545.0) / 36525;
  const sec = 67310.54841 + (876600 * 3600 + 8640184.812866) * T + 0.093104 * T * T - 6.2e-6 * T * T * T;
  return wrap360(sec / 240);
}

export function sunPosition(jd) {
  const n = jd - 2451545.0;
  const L = wrap360(280.460 + 0.9856474 * n);
  const g = wrap360(357.528 + 0.9856003 * n) * D2R;
  const lam = wrap360(L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g));
  const eps = 23.439 - 0.0000004 * n;
  const l = lam * D2R, e = eps * D2R;
  const ra = Math.atan2(Math.cos(e) * Math.sin(l), Math.cos(l));
  return { lambda: lam, eps, ra: wrap360(ra * R2D), dec: Math.asin(Math.sin(e) * Math.sin(l)) * R2D };
}

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

function eqToVec(raDeg, decDeg, out = new THREE.Vector3()) {
  const a = raDeg * D2R, d = decDeg * D2R, c = Math.cos(d);
  return out.set(c * Math.cos(a), Math.sin(d), -c * Math.sin(a));
}

function geoToLocal(lat, lon, r = 1, out = new THREE.Vector3()) {
  const la = lat * D2R, lo = lon * D2R, c = Math.cos(la);
  return out.set(r * c * Math.cos(lo), r * Math.sin(la), -r * c * Math.sin(lo));
}

export function skyAt(ms) {
  const jd = julianDate(ms);
  const gmst = gmstDeg(jd);
  const sun = sunPosition(jd);
  const moon = moonPosition(jd, sun.eps);
  const sunVec = eqToVec(sun.ra, sun.dec);
  const moonVec = eqToVec(moon.ra, moon.dec);
  const elong = Math.acos(THREE.MathUtils.clamp(sunVec.dot(moonVec), -1, 1));
  return {
    ms, jd, gmst, sun, moon, sunVec, moonVec,
    illum: (1 - Math.cos(elong)) / 2,
    waxing: wrap360(moon.lambda - sun.lambda) < 180,
    subsolar: { lat: sun.dec, lon: wrap180(sun.ra - gmst) },
    sublunar: { lat: moon.dec, lon: wrap180(moon.ra - gmst) },
  };
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

// Textures are uploaded top row first (flipY off, so image bitmaps decode off the main thread),
// hence the sampling coordinate uvi = (u, 1 - v).
const earthFrag = /* glsl */`
  uniform sampler2D uDay;
  uniform sampler2D uNight;
  uniform sampler2D uElev;
  uniform float uHasNight;
  uniform float uHasElev;
  uniform vec2 uElevTexel;
  uniform float uRelief;
  uniform vec3 uSun;
  uniform vec3 uAtmo;
  uniform vec3 uTwilight;
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vW;
  void main() {
    vec2 uvi = vec2(vUv.x, 1.0 - vUv.y);
    vec3 N0 = normalize(vN);
    vec3 V = normalize(cameraPosition - vW);
    vec3 L = normalize(uSun);
    vec3 tex = texture2D(uDay, uvi).rgb;

    // relief from the elevation map: tilt the normal against the height gradient
    vec3 N = N0;
    if (uHasElev > 0.5) {
      float hW = texture2D(uElev, uvi - vec2(uElevTexel.x, 0.0)).r;
      float hE = texture2D(uElev, uvi + vec2(uElevTexel.x, 0.0)).r;
      float hN = texture2D(uElev, uvi - vec2(0.0, uElevTexel.y)).r;
      float hS = texture2D(uElev, uvi + vec2(0.0, uElevTexel.y)).r;
      float cosLat = max(sqrt(max(1.0 - N0.y * N0.y, 0.0)), 0.25);
      vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), N0) + vec3(1e-6, 0.0, 0.0));
      vec3 north = cross(N0, east);
      N = normalize(N0 - uRelief * ((hE - hW) / cosLat * east + (hN - hS) * north));
    }

    float ndl0 = dot(N0, L);
    float ndl = dot(N, L);
    float dayF = smoothstep(-0.12, 0.10, ndl0);
    float lambert = clamp(ndl0, 0.0, 1.0);
    float hill = clamp(1.0 + 2.4 * (ndl - ndl0), 0.5, 1.6);
    vec3 dayCol = tex * (0.40 + 0.95 * pow(lambert, 0.6)) * hill;

    // night: the imagery darkened and tinted blue, with city lights fading in across the terminator
    float lum = dot(tex, vec3(0.2126, 0.7152, 0.0722));
    vec3 nightCol = mix(vec3(lum), tex, 0.3) * vec3(0.055, 0.08, 0.18) * clamp(hill, 0.8, 1.2) + vec3(0.0012, 0.002, 0.0055);
    if (uHasNight > 0.5) {
      vec3 lights = max(texture2D(uNight, uvi).rgb - vec3(0.035, 0.035, 0.07), 0.0);
      float lightsF = 1.0 - smoothstep(-0.10, 0.03, ndl0);
      nightCol += lights * vec3(1.0, 0.80, 0.52) * 1.7 * lightsF;
    }
    vec3 col = mix(nightCol, dayCol, dayF);

    float tw = exp(-pow(ndl0 / 0.075, 2.0));
    col += uTwilight * tw * (0.004 + 0.08 * lum);

    // ocean glint, with the water mask read from a blurred mip level
    vec3 m = sqrt(texture2D(uDay, uvi, 3.0).rgb);
    float ocean = smoothstep(0.03, 0.10, m.b - m.r) * (1.0 - smoothstep(0.34, 0.50, m.g));
    vec3 H = normalize(L + V);
    float nh = max(dot(N0, H), 0.0);
    col += vec3(1.0, 0.93, 0.80) * (pow(nh, 160.0) * 0.30 + pow(nh, 32.0) * 0.03) * ocean * smoothstep(0.0, 0.15, ndl0);

    float rim = pow(1.0 - max(dot(N0, V), 0.0), 3.0);
    col += uAtmo * rim * smoothstep(-0.15, 0.45, ndl0) * 0.42;

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
      w = exp(-clamp((b - uR0) / (uR1 - uR0), 0.0, 1.0) * 2.6);
    }
    float glow = clamp(L / Lmax, 0.0, 1.0) * w;
    float mu = dot(normalize(P), normalize(uSun));
    float lit = smoothstep(-0.24, 0.20, mu);
    vec3 col = mix(uTwilight, uAtmo, smoothstep(-0.10, 0.25, mu)) * lit;
    col += vec3(0.010, 0.018, 0.045) * (1.0 - lit);
    col *= 1.0 + 2.5 * pow(max(dot(rd, normalize(uSun)), 0.0), 10.0);
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
    float ndl = dot(normalize(vN), normalize(uSun));
    float lit = smoothstep(-0.02, 0.10, ndl) * (0.55 + 0.45 * max(ndl, 0.0));
    gl_FragColor = vec4(vec3(alb) * vec3(1.0, 0.985, 0.96) * (lit * 1.15 + 0.012), 1.0);
    #include <colorspace_fragment>
  }`;

// markers: one draw call for every point; the category weight dims or hides a layer
const markVert = /* glsl */`
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aIdx;
  attribute float aCat;
  uniform float uPR;
  uniform float uHover;
  uniform vec4 uW;
  varying vec3 vColor;
  varying float vFade;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vec3 n = normalize(w.xyz);
    float k = dot(uW, vec4(equal(vec4(aCat), vec4(0.0, 1.0, 2.0, 3.0))));
    vFade = smoothstep(-0.02, 0.2, dot(n, normalize(cameraPosition - w.xyz))) * k;
    vColor = aColor;
    float s = aSize * (0.65 + 0.35 * k) * (abs(aIdx - uHover) < 0.5 ? 1.6 : 1.0);
    gl_PointSize = k < 0.01 ? 0.0 : s * uPR * 2.4;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const markFrag = /* glsl */`
  varying vec3 vColor;
  varying float vFade;
  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float r = length(c);
    if (r > 1.0 || vFade < 0.01) discard;
    float R = 0.40;
    float core = 1.0 - smoothstep(R - 0.05, R, r);
    float edge = smoothstep(R - 0.15, R - 0.07, r);
    vec3 dotCol = mix(vColor, vColor * 0.18, edge * 0.9);
    dotCol = mix(dotCol, vec3(1.0), (1.0 - smoothstep(0.0, R * 0.55, r)) * 0.3);
    float halo = 1.0 - smoothstep(R, 1.0, r);
    halo = halo * halo * 0.5;
    float a = max(core, halo) * vFade;
    if (a < 0.01) discard;
    gl_FragColor = vec4(mix(vColor, dotCol, core), a);
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
    float ring = 1.0 - smoothstep(0.0, 0.06, abs(r - mix(0.22, 0.96, ph)));
    float a = ring * (1.0 - ph) * 0.85 * vFade;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor, a);
    #include <colorspace_fragment>
  }`;

// faint base arcs; they draw out from the hub when a layer appears
const arcVert = /* glsl */`
  attribute float aT;
  attribute float aSeed;
  attribute float aCat;
  attribute vec3 aColor;
  uniform vec4 uW;
  uniform vec3 uReveal;
  varying float vT;
  varying float vR;
  varying float vK;
  varying vec3 vColor;
  void main() {
    vec4 sel = vec4(equal(vec4(aCat), vec4(0.0, 1.0, 2.0, 3.0)));
    vK = dot(uW, sel);
    vR = clamp(dot(uReveal, sel.xyz) * 1.5 - aSeed * 0.5, 0.0, 1.0);
    vT = aT;
    vColor = aColor;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const arcFrag = /* glsl */`
  varying float vT;
  varying float vR;
  varying float vK;
  varying vec3 vColor;
  void main() {
    if (vT > vR || vK < 0.01) discard;
    float head = exp(-pow((vR - vT) / 0.03, 2.0)) * (1.0 - step(0.999, vR));
    float a = (0.05 + 0.22 * vK) + head * 0.8 * vK;
    gl_FragColor = vec4(vColor * (1.0 + head), a);
    #include <colorspace_fragment>
  }`;

// travelling light pulses, computed on the GPU along each great circle
const pulseVert = /* glsl */`
  attribute vec3 aA;
  attribute vec3 aB;
  attribute float aOm;
  attribute float aH;
  attribute float aCat;
  attribute float aSeed;
  attribute float aLag;
  attribute float aDir;
  attribute vec3 aColor;
  uniform float uTime;
  uniform float uPR;
  uniform vec4 uW;
  uniform vec3 uReveal;
  varying vec3 vColor;
  varying float vA;
  void main() {
    vec4 sel = vec4(equal(vec4(aCat), vec4(0.0, 1.0, 2.0, 3.0)));
    float k = dot(uW, sel);
    float rev = clamp(dot(uReveal, sel.xyz) * 1.5 - aSeed * 0.5, 0.0, 1.0);
    float speed = 0.16 / (0.35 + aOm);
    float h = fract(uTime * speed + aSeed * 3.7);
    float t = h - aLag * 0.016;
    float on = step(0.0, t) * step(0.999, rev);
    t = clamp(t, 0.0, 1.0);
    float tt = aDir > 0.5 ? t : 1.0 - t;
    float so = sin(aOm);
    vec3 p = normalize((sin((1.0 - tt) * aOm) * aA + sin(tt * aOm) * aB) / so);
    p *= 1.004 + aH * sin(3.14159265 * tt);
    vec4 w = modelMatrix * vec4(p, 1.0);
    float ends = smoothstep(0.0, 0.06, t) * (1.0 - smoothstep(0.92, 1.0, t));
    vA = on * ends * k * (1.0 - aLag / 9.0);
    vColor = mix(aColor, vec3(1.0), 0.35);
    gl_PointSize = vA < 0.01 ? 0.0 : (3.2 - aLag * 0.25) * uPR;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const pulseFrag = /* glsl */`
  varying vec3 vColor;
  varying float vA;
  void main() {
    float r = length(gl_PointCoord * 2.0 - 1.0);
    if (r > 1.0 || vA < 0.01) discard;
    gl_FragColor = vec4(vColor * vA * (1.0 - smoothstep(0.1, 1.0, r)), 1.0);
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
    gl_FragColor = vec4(vColor, vBright * (1.0 - smoothstep(0.15, 1.0, r)));
    #include <colorspace_fragment>
  }`;

/* ------------------------------------------------------------------ styles for the card and label */

const CSS = `
.gl-host { overflow: hidden; }
.gl-host > canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; outline: none; }
.gl-host.gl-explorer > canvas { cursor: grab; touch-action: none; }
.gl-host.gl-explorer > canvas.gl-drag { cursor: grabbing; }
.gl-host > canvas.gl-point { cursor: pointer; }
.gl-tip { position: fixed; z-index: 40; pointer-events: none; max-width: 260px; padding: 6px 10px; border-radius: 6px;
  background: rgba(11, 14, 18, 0.92); border: 1px solid rgba(255, 255, 255, 0.12); color: #e9e7e1;
  font: 500 12.5px/1.35 Geist, Inter, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35); }
.gl-card { position: fixed; z-index: 41; width: min(320px, calc(100vw - 24px)); padding: 14px 16px 14px; border-radius: 10px;
  background: rgba(13, 17, 21, 0.95); border: 1px solid rgba(255, 255, 255, 0.12); color: #e9e7e1;
  -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px); box-shadow: 0 14px 40px rgba(0, 0, 0, 0.45);
  font: 13.5px/1.5 Geist, Inter, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; }
.gl-card[hidden], .gl-tip[hidden] { display: none; }
.gl-card .gl-kind { display: flex; align-items: center; gap: 7px; font: 500 11px/1.3 "Geist Mono", ui-monospace, Menlo, monospace;
  letter-spacing: 0.06em; text-transform: uppercase; color: #9aa4ad; margin: 0 26px 8px 0; }
.gl-card .gl-dot { width: 9px; height: 9px; border-radius: 50%; flex: none; box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.4); }
.gl-card .gl-title { font: 500 17.5px/1.25 Geist, Inter, sans-serif; letter-spacing: -0.015em; margin: 0 0 6px; color: #fff; }
.gl-card .gl-note { color: #c7cbd0; margin: 0 0 8px; }
.gl-card .gl-meta { color: #9aa4ad; font-size: 12.5px; margin: 0; }
.gl-card .gl-link { display: inline-block; margin-top: 10px; color: #f6d7a6; text-decoration: none; font-weight: 500; font-size: 13.5px; }
.gl-card .gl-link:hover { text-decoration: underline; }
.gl-card .gl-x { position: absolute; top: 8px; right: 8px; width: 28px; height: 28px; border-radius: 6px; border: 0; background: transparent;
  color: #9aa4ad; font-size: 18px; line-height: 1; cursor: pointer; }
.gl-card .gl-x:hover { color: #fff; background: rgba(255, 255, 255, 0.06); }
@media (max-width: 560px) { .gl-card { left: 12px !important; right: 12px; top: auto !important; bottom: 12px; width: auto; } }
`;

function injectStyles() {
  if (document.getElementById('gl-styles')) return;
  const s = document.createElement('style');
  s.id = 'gl-styles';
  s.textContent = CSS;
  document.head.append(s);
}

/* ------------------------------------------------------------------ texture loading */

// Decode off the main thread where possible; every texture is uploaded top row first.
async function loadTexture(src, renderer, { srgb = true } = {}) {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`${src}: ${res.status}`);
  const blob = await res.blob();
  let image;
  if (typeof createImageBitmap === 'function') {
    try {
      image = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    } catch (e) {
      try { image = await createImageBitmap(blob); } catch (e2) { image = null; }
    }
  }
  if (!image) {
    image = new Image();
    image.src = URL.createObjectURL(blob);
    await image.decode();
  }
  const tex = new THREE.Texture(image);
  tex.flipY = false;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.wrapS = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  tex.userData.size = image.width;
  return tex;
}

/* ------------------------------------------------------------------ the globe */

const reduceQuery = matchMedia('(prefers-reduced-motion: reduce)');
const coarseQuery = matchMedia('(pointer: coarse)');

export async function createGlobe(container, options = {}) {
  injectStyles();
  const opt = { mode: 'explorer', linkBase: '', card: true, scene: null, ...options };
  const background = opt.mode === 'background';
  const params = new URLSearchParams(location.search);
  const CHECK = params.has('check');
  let timeOffset = 0;
  if (CHECK && params.get('t')) {
    const t0 = Date.parse(params.get('t'));
    if (!Number.isNaN(t0)) timeOffset = t0 - Date.now();
  }
  const nowMs = () => Date.now() + timeOffset;
  const phone = coarseQuery.matches && Math.min(screen.width, screen.height) < 820;
  const desktop = window.innerWidth >= 1024 && !coarseQuery.matches;

  container.classList.add('gl-host', background ? 'gl-background' : 'gl-explorer');
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  container.prepend(canvas);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: !phone, powerPreference: 'high-performance' });
  } catch (err) {
    canvas.remove();
    container.classList.add('gl-failed');
    return null;
  }
  const maxPR = phone ? (background ? 1.25 : 1.5) : 2;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxPR));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.004, 5000);
  const reduce = () => reduceQuery.matches;
  let renderNow = () => {};
  let current = null;
  let currentName = '';
  let checkMarks = null;

  const shared = {
    uSun: { value: new THREE.Vector3(1, 0, 0) },
    uTime: { value: 0 },
    uAnim: { value: reduce() ? 0 : 1 },
    uPR: { value: renderer.getPixelRatio() },
    uAtmo: { value: new THREE.Color('#5b9fe6') },
    uTwilight: { value: new THREE.Color('#ff8b45') },
    uW: { value: new THREE.Vector4(1, 1, 1, 1) },
    uReveal: { value: new THREE.Vector3(0, 0, 0) },
  };

  /* Earth */
  const blank = (rgb) => {
    const t = new THREE.DataTexture(new Uint8Array([...rgb, 255]), 1, 1);
    t.needsUpdate = true;
    return t;
  };
  const earthMat = new THREE.ShaderMaterial({
    uniforms: {
      uDay: { value: blank([22, 36, 60]) },
      uNight: { value: blank([0, 0, 0]) },
      uElev: { value: blank([0, 0, 0]) },
      uHasNight: { value: 0 },
      uHasElev: { value: 0 },
      uElevTexel: { value: new THREE.Vector2(1.5 / 4096, 1.5 / 2048) },
      uRelief: { value: 3.2 },
      uSun: shared.uSun, uAtmo: shared.uAtmo, uTwilight: shared.uTwilight,
    },
    vertexShader: earthVert,
    fragmentShader: earthFrag,
  });
  earthMat.uniforms.uDay.value.colorSpace = THREE.SRGBColorSpace;
  const earth = new THREE.Group();
  earth.add(new THREE.Mesh(new THREE.SphereGeometry(1, phone ? 160 : 256, phone ? 80 : 128), earthMat));
  scene.add(earth);

  const texInfo = { day: null, night: null, elev: null };
  const setTex = (key, uniform, tex) => {
    const old = earthMat.uniforms[uniform].value;
    earthMat.uniforms[uniform].value = tex;
    if (old && old !== tex) old.dispose();
    texInfo[key] = `${tex.userData.size}x${tex.userData.size / 2}`;
    renderNow();
  };
  const maxTex = renderer.capabilities.maxTextureSize;
  const forced = CHECK && /^(2k|4k|8k)$/.test(params.get('tex') || '') ? params.get('tex') : null;
  const dayTarget = forced || (desktop && maxTex >= 8192 ? '8k' : maxTex >= 4096 ? '4k' : '2k');
  const nightTarget = dayTarget === '8k' && maxTex >= 16384 ? '8k' : '4k';
  (async () => {
    try {
      setTex('day', 'uDay', await loadTexture(asset('textures/earth_day_2k.jpg'), renderer));
      container.classList.add('gl-ready');
      const [elev, night] = await Promise.all([
        loadTexture(asset('textures/earth_elev_4k.jpg'), renderer, { srgb: false }).catch(() => null),
        maxTex >= 4096 ? loadTexture(asset('textures/earth_night_4k.jpg'), renderer).catch(() => null) : null,
      ]);
      if (elev) { setTex('elev', 'uElev', elev); earthMat.uniforms.uHasElev.value = 1; }
      if (night) { setTex('night', 'uNight', night); earthMat.uniforms.uHasNight.value = 1; }
      if (dayTarget !== '2k') setTex('day', 'uDay', await loadTexture(asset(`textures/earth_day_${dayTarget}.jpg`), renderer));
      if (nightTarget === '8k') {
        const n8 = await loadTexture(asset('textures/earth_night_8k.jpg'), renderer).catch(() => null);
        if (n8) setTex('night', 'uNight', n8);
      }
    } catch (e) {
      container.classList.add('gl-ready');
    }
  })();

  /* atmosphere */
  const atmo = new THREE.Mesh(
    new THREE.SphereGeometry(ATM_RADIUS, phone ? 128 : 192, phone ? 64 : 96),
    new THREE.ShaderMaterial({
      uniforms: { uSun: shared.uSun, uAtmo: shared.uAtmo, uTwilight: shared.uTwilight, uR0: { value: 1.0 }, uR1: { value: ATM_RADIUS } },
      vertexShader: atmoVert, fragmentShader: atmoFrag,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }),
  );
  atmo.renderOrder = 2;
  scene.add(atmo);

  /* Sun and Moon, silently in their true directions */
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
  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(MOON_RADIUS, 64, 32),
    new THREE.ShaderMaterial({ uniforms: { uSun: shared.uSun }, vertexShader: moonVert, fragmentShader: moonFrag }),
  );
  scene.add(moon);

  /* stars */
  {
    const N = phone ? 1400 : 2400;
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
      uniforms: { uPR: shared.uPR }, vertexShader: starVert, fragmentShader: starFrag, transparent: true, depthWrite: false,
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
  controls.minDistance = 1.06;
  controls.maxDistance = 9;
  controls.autoRotateSpeed = 0.3;
  if (background) {
    controls.enableZoom = false;
    if (coarseQuery.matches) controls.enabled = false;     // on touch screens the page scrolls; taps still pick points
    canvas.style.touchAction = coarseQuery.matches ? 'pan-y' : 'none';
  }

  /* layout and framing */
  let sideFrac = 0;          // current horizontal offset of the Earth, as a share of the width
  let sideTarget = 0;
  function sideFor(side) {
    const w = container.clientWidth, h = container.clientHeight;
    if (w < 900 || w / h < 1.15) return 0;
    return side === 'right' ? 0.2 : side === 'left' ? -0.2 : 0;
  }
  function applyView() {
    const w = Math.max(1, container.clientWidth), h = Math.max(1, container.clientHeight);
    camera.setViewOffset(w, h, -sideFrac * w, 0, w, h);
    camera.updateProjectionMatrix();
  }
  function layout() {
    const w = Math.max(1, container.clientWidth), h = Math.max(1, container.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    shared.uPR.value = renderer.getPixelRatio();
    sideTarget = current ? sideFor(current.side) : 0;
    sideFrac = sideTarget;
    applyView();
    renderNow();
  }
  function effHalf() {
    const tv = Math.tan(camera.fov * D2R / 2);
    const widthShare = 1 - 2 * Math.abs(sideTarget);
    return Math.min(Math.atan(tv), Math.atan(tv * camera.aspect * Math.max(widthShare, 0.45)));
  }
  const distForFrac = (f) => ATM_RADIUS / Math.sin(Math.min(effHalf() * f, 80 * D2R));
  const distForSpan = (spanDeg) => 1 + Math.tan(spanDeg * D2R / 2) / Math.tan(effHalf());

  /* sky */
  let sky = skyAt(nowMs());
  function applySky() {
    sky = skyAt(nowMs());
    earth.rotation.y = sky.gmst * D2R;
    shared.uSun.value.copy(sky.sunVec);
    sun.position.copy(sky.sunVec).multiplyScalar(SUN_DIST);
    moon.position.copy(sky.moonVec).multiplyScalar(MOON_DIST);
    moon.lookAt(0, 0, 0);
    earth.updateMatrixWorld();
  }
  applySky();
  const geoToWorld = (lat, lon, r = 1) => geoToLocal(lat, lon, r).applyQuaternion(earth.quaternion);

  /* camera flights */
  let flight = null;
  let resumeTimer = 0;
  const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
  const qId = new THREE.Quaternion(), qTmp = new THREE.Quaternion();

  function flyTo(dirWorld, dist, dur = 2200) {
    clearTimeout(resumeTimer);
    const toDir = dirWorld.clone().normalize();
    const maxLat = 80 * D2R;
    if (Math.abs(Math.asin(THREE.MathUtils.clamp(toDir.y, -1, 1))) > maxLat) {
      const az = Math.atan2(toDir.x, toDir.z), la = Math.sign(toDir.y) * maxLat;
      toDir.set(Math.cos(la) * Math.sin(az), Math.sin(la), Math.cos(la) * Math.cos(az));
    }
    dist = THREE.MathUtils.clamp(dist, controls.minDistance, controls.maxDistance);
    controls.autoRotate = false;
    if (reduce()) {
      camera.position.copy(toDir).multiplyScalar(dist);
      sideFrac = sideTarget;
      applyView();
      controls.update();
      afterFlight();
      return;
    }
    controls.enableDamping = false;
    controls.update();
    const fromDir = camera.position.clone().normalize();
    const angle = fromDir.angleTo(toDir);
    const d0 = camera.position.length();
    flight = {
      t0: performance.now(), dur: dur * (0.6 + 0.4 * angle / HALF_TURN), fromDir,
      q: new THREE.Quaternion().setFromUnitVectors(fromDir, toDir),
      d0, d1: dist, bump: 0.45 * (angle / HALF_TURN) * Math.max(d0, dist), s0: sideFrac,
    };
  }
  function stepFlight(t) {
    if (!flight) return;
    const k = Math.min(1, (t - flight.t0) / flight.dur), e = ease(k);
    qTmp.slerpQuaternions(qId, flight.q, e);
    const d = THREE.MathUtils.lerp(flight.d0, flight.d1, e) + flight.bump * Math.sin(HALF_TURN * e);
    camera.position.copy(flight.fromDir).applyQuaternion(qTmp).multiplyScalar(d);
    sideFrac = THREE.MathUtils.lerp(flight.s0, sideTarget, e);
    applyView();
    if (k >= 1) {
      flight = null;
      controls.enableDamping = true;
      afterFlight();
    }
  }
  function afterFlight() {
    if (current && current.orbit && !reduce()) {
      controls.autoRotateSpeed = current.orbit;
      controls.autoRotate = true;
    }
  }

  /* layer weights: visibility from setLayers, emphasis from the scene */
  const visible = [1, 1, 1];
  let emph = [1, 1, 1];
  const weight = [1, 1, 1];
  const reveal = [0, 0, 0];
  const revealTarget = [1, 1, 1];

  function setScene(name, override = {}) {
    const def = typeof name === 'string' ? SCENES[name] : name;
    if (!def) return;
    const sc = { ...def, ...override };
    if (typeof name === 'string' && name === currentName && !override.force) return;
    currentName = typeof name === 'string' ? name : '';
    current = sc;
    if (sc.emph) emph = sc.emph.slice();
    sideTarget = sideFor(sc.side);
    let dir, dist;
    if (sc.geo) {
      dir = geoToWorld(sc.geo[0], sc.geo[1]);
      dist = sc.span ? distForSpan(sc.span) : distForFrac(sc.frac || 1);
    } else {
      const p = camera.position.clone().normalize();
      const az = Math.atan2(p.x, p.z), la = (sc.lat ?? 20) * D2R;
      dir = new THREE.Vector3(Math.cos(la) * Math.sin(az), Math.sin(la), Math.cos(la) * Math.cos(az));
      dist = distForFrac(sc.frac || 1);
    }
    hidePick();
    flyTo(dir, dist);
  }

  function setLayers(obj = {}) {
    ['resources', 'rd', 'consulting'].forEach((k, i) => {
      if (obj[k] === undefined) return;
      const on = obj[k] ? 1 : 0;
      if (on && !visible[i]) { reveal[i] = 0; }
      visible[i] = on;
    });
    if (hovered && !visible[hovered.cat] && hovered.cat < 3) hidePick();
  }

  /* ---------------------------------------------------------------- data, points and arcs */

  const data = await fetch(asset('network.json')).then((r) => r.json()).catch(() => ({ hub: { lat: 52.5, lon: -1.5, place: 'United Kingdom' }, experts: [], projects: [] }));
  const hub = data.hub;
  const hubLocal = geoToLocal(hub.lat, hub.lon, MARK_RADIUS);
  const hubUnit = hubLocal.clone().normalize();
  const items = [];
  const displayPlace = (p) => (/,\s*China$/.test(p || '') ? 'China' : p);
  for (const e of data.experts || []) {
    items.push({
      cat: CAT.resources, key: 'resources', color: COLOURS.resources, d: e,
      local: geoToLocal(e.lat, e.lon, MARK_RADIUS), size: 5.5 + 2.2 * Math.sqrt(Math.max(0, (e.count || 1) - 1)),
    });
  }
  for (const p of data.projects || []) {
    const key = p.type === 'rd' ? 'rd' : 'consulting';
    items.push({ cat: CAT[key], key, color: COLOURS[key], d: p, local: geoToLocal(p.lat, p.lon, MARK_RADIUS), size: 6.5 });
  }
  const hubItem = { cat: CAT.hub, key: 'hub', color: COLOURS.hub, d: hub, local: hubLocal, size: 9 };
  const all = items.concat([hubItem]);
  all.forEach((it, i) => { it.i = i; });

  const counts = {
    resources: (data.experts || []).length,
    people: (data.experts || []).reduce((s, e) => s + (e.count || 1), 0),
    rd: (data.projects || []).filter((p) => p.type === 'rd').length,
    consulting: (data.projects || []).filter((p) => p.type !== 'rd').length,
    kinds: {},
  };
  for (const e of data.experts || []) {
    const k = counts.kinds[e.kind] || (counts.kinds[e.kind] = { places: 0, people: 0 });
    k.places += 1;
    k.people += e.count || 1;
  }

  // markers
  const markMat = (frag) => new THREE.ShaderMaterial({
    uniforms: { uPR: shared.uPR, uHover: { value: -1 }, uTime: shared.uTime, uAnim: shared.uAnim, uW: shared.uW },
    vertexShader: markVert, fragmentShader: frag || markFrag, transparent: true, depthWrite: false,
  });
  function pointsOf(list, mat) {
    const n = list.length;
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n), idx = new Float32Array(n), cat = new Float32Array(n);
    const c = new THREE.Color();
    list.forEach((it, i) => {
      pos.set([it.local.x, it.local.y, it.local.z], i * 3);
      c.set(it.color);
      col.set([c.r, c.g, c.b], i * 3);
      size[i] = it.size;
      idx[i] = it.i ?? i;
      cat[i] = it.cat;
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aIdx', new THREE.BufferAttribute(idx, 1));
    g.setAttribute('aCat', new THREE.BufferAttribute(cat, 1));
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 5;
    return pts;
  }
  const points = pointsOf(all, markMat());
  const ring = pointsOf([{ ...hubItem, color: COLOURS.hubRing, size: 20, i: -2 }], markMat(ringFrag));
  earth.add(points, ring);

  // arcs and pulses
  {
    const SEG = 80;
    const pos = [], tt = [], seed = [], cat = [], col = [];
    const pA = [], pB = [], pOm = [], pH = [], pCat = [], pSeed = [], pLag = [], pDir = [], pCol = [];
    const PULSES = phone ? 1 : 2, TRAIL = phone ? 5 : 8;
    const p = new THREE.Vector3(), q = new THREE.Vector3(), c = new THREE.Color();
    items.forEach((it, k) => {
      const b = it.local.clone().normalize();
      const om = Math.acos(THREE.MathUtils.clamp(hubUnit.dot(b), -1, 1));
      if (om < 0.6 * D2R) return;
      const h = 0.02 + 0.28 * (om / HALF_TURN);
      const so = Math.sin(om);
      const at = (t, out) => out.copy(hubUnit).multiplyScalar(Math.sin((1 - t) * om) / so)
        .addScaledVector(b, Math.sin(t * om) / so).normalize().multiplyScalar(1.004 + h * Math.sin(HALF_TURN * t));
      c.set(it.color);
      const s = (k * 0.6180339) % 1;
      for (let i = 0; i < SEG; i++) {
        const t0 = i / SEG, t1 = (i + 1) / SEG;
        at(t0, p); at(t1, q);
        pos.push(p.x, p.y, p.z, q.x, q.y, q.z);
        tt.push(t0, t1);
        seed.push(s, s);
        cat.push(it.cat, it.cat);
        col.push(c.r, c.g, c.b, c.r, c.g, c.b);
      }
      for (let n = 0; n < PULSES; n++) {
        for (let l = 0; l < TRAIL; l++) {
          pA.push(hubUnit.x, hubUnit.y, hubUnit.z);
          pB.push(b.x, b.y, b.z);
          pOm.push(om); pH.push(h); pCat.push(it.cat);
          pSeed.push((s + n / PULSES) % 1);
          pLag.push(l);
          pDir.push(it.cat === CAT.resources ? 0 : 1);     // experts flow in to the hub, projects flow out
          pCol.push(c.r, c.g, c.b);
        }
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aT', new THREE.Float32BufferAttribute(tt, 1));
    g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
    g.setAttribute('aCat', new THREE.Float32BufferAttribute(cat, 1));
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 3));
    const lines = new THREE.LineSegments(g, new THREE.ShaderMaterial({
      uniforms: { uW: shared.uW, uReveal: shared.uReveal }, vertexShader: arcVert, fragmentShader: arcFrag,
      transparent: true, depthWrite: false,
    }));
    lines.frustumCulled = false;
    lines.renderOrder = 3;
    const pg = new THREE.BufferGeometry();
    const nP = pOm.length;
    pg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(nP * 3), 3));
    pg.setAttribute('aA', new THREE.Float32BufferAttribute(pA, 3));
    pg.setAttribute('aB', new THREE.Float32BufferAttribute(pB, 3));
    pg.setAttribute('aOm', new THREE.Float32BufferAttribute(pOm, 1));
    pg.setAttribute('aH', new THREE.Float32BufferAttribute(pH, 1));
    pg.setAttribute('aCat', new THREE.Float32BufferAttribute(pCat, 1));
    pg.setAttribute('aSeed', new THREE.Float32BufferAttribute(pSeed, 1));
    pg.setAttribute('aLag', new THREE.Float32BufferAttribute(pLag, 1));
    pg.setAttribute('aDir', new THREE.Float32BufferAttribute(pDir, 1));
    pg.setAttribute('aColor', new THREE.Float32BufferAttribute(pCol, 3));
    const pulses = new THREE.Points(pg, new THREE.ShaderMaterial({
      uniforms: { uTime: shared.uTime, uPR: shared.uPR, uW: shared.uW, uReveal: shared.uReveal },
      vertexShader: pulseVert, fragmentShader: pulseFrag,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    pulses.frustumCulled = false;
    pulses.renderOrder = 4;
    earth.add(lines, pulses);
    var pulseObj = pulses;      // eslint-disable-line no-var
  }

  /* ---------------------------------------------------------------- picking, label and card */

  const v = new THREE.Vector3();
  let hovered = null;
  const pickCbs = [];
  const tip = document.createElement('div');
  tip.className = 'gl-tip';
  tip.hidden = true;
  document.body.append(tip);
  const card = document.createElement('div');
  card.className = 'gl-card';
  card.hidden = true;
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Point details');
  document.body.append(card);

  function pick(clientX, clientY, radius) {
    const rect = canvas.getBoundingClientRect();
    const mx = clientX - rect.left, my = clientY - rect.top;
    let best = null, bestD = radius;
    for (const it of all) {
      const w = it.cat === 3 ? 1 : weight[it.cat];
      if (w < 0.08) continue;
      v.copy(it.local).applyMatrix4(earth.matrixWorld);
      if (v.dot(camera.position) <= v.lengthSq() + 0.002) continue;
      v.project(camera);
      if (v.z > 1) continue;
      const sx = (v.x + 1) / 2 * rect.width, sy = (1 - v.y) / 2 * rect.height;
      const d = Math.hypot(sx - mx, sy - my) + (it.cat === 3 ? 3 : 0) + (w < 0.5 ? 4 : 0);
      if (d < bestD) { bestD = d; best = it; }
    }
    return best;
  }

  function describe(it) {
    const d = it.d;
    if (it.cat === CAT.resources) {
      return {
        kind: 'resource', type: d.kind || 'Universities and partners', title: d.kind || 'Universities and partners',
        note: displayPlace(d.place) + ((d.count || 1) > 1 ? ` · ${d.count} universities` : ''), source: '', country: displayPlace(d.place),
        count: d.count || 1, color: it.color, label: TYPE_LABEL.resources,
      };
    }
    if (it.cat === CAT.hub) {
      return { kind: 'hub', type: 'Hub', title: 'EarthState research prototypes', note: 'Developed by Dr Daguang Han\'s research team; led from the United Kingdom', source: 'EarthState', country: 'United Kingdom', color: COLOURS.hubRing, label: 'Hub', link: true };
    }
    return {
      kind: it.key, type: it.key === 'rd' ? 'R&D' : 'Industry', title: d.title, note: d.note, source: d.source || '',
      country: d.country, color: it.color, label: TYPE_LABEL[it.key], link: d.source === 'EarthState',
    };
  }

  function setHover(it) {
    hovered = it;
    points.material.uniforms.uHover.value = it ? it.i : -1;
    canvas.classList.toggle('gl-point', !!it);
  }

  function showTip(it, x, y) {
    const info = describe(it);
    tip.textContent = info.kind === 'resource' ? `${info.title} · ${info.country}` : info.title;
    tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = `${Math.min(window.innerWidth - w - 8, x + 14)}px`;
    tip.style.top = `${Math.min(window.innerHeight - h - 8, y + 14)}px`;
  }

  function showCard(it, x, y) {
    const info = describe(it);
    card.replaceChildren();
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
    const x0 = el('button', 'gl-x', '×');
    x0.type = 'button';
    x0.setAttribute('aria-label', 'Close');
    x0.addEventListener('click', hidePick);
    const kind = el('div', 'gl-kind');
    const dot = el('span', 'gl-dot');
    dot.style.background = info.color;
    kind.append(dot, document.createTextNode(info.source && info.kind !== 'hub' ? `${info.label} · ${info.source}` : info.label));
    card.append(x0, kind, el('h3', 'gl-title', info.title));
    if (info.note) card.append(el('p', 'gl-note', info.note));
    if (info.kind !== 'resource' && info.kind !== 'hub') card.append(el('p', 'gl-meta', info.country));
    if (info.kind === 'resource') card.append(el('p', 'gl-meta', 'Names are not shown.'));
    if (info.link) {
      const a = el('a', 'gl-link', 'See the platforms →');
      a.href = `${opt.linkBase}platforms/index.html`;
      card.append(a);
    }
    card.hidden = false;
    if (window.innerWidth > 560) {
      const w = card.offsetWidth, h = card.offsetHeight;
      let left = x + 16, top = y - h / 2;
      if (left + w > window.innerWidth - 12) left = x - w - 16;
      top = Math.max(12, Math.min(window.innerHeight - h - 12, top));
      card.style.left = `${Math.max(12, left)}px`;
      card.style.top = `${top}px`;
    }
  }

  function hidePick() {
    tip.hidden = true;
    card.hidden = true;
    setHover(null);
  }

  let down = null;
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || e.buttons) return;
    const it = pick(e.clientX, e.clientY, 14);
    if (it) {
      if (it !== hovered) setHover(it);
      if (card.hidden) showTip(it, e.clientX, e.clientY);
    } else if (card.hidden) {
      tip.hidden = true;
      setHover(null);
    } else {
      tip.hidden = true;
    }
  });
  canvas.addEventListener('pointerleave', () => { tip.hidden = true; if (card.hidden) setHover(null); });
  canvas.addEventListener('pointerup', (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const quick = performance.now() - down.t < 600;
    down = null;
    if (moved > 6 || !quick) return;
    const it = pick(e.clientX, e.clientY, e.pointerType === 'mouse' ? 14 : 26);
    if (!it) { hidePick(); return; }
    setHover(it);
    tip.hidden = true;
    const info = describe(it);
    if (opt.card) showCard(it, e.clientX, e.clientY);
    for (const cb of pickCbs) cb(info, e);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hidePick(); });
  if (background) window.addEventListener('scroll', () => { if (!card.hidden || !tip.hidden) hidePick(); }, { passive: true });

  controls.addEventListener('start', () => {
    flight = null;
    controls.enableDamping = true;
    controls.autoRotate = false;
    clearTimeout(resumeTimer);
    canvas.classList.add('gl-drag');
  });
  controls.addEventListener('end', () => {
    canvas.classList.remove('gl-drag');
    clearTimeout(resumeTimer);
    resumeTimer = setTimeout(() => {
      if (flight) return;
      if (background && currentName) setScene(currentName, { force: true });
      else afterFlight();
    }, background ? 5000 : 4000);
  });

  /* ---------------------------------------------------------------- loop */

  let raf = 0, running = false, last = 0, inView = true;
  function draw(dt, t = performance.now()) {
    if (shared.uAnim.value > 0) shared.uTime.value += dt;
    applySky();
    const kRate = Math.min(1, dt * 3.2);
    for (let i = 0; i < 3; i++) {
      weight[i] += (visible[i] * emph[i] - weight[i]) * (dt > 0 ? kRate : 0);
      if (reduce()) weight[i] = visible[i] * emph[i];
      reveal[i] = reduce() ? 1 : Math.min(1, reveal[i] + dt / 1.8);
    }
    shared.uW.value.set(weight[0], weight[1], weight[2], 1);
    shared.uReveal.value.set(reveal[0], reveal[1], reveal[2]);
    pulseObj.visible = shared.uAnim.value > 0;
    stepFlight(t);
    controls.rotateSpeed = THREE.MathUtils.clamp(0.12 + 0.18 * (camera.position.length() - 1), 0.08, 0.9);
    controls.update(dt);
    if (checkMarks) updateCheck();
    renderer.render(scene, camera);
  }
  function frame(t) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, Math.max(0, (t - last) / 1000));
    last = t;
    draw(dt, t);
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
    }).observe(container);
  }
  new ResizeObserver(() => layout()).observe(container);
  reduceQuery.addEventListener('change', () => {
    shared.uAnim.value = reduce() ? 0 : 1;
    if (reduce()) controls.autoRotate = false; else afterFlight();
  });

  /* ---------------------------------------------------------------- check mode (?check) */

  function updateCheck() {
    const rect = canvas.getBoundingClientRect();
    for (const m of checkMarks) {
      const g = m.geo();
      const loc = geoToLocal(g.lat, g.lon, MARK_RADIUS);
      m.pts.geometry.attributes.position.setXYZ(0, loc.x, loc.y, loc.z);
      m.pts.geometry.attributes.position.needsUpdate = true;
      v.copy(loc).applyMatrix4(earth.matrixWorld);
      const vis = v.dot(camera.position) > v.lengthSq();
      v.project(camera);
      m.label.style.display = vis ? 'block' : 'none';
      m.label.style.left = `${rect.left + (v.x + 1) / 2 * rect.width + 8}px`;
      m.label.style.top = `${rect.top + (1 - v.y) / 2 * rect.height - 8}px`;
    }
  }
  const api = {
    setScene, setLayers,
    onPick(cb) { pickCbs.push(cb); return api; },
    get counts() { return counts; },
    get data() { return data; },
    get info() { return { ...texInfo, target: dayTarget, maxTextureSize: maxTex, pixelRatio: renderer.getPixelRatio() }; },
    get scene() { return currentName; },
    pause: stop, resume: start,
    hidePick,
  };
  if (CHECK) {
    const places = [
      { name: 'Subsolar point', color: '#ffe14d', geo: () => sky.subsolar },
      { name: 'London', color: '#ff3b3b', geo: () => ({ lat: 51.5, lon: -0.13 }) },
      { name: 'Sydney', color: '#39e07a', geo: () => ({ lat: -33.87, lon: 151.21 }) },
    ];
    checkMarks = places.map((p) => {
      const label = document.createElement('div');
      label.textContent = p.name;
      label.style.cssText = 'position:fixed;z-index:39;pointer-events:none;font:11px Inter,sans-serif;padding:1px 5px;border-radius:3px;background:rgba(0,0,0,.7);color:#fff';
      document.body.append(label);
      const pts = pointsOf([{ local: new THREE.Vector3(), color: p.color, size: 9, cat: 3, i: -3 }], markMat());
      earth.add(pts);
      return { ...p, pts, label };
    });
    window.globeCheck = {
      THREE, camera, controls, earth, api, get sky() { return sky; }, geoToWorld, skyAt: (iso) => skyAt(Date.parse(iso)),
      render: () => renderNow(),
      run: (seconds, fps = 30) => { for (let i = 0; i < seconds * fps; i++) draw(1 / fps, performance.now() + i * 1000 / fps); },
    };
  }

  layout();
  // first view: the scene asked for, or the whole Earth with the hub and the day side in view
  {
    const h = geoToWorld(hub.lat, hub.lon);
    let dir = h.dot(sky.sunVec) > -0.97 ? h.clone().lerp(sky.sunVec, 0.3).normalize() : h.clone();
    const la = THREE.MathUtils.clamp(Math.asin(dir.y) * R2D, -5, 32) * D2R, az = Math.atan2(dir.x, dir.z);
    dir = new THREE.Vector3(Math.cos(la) * Math.sin(az), Math.sin(la), Math.cos(la) * Math.cos(az));
    const first = SCENES[opt.scene] || SCENES[background ? 'hero' : 'world'];
    current = first;
    currentName = opt.scene || (background ? 'hero' : 'world');
    if (first.emph) emph = first.emph.slice();
    sideTarget = sideFrac = sideFor(first.side);
    applyView();
    camera.position.copy(first.geo ? geoToWorld(first.geo[0], first.geo[1]) : dir)
      .multiplyScalar(first.span ? distForSpan(first.span) : distForFrac(first.frac || 1));
    camera.lookAt(0, 0, 0);
    controls.update();
    afterFlight();
  }
  renderNow();
  if (!document.hidden) start();
  return api;
}
