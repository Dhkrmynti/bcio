// Bahan bersama: studio pantulan, tekstur goresan, dan setelan material emas.
// Dipakai hero (main.js) dan section di bawahnya (sections.js).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

export const COIN_URL = 'assets/coinball.glb?v=18';

// studio foto produk: ruang gelap dengan softbox terang -> emas dapat pantulan kontras
export function studioScene() {
  const s = new THREE.Scene();
  s.background = new THREE.Color(0x3a2e1f);
  const box = (w, h, x, y, z, color, k) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    s.add(m);
  };
  box(10, 6, -8, 8, 9, 0xfff3dc, 9);    // softbox utama kiri atas
  box(3, 14, 11, 1, 4, 0xffffff, 6);    // strip kanan
  box(18, 5, 0, -9, 6, 0xffcf8a, 3.5);  // pantulan hangat dari bawah
  box(6, 12, 2, 3, -12, 0xfff0d8, 4);   // rim belakang
  box(30, 30, 0, 18, 0, 0xd9d4cc, 1.2); // langit-langit redup
  box(8, 8, -12, -2, 2, 0xfff1dc, 2.5); // fill kiri
  return s;
}

// goresan halus & variasi kekasaran supaya permukaan tidak mulus seperti plastik
let wearTex = null;
export function makeWear() {
  if (wearTex) return wearTex;
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const g = c.getContext('2d');
  const img = g.createImageData(1024, 1024);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 190 + Math.random() * 40;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  g.lineCap = 'round';
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * 1024, y = Math.random() * 1024;
    const a = Math.random() * Math.PI, l = 10 + Math.random() * 90;
    g.strokeStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '120,120,120'},${0.15 + Math.random() * 0.35})`;
    g.lineWidth = 0.4 + Math.random() * 0.9;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  wearTex = new THREE.CanvasTexture(c);
  wearTex.anisotropy = 8;
  return wearTex;
}

// ---------- detail medali (gaya koin tempa) ----------
// Satu set tekstur untuk bidang koin (material GoldDark): dua garis halus, cincin manik,
// tulisan melingkar, garis radial, cincin timbul, guilloche di tengah dan serat sikat.
// Digambar sebagai peta tinggi, lalu diubah ke normal map, warna (cekungan gelap) dan kekasaran.
// UV koin: u = x/2 + 0.5, v(three) = 0.5 - y/2  ->  piksel = S/2 + x*S/2, S/2 - y*S/2.
const RING_TEXT = 'BCIO TERMINAL \u00b7 ROBINHOOD CHAIN \u00b7 STOCKS + CRYPTO \u00b7 24/7 \u00b7 ONE BASKET, ONE SIGNATURE \u00b7 ';
let medal = null;
export function medalMaps() {
  if (medal) return medal;
  const S = innerWidth < 760 ? 1024 : 2048;
  const k = S / 2;                       // 1 satuan koin = k piksel
  const hc = document.createElement('canvas');
  hc.width = hc.height = S;
  const g = hc.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, S, S);
  g.translate(k, k);
  g.scale(k, k);                         // sekarang menggambar dalam satuan koin, y ke bawah
  const shade = (v) => `rgb(${v},${v},${v})`;
  const circle = (r, w, v) => { g.strokeStyle = shade(v); g.lineWidth = w; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke(); };

  // dua garis halus dekat bingkai
  circle(0.845, 0.0045, 150);
  circle(0.830, 0.0045, 150);
  // cincin manik: kubah kecil
  const beads = 132;
  for (let i = 0; i < beads; i++) {
    const a = (i / beads) * Math.PI * 2, x = Math.cos(a) * 0.803, y = Math.sin(a) * 0.803, r = 0.0105;
    const gr = g.createRadialGradient(x - r * 0.25, y - r * 0.25, 0, x, y, r);
    gr.addColorStop(0, shade(255)); gr.addColorStop(0.7, shade(190)); gr.addColorStop(1, shade(60));
    g.fillStyle = gr;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  // tulisan melingkar, huruf disebar rata satu putaran penuh
  g.fillStyle = shade(170);
  g.font = '700 0.05px "Inter Tight", "Arial Black", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const chars = [...RING_TEXT];
  const widths = chars.map((c) => g.measureText(c).width + 0.009);
  const total = widths.reduce((a, b) => a + b, 0);
  let acc = 0;
  chars.forEach((c, i) => {
    const a = -Math.PI / 2 + ((acc + widths[i] / 2) / total) * Math.PI * 2;
    acc += widths[i];
    g.save();
    g.rotate(a);
    g.translate(0.752, 0);
    g.rotate(Math.PI / 2);
    g.fillText(c, 0, 0);
    g.restore();
  });
  circle(0.705, 0.004, 150);
  // garis radial bergantian panjang-pendek
  g.fillStyle = shade(160);
  const rays = 96;
  for (let i = 0; i < rays; i++) {
    const a = ((i + 0.5) / rays) * Math.PI * 2, r0 = 0.588, r1 = i % 2 ? 0.688 : 0.655, w = 0.0062;
    const c = Math.cos(a), s = Math.sin(a);
    g.beginPath();
    g.moveTo(c * r0 - s * w, s * r0 + c * w);
    g.lineTo(c * r1, s * r1);
    g.lineTo(c * r0 + s * w, s * r0 - c * w);
    g.fill();
  }
  // cincin timbul yang membingkai simbol
  circle(0.566, 0.02, 255);
  g.setTransform(1, 0, 0, 1, 0, 0);

  // sedikit dihaluskan supaya tepi relief punya bevel yang menangkap kilau
  const soft = document.createElement('canvas');
  soft.width = soft.height = S;
  const sg = soft.getContext('2d');
  sg.filter = `blur(${S / 1400}px)`;
  sg.drawImage(hc, 0, 0);
  const H = new Float32Array(S * S);
  const src = sg.getImageData(0, 0, S, S).data;
  // guilloche (rosette mesin bubut) di dalam cincin + serat sikat horizontal
  let streak = 0;
  for (let y = 0; y < S; y++) {
    const cy = (k - y) / k;
    for (let x = 0; x < S; x++) {
      const i = y * S + x, cx = (x - k) / k;
      let h = src[i * 4] / 255;
      const r = Math.hypot(cx, cy);
      if (r < 0.552) {
        const th = Math.atan2(cy, cx);
        const w = Math.sin(Math.PI * 2 * (r * 52 + 0.22 * Math.sin(12 * th)));
        h += 0.032 * (0.5 + 0.5 * w) * Math.min(1, (0.552 - r) * 40);
      }
      streak = streak * 0.96 + (Math.random() - 0.5) * 0.04;
      h += streak * 0.35 + (Math.random() - 0.5) * 0.006;
      H[i] = h;
    }
  }
  // cekungan: tinggi rata-rata sekitar dikurangi tinggi titik itu (bayangan perunggu di sela relief)
  const blurC = document.createElement('canvas');
  blurC.width = blurC.height = S;
  const bg = blurC.getContext('2d');
  bg.filter = `blur(${S / 220}px)`;
  bg.drawImage(soft, 0, 0);
  const B = bg.getImageData(0, 0, S, S).data;

  const nC = document.createElement('canvas'), cC = document.createElement('canvas'), rC = document.createElement('canvas');
  for (const c of [nC, cC, rC]) c.width = c.height = S;
  const nI = new ImageData(S, S), cI = new ImageData(S, S), rI = new ImageData(S, S);
  const strength = S / 90;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x, o = i * 4;
      const l = H[y * S + Math.max(0, x - 1)], rr = H[y * S + Math.min(S - 1, x + 1)];
      const u = H[Math.max(0, y - 1) * S + x], d = H[Math.min(S - 1, y + 1) * S + x];
      // +v (three) = baris bertambah; normal miring menjauhi kenaikan tinggi
      let nx = -(rr - l) * strength, ny = -(d - u) * strength, nz = 1;
      const inv = 1 / Math.hypot(nx, ny, nz);
      nI.data[o] = (nx * inv * 0.5 + 0.5) * 255;
      nI.data[o + 1] = (ny * inv * 0.5 + 0.5) * 255;
      nI.data[o + 2] = (nz * inv * 0.5 + 0.5) * 255;
      nI.data[o + 3] = 255;
      const h = src[o] / 255;
      const cav = Math.max(0, B[o] / 255 - h);
      // dekat dinding bingkai juga lebih gelap
      const cx = (x - k) / k, cy = (k - y) / k, r = Math.hypot(cx, cy);
      const wall = Math.max(0, (r - 0.84) / 0.02);
      const dark = Math.min(1, cav * 3.2 + wall * 0.5);
      cI.data[o] = 255 * (1 - dark * 0.72);
      cI.data[o + 1] = 255 * (1 - dark * 0.8);
      cI.data[o + 2] = 255 * (1 - dark * 0.88);
      cI.data[o + 3] = 255;
      // relief timbul dipoles, bidang satin, cekungan doff
      const rough = 0.34 - h * 0.2 + dark * 0.25 + (Math.random() - 0.5) * 0.05;
      rI.data[o] = rI.data[o + 1] = rI.data[o + 2] = Math.max(0, Math.min(1, rough)) * 255;
      rI.data[o + 3] = 255;
    }
  }
  nC.getContext('2d').putImageData(nI, 0, 0);
  cC.getContext('2d').putImageData(cI, 0, 0);
  rC.getContext('2d').putImageData(rI, 0, 0);
  const tex = (c, srgb) => {
    const t = new THREE.CanvasTexture(c);
    t.flipY = false;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  medal = { normal: tex(nC), color: tex(cC, true), rough: tex(rC) };
  return medal;
}

export function tuneGold(m, wear = makeWear()) {
  m.envMapIntensity = 1.5;
  m.metalness = 1;
  if (m.name === 'GoldBright') {        // bingkai & gerigi: dipoles
    m.color.setRGB(1.0, 0.66, 0.24);
    m.roughness = 0.2;
    m.roughnessMap = wear;
  } else if (m.name === 'GoldDark') {   // bidang: medali tempa (manik, garis radial, tulisan, guilloche)
    const md = medalMaps();
    m.color.setRGB(1.0, 0.68, 0.28);
    m.map = md.color;
    m.normalMap = md.normal;
    m.normalScale.set(1, 1);
    m.roughness = 1;
    m.roughnessMap = md.rough;
  } else if (m.name === 'GoldFrost') {  // relief: doff, kontras dengan bidang
    m.color.setRGB(1.0, 0.7, 0.3);
    m.roughness = 0.42;
    m.roughnessMap = wear;
  } else if (m.name === 'GoldCore') {
    m.color.setRGB(0.1, 0.055, 0.02);
    m.roughness = 0.7;
  }
  m.needsUpdate = true;
}

const draco = new DRACOLoader().setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/gltf/');
// Model dimuat sekali dan dibagi hero + section (dulu diunduh dan di-decode dua kali).
let coinsP = null;
export function loadCoins() {
  coinsP ??= new Promise((res, rej) => new GLTFLoader().setDRACOLoader(draco).load(COIN_URL, res, undefined, rej));
  return coinsP;
}

// Resolusi render: layar HP / perangkat lemah cukup 1x, desktop maksimal 1.5x (dulu 2x = 4x piksel).
const weak = matchMedia('(max-width: 760px), (pointer: coarse)').matches || (navigator.hardwareConcurrency || 8) <= 4;
export const DPR = Math.min(devicePixelRatio || 1, weak ? 1 : 1.5);
export const LOW = weak;
