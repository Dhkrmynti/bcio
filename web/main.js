import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

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
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
} catch {
  // tanpa WebGL: gambar render Blender tetap tampil
  throw new Error('WebGL tidak tersedia');
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(22, 1, 1, 400);
camera.position.set(0, 0, 100);

// cahaya hangat untuk kilau emas
const key = new THREE.DirectionalLight(0xffd99a, 3.4);
key.position.set(-30, 40, 60);
scene.add(key);
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
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n * 2, tube, 20, false);
}
function squiggle(waves, amp, tube) {
  const pts = [];
  const n = Math.round(waves * 40);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = t * waves * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.sin(a) * amp, (0.5 - t), Math.cos(a) * amp * 0.7));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n * 2, tube, 20, false);
}
const deco = {
  spring: new THREE.Mesh(helix(3, 0.24, 1, 0.07), whiteMat),
  wave: new THREE.Mesh(squiggle(2.6, 0.2, 0.045), whiteMat),
  ring: new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.075, 48, 160), whiteMat),
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
  for (const g of groups.values()) {
    const im = new THREE.InstancedMesh(g.geometry, g.material, g.mats.length);
    g.mats.forEach((mat, i) => im.setMatrixAt(i, mat));
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    g.ballNode.add(im);
  }
}

new GLTFLoader().load('assets/coinball.glb?v=15', (gltf) => {
  const root = gltf.scene;
  // jari-jari = rata-rata setengah sisi kotak pembatas (bukan diagonal kotak)
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  root.position.sub(box.getCenter(new THREE.Vector3()));
  ballRadius = (size.x + size.y + size.z) / 6;
  root.traverse((o) => {
    if (o.isMesh) {
      o.material.envMapIntensity = 1.25;
      if (o.material.name === 'GoldBright') {
        o.material.color.setRGB(1.0, 0.6, 0.16);
        o.material.roughness = 0.2;
      } else if (o.material.name === 'GoldDark') {
        o.material.color.setRGB(0.32, 0.19, 0.05);
        o.material.roughness = 0.42;
      }
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
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
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
