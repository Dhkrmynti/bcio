import * as THREE from 'three';
import { studioScene, makeWear, tuneGold, loadCoins, DPR, LOW } from './gold.js?v=23';

// ---------- ikon starburst (dipakai di judul & kartu kaca) ----------
const rays = Array.from({ length: 18 }, (_, i) => {
  const a = (i / 18) * Math.PI * 2;
  const r = i % 2 ? 42 : 49;
  const w = 0.11;
  const p = (ang, rad) => `${(Math.cos(ang) * rad).toFixed(2)} ${(Math.sin(ang) * rad).toFixed(2)}`;
  return `M${p(a - w, 9)}L${p(a, r)}L${p(a + w, 9)}Z`;
}).join('');
document.querySelectorAll('svg.burst').forEach((s) => {
  s.innerHTML = `<path d="${rays}" fill="currentColor"/><circle r="12" fill="currentColor"/>`;
});

// ---------- three.js ----------
const card = document.getElementById('card');
const canvas = document.getElementById('stage');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: !LOW, alpha: true, powerPreference: 'high-performance' });
} catch {
  // tanpa WebGL: gambar render Blender tetap tampil
  throw new Error('WebGL tidak tersedia');
}
renderer.setPixelRatio(DPR);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(studioScene(), 0.02).texture;
const wear = makeWear();

const camera = new THREE.PerspectiveCamera(22, 1, 1, 400);
camera.position.set(0, 0, 100);

// cahaya hangat untuk kilau emas
const key = new THREE.DirectionalLight(0xffe2b0, 2.6);
key.position.set(-30, 40, 60);
key.castShadow = true;
key.shadow.mapSize.setScalar(LOW ? 1024 : 2048);
key.shadow.bias = -0.0004;
scene.add(key);
scene.add(key.target);
const rim = new THREE.DirectionalLight(0xffe2a8, 2.4);
rim.position.set(40, 10, -30);
scene.add(rim);
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a60, 0.6));

// ---------- pemetaan piksel kartu -> dunia 3D (bidang z = 0) ----------
let unit = 1; // satuan dunia per piksel CSS
const anchors = {};
function measure() {
  const r = canvas.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / r.height;
  camera.updateProjectionMatrix();
  const visH = 2 * camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  unit = visH / r.height;
  document.querySelectorAll('[data-anchor]').forEach((el) => {
    const a = el.getBoundingClientRect();
    anchors[el.dataset.anchor] = {
      x: (a.left + a.width / 2 - r.left - r.width / 2) * unit,
      y: -(a.top + a.height / 2 - r.top - r.height / 2) * unit,
      w: a.width * unit,
      h: a.height * unit,
      visible: a.width > 0,
    };
  });
}

// ---------- hiasan putih mengkilap (pegas, gelombang, cincin) ----------
const whiteMat = new THREE.MeshPhysicalMaterial({
  color: 0xf3f3f8, roughness: 0.28, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.15, sheen: 0.4,
});
function helix(turns, radius, length, tube) {
  const pts = [];
  const n = turns * 40;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = t * turns * Math.PI * 2;
    pts.push(new THREE.Vector3((t - 0.5) * length, Math.cos(a) * radius, Math.sin(a) * radius));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n, tube, 10, false);
}
function squiggle(waves, amp, tube) {
  const pts = [];
  const n = Math.round(waves * 40);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = t * waves * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.sin(a) * amp, (0.5 - t), Math.cos(a) * amp * 0.7));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n, tube, 10, false);
}
const deco = {
  spring: new THREE.Mesh(helix(3, 0.24, 1, 0.07), whiteMat),
  wave: new THREE.Mesh(squiggle(2.6, 0.2, 0.045), whiteMat),
  ring: new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.075, 24, 96), whiteMat),
};
Object.values(deco).forEach((m) => scene.add(m));

function layoutDeco() {
  const s = anchors.spring;
  deco.spring.visible = s.visible;
  deco.spring.position.set(s.x, s.y, 4);
  deco.spring.scale.setScalar(s.w);
  deco.spring.rotation.set(0.3, 0.2, -0.38);

  const w = anchors.wave;
  deco.wave.visible = w.visible;
  deco.wave.position.set(w.x, w.y, -6);
  deco.wave.scale.setScalar(w.h);
  deco.wave.rotation.set(0, 0, 0.12);

  const g = anchors.ring;
  deco.ring.visible = g.visible;
  deco.ring.position.set(g.x, g.y, 2);
  deco.ring.scale.setScalar(g.w);
  deco.ring.rotation.set(-1.15, 0.25, 0.2);
}

// ---------- bola koin dari Blender ----------
const holder = new THREE.Group(); // posisi & ukuran di halaman
const tilt = new THREE.Group();   // miring sedikit mengikuti kursor
holder.add(tilt);
scene.add(holder);
let mixer = null;
let appear = -1; // -1 = belum dimuat, 0..1 = sedang muncul
tilt.scale.setScalar(0.0001);
let ballRadius = 1;

function layoutBall() {
  const b = anchors.ball;
  holder.position.set(b.x, b.y, 0);
  holder.scale.setScalar(b.w / 2 / ballRadius);
  // kamera bayangan mengikuti bola
  const R = b.w / 2 * 1.15;
  key.target.position.set(b.x, b.y, 0);
  key.position.set(b.x - 0.45 * R * 3, b.y + 0.6 * R * 3, R * 3);
  const sc = key.shadow.camera;
  sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R;
  sc.near = 0.1; sc.far = R * 7;
  sc.updateProjectionMatrix();
  key.shadow.normalBias = R * 0.004;
}


// Gabungkan koin yang memakai geometri + material sama menjadi satu InstancedMesh.
// Ratusan koin jadi beberapa puluh panggilan gambar saja.
function instance(root) {
  root.updateMatrixWorld(true);
  const groups = new Map();
  const meshes = [];
  root.traverse((o) => { if (o.isMesh && o.name !== 'Core') meshes.push(o); });
  for (const mesh of meshes) {
    let parent = mesh.parent;
    while (parent && parent.parent !== root && parent !== root) parent = parent.parent;
    // induk animasi = anak langsung dari root (objek "CoinBall")
    const ballNode = root.children.find((c) => c.name === 'CoinBall') || root;
    const key = mesh.geometry.uuid + '|' + mesh.material.uuid;
    if (!groups.has(key)) groups.set(key, { geometry: mesh.geometry, material: mesh.material, mats: [], ballNode });
    const rel = new THREE.Matrix4().copy(ballNode.matrixWorld).invert().multiply(mesh.matrixWorld);
    groups.get(key).mats.push(rel);
  }
  for (const mesh of meshes) mesh.parent.remove(mesh);
  // koin yang terselip lebih dalam dapat cahaya lebih sedikit (oklusi sederhana)
  const pos = new THREE.Vector3();
  let rMin = Infinity, rMax = 0;
  for (const g of groups.values()) for (const m of g.mats) {
    const r = pos.setFromMatrixPosition(m).length();
    rMin = Math.min(rMin, r); rMax = Math.max(rMax, r);
  }
  // abaikan koin hero yang jauh lebih tinggi
  rMax = Math.min(rMax, rMin + (rMax - rMin) * 0.55);
  const col = new THREE.Color();
  for (const g of groups.values()) {
    const im = new THREE.InstancedMesh(g.geometry, g.material, g.mats.length);
    im.castShadow = im.receiveShadow = true;
    g.mats.forEach((mat, i) => {
      im.setMatrixAt(i, mat);
      const t = THREE.MathUtils.clamp((pos.setFromMatrixPosition(mat).length() - rMin) / (rMax - rMin), 0, 1);
      const k = 0.4 + 0.6 * Math.pow(t, 0.8);
      im.setColorAt(i, col.setRGB(k, k, k));
    });
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    g.ballNode.add(im);
  }
}

loadCoins().then((gltf) => {
  const root = gltf.scene;
  // grup HiRes = mesh detail penuh untuk section lain, tidak digambar di hero
  const hires = root.getObjectByName('HiRes');
  if (hires) hires.parent.remove(hires);
  // jari-jari = rata-rata setengah sisi kotak pembatas (bukan diagonal kotak)
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  root.position.sub(box.getCenter(new THREE.Vector3()));
  ballRadius = (size.x + size.y + size.z) / 6;
  root.traverse((o) => {
    if (o.isMesh) {
      tuneGold(o.material, wear);
      o.castShadow = o.receiveShadow = true;
    }
  });
  tilt.add(root);
  instance(root);
  if (gltf.animations.length) {
    mixer = new THREE.AnimationMixer(root);
    const action = mixer.clipAction(gltf.animations[0]);
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.play();
  }
  layoutBall();
  appear = 0; // mulai animasi muncul
});

// ---------- interaksi kursor ----------
const target = { x: 0, y: 0 };
addEventListener('pointermove', (e) => {
  target.x = (e.clientX / innerWidth - 0.5) * 2;
  target.y = (e.clientY / innerHeight - 0.5) * 2;
});

// ---------- loop ----------
let heroVisible = true;
new IntersectionObserver(([e]) => { heroVisible = e.isIntersecting; }).observe(card);
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  if (mixer && !reduced) mixer.update(dt);
  if (appear >= 0 && appear < 1) {
    appear = reduced ? 1 : Math.min(1, appear + dt / 1.1);
    const e = 1 - Math.pow(1 - appear, 3); // ease-out
    tilt.scale.setScalar(0.85 + 0.15 * e);
    canvas.style.opacity = String(e);
  }
  tilt.rotation.x += (target.y * 0.12 - tilt.rotation.x) * 0.04;
  tilt.rotation.z += (-target.x * 0.06 - tilt.rotation.z) * 0.04;
  if (!reduced) {
    deco.spring.rotation.x = 0.3 + Math.sin(t * 0.6) * 0.15;
    deco.wave.rotation.y = t * 0.3;
    deco.ring.rotation.z = 0.2 + Math.sin(t * 0.4) * 0.12;
    deco.ring.position.y = anchors.ring.y + Math.sin(t * 0.8) * 0.15;
  }
  if (heroVisible) {
    adapt(dt);
    tick++;
    if (quality < 3 || tick % 2 === 0) {
      // bola berputar pelan (20 dtk/putaran): peta bayangan cukup diperbarui tiap 3 frame (q>=2: tiap 6)
      renderHero(tick % (quality >= 2 ? 6 : 3) === 0 || appear < 1);
    }
  }
  requestAnimationFrame(frame);
}

// Depth pre-pass: koin saling menumpuk seperti sisik, jadi tanpa ini tiap piksel dihitung berkali-kali.
// Lintasan pertama hanya mengisi depth, lintasan kedua menghitung warna sekali per piksel (GPU ~2x lebih ringan).
const depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false });
function renderHero(updateShadow) {
  renderer.shadowMap.needsUpdate = false;
  scene.overrideMaterial = depthOnly;
  renderer.render(scene, camera);
  scene.overrideMaterial = null;
  renderer.shadowMap.needsUpdate = updateShadow;
  renderer.autoClear = false;
  renderer.clear(true, false, false);
  renderer.render(scene, camera);
  renderer.autoClear = true;
}

// ---------- kualitas adaptif ----------
// Ukur waktu frame; kalau perangkat tidak kuat (< ~45 fps), turunkan kualitas bertahap:
// 1 = resolusi 1x, 2 = bayangan diperbarui lebih jarang, 3 = hero digambar 30 fps.
let quality = 0, tick = 0, acc = 0, cnt = 0, warm = 0;
renderer.shadowMap.autoUpdate = false;
function adapt(dt) {
  if (appear < 1 || quality >= 3) return;
  if (warm < 30) { warm++; return; }          // abaikan frame awal (kompilasi shader dsb.)
  acc += dt; cnt++;
  if (cnt < 60) return;
  const avg = acc / cnt; acc = 0; cnt = 0;
  if (avg <= 1 / 45) return;
  quality++;
  warm = 0;
  if (quality === 1 && renderer.getPixelRatio() > 1) { renderer.setPixelRatio(1); measure(); }
}

// CRYPTO selalu memenuhi lebar baris: atur lebar huruf (sumbu wdth font Archivo)
const crypto = document.querySelector('.crypto');
function fitCrypto() {
  if (innerWidth <= 760) { crypto.style.fontStretch = ''; return; }
  const want = innerWidth * 0.892;
  let st = 91;
  for (let i = 0; i < 3; i++) {
    crypto.style.fontStretch = st + '%';
    const w = crypto.getBoundingClientRect().width;
    st = Math.max(62, Math.min(125, st * (want / w)));
  }
  crypto.style.fontStretch = st.toFixed(1) + '%';
}
document.fonts.ready.then(() => { relayout(); crypto.classList.add('ready'); });
setTimeout(() => crypto.classList.add('ready'), 2500); // cadangan kalau font lambat

function relayout() {
  fitCrypto();
  measure();
  layoutDeco();
  layoutBall();
}
new ResizeObserver(relayout).observe(card);
new ResizeObserver(relayout).observe(canvas);
relayout();
frame();

// ---------- menu: dropdown "AI agent" & menu HP ----------
const dd = document.querySelector('.dropdown');
const ddMenu = document.getElementById('agent-menu');
const setDD = (open) => { dd.setAttribute('aria-expanded', String(open)); ddMenu.hidden = !open; };
dd.addEventListener('click', (e) => { e.stopPropagation(); setDD(ddMenu.hidden); });
ddMenu.addEventListener('click', () => setDD(false));
document.addEventListener('click', (e) => { if (!ddMenu.hidden && !e.target.closest('.menu-wrap')) setDD(false); });

const burger = document.querySelector('.burger');
const mm = document.getElementById('mobile-menu');
const setMM = (open) => {
  mm.hidden = !open;
  burger.setAttribute('aria-expanded', String(open));
  document.body.style.overflow = open ? 'hidden' : '';
  if (open) mm.querySelector('.mm-close').focus(); else burger.focus();
};
burger.addEventListener('click', () => setMM(true));
mm.querySelector('.mm-close').addEventListener('click', () => setMM(false));
mm.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => setMM(false)));

addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!ddMenu.hidden) { setDD(false); dd.focus(); }
  if (!mm.hidden) setMM(false);
});
