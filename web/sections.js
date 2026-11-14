// Section di bawah hero: showcase koin, tumpukan "grow", dan hujan koin CTA.
// Semua koin diambil dari model Blender yang sama dengan hero (assets/coinball.glb).
import * as THREE from 'three';
import { studioScene, makeWear, tuneGold, loadCoins } from './gold.js?v=19';

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = THREE.MathUtils.clamp;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

// ---------- panggung: satu renderer per canvas, hanya digambar saat terlihat ----------
const stages = [];
function stage(canvas, { fov = 30, shadows = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  if (shadows) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(studioScene(), 0.02).texture;
  const camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 200);
  const st = { canvas, renderer, scene, camera, visible: false, update: null, aspect: 1, slide: canvas.closest('.slide') };
  const resize = () => {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    renderer.setSize(r.width, r.height, false);
    camera.aspect = st.aspect = r.width / r.height;
    camera.updateProjectionMatrix();
    st.onResize?.();
  };
  new ResizeObserver(resize).observe(canvas);
  new IntersectionObserver(([e]) => { st.visible = e.isIntersecting; }, { rootMargin: '100px' }).observe(canvas);
  resize();
  stages.push(st);
  return st;
}

// progres animasi sebuah slide: 0 saat slide tiba, 1 setelah `dur` detik. Slide yang tidak aktif = 0,
// jadi animasinya diputar ulang setiap kali slide itu didatangi lagi.
const arrivedAt = new Map();
function slideProgress(el, dur) {
  if (!el.classList.contains('on')) return 0;
  return clamp((performance.now() - (arrivedAt.get(el) ?? performance.now())) / (dur * 1000), 0, 1);
}
function slideAge(el) { return (performance.now() - (arrivedAt.get(el) ?? performance.now())) / 1000; }

// ---------- koin dari glTF ----------
// parts = [{ geometry, material }] untuk satu desain (3 material: bingkai, bidang, relief)
async function coinParts(gltf, key) {
  const idx = gltf.parser.json.meshes.findIndex((m) => m.name === 'Coin_' + key);
  const obj = await gltf.parser.getDependency('mesh', idx);
  const parts = [];
  obj.traverse((o) => { if (o.isMesh) parts.push({ geometry: o.geometry, material: o.material }); });
  parts.forEach((p) => tuneGold(p.material, makeWear()));
  return parts;
}

// satu koin utuh (Group). Koin di glTF berbaring (muka ke +Y); faceCamera memutarnya menghadap +Z.
function coinMesh(parts, faceCamera = false) {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  parts.forEach((p) => inner.add(new THREE.Mesh(p.geometry, p.material)));
  if (faceCamera) inner.rotation.x = Math.PI / 2;
  g.add(inner);
  return g;
}

// banyak koin desain sama dalam satu set InstancedMesh (satu per material)
function coinInstances(parts, count, { shadows = false } = {}) {
  const meshes = parts.map((p) => {
    const im = new THREE.InstancedMesh(p.geometry, p.material, count);
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.castShadow = im.receiveShadow = shadows;
    im.frustumCulled = false;
    return im;
  });
  return {
    meshes,
    set(i, m) { meshes.forEach((im) => im.setMatrixAt(i, m)); },
    commit() { meshes.forEach((im) => { im.instanceMatrix.needsUpdate = true; }); },
  };
}

const KEYS = ['BTC', 'NVDA', 'ETH', 'TSLA', 'SOL', 'QQQ', 'BNB', 'XRP'];

// =====================================================================
// 1. SHOWCASE: satu koin besar berputar dan berganti desain mengikuti scroll
// =====================================================================
function initShowcase(designs) {
  const section = document.getElementById('show');
  const st = stage(section.querySelector('canvas'), { fov: 28 });
  st.camera.position.set(0, 0, 14);
  const key = new THREE.DirectionalLight(0xffe6c0, 2.2);
  key.position.set(-4, 6, 8);
  st.scene.add(key);

  const order = ['BTC', 'NVDA', 'ETH', 'TSLA', 'SOL', 'QQQ'];
  const holder = new THREE.Group();
  st.scene.add(holder);
  const hero = order.map((k) => { const c = coinMesh(designs[k], true); c.visible = false; holder.add(c); return c; });
  hero[0].visible = true;

  // koin kecil yang melayang di sekitar
  const orbit = [];
  for (let i = 0; i < 16; i++) {
    const c = coinMesh(designs[KEYS[i % KEYS.length]], true);
    const a = (i / 16) * Math.PI * 2 + Math.random() * 0.3;
    c.userData = {
      a, r: 4.2 + Math.random() * 2.6, z: -6 + Math.random() * 7,
      s: 0.3 + Math.random() * 0.35, spin: (Math.random() - 0.5) * 1.2, tilt: Math.random() * Math.PI,
      bob: Math.random() * 6,
    };
    c.scale.setScalar(c.userData.s);
    st.scene.add(c);
    orbit.push(c);
  }

  const words = [...section.querySelectorAll('.show-word')];
  const idxEl = section.querySelector('.show-idx');
  const tagEl = section.querySelector('.show-tag');
  const bar = section.querySelector('.show-bar i');
  const n = order.length;
  let pos = 0, shown = -1;
  const mouse = { x: 0, y: 0 };
  addEventListener('pointermove', (e) => { mouse.x = e.clientX / innerWidth - 0.5; mouse.y = e.clientY / innerHeight - 0.5; });

  st.onResize = () => {
    const narrow = st.aspect < 0.8;
    holder.scale.setScalar(narrow ? 1.25 : 2.35);
    holder.userData.y = narrow ? -0.9 : 0;
    orbit.forEach((c, k) => { c.visible = !narrow || k % 2 === 0; });
  };
  st.onResize();

  let wasOn = false;
  st.update = (t, dt) => {
    // koin berganti sendiri setiap 1.8 detik selama slide tampil; mulai dari BTC tiap kali tiba
    if (!wasOn) { pos = 0; shown = -1; }
    wasOn = true;
    const target = reduced ? 0 : Math.max(0, slideAge(section) - 0.6) / 1.8;
    pos += (target - pos) * Math.min(1, dt * 6);
    const i = Math.floor(pos), f = pos - i;
    const e = smooth(0.15, 0.85, f);
    const active = (e < 0.5 ? i : i + 1) % n;
    hero.forEach((c, k) => { c.visible = k === active; });
    holder.rotation.y = Math.PI * (i + e) + (reduced ? 0 : Math.sin(t * 0.6) * 0.12) + mouse.x * 0.3;
    holder.rotation.x = -0.12 + mouse.y * 0.25;
    holder.position.y = (holder.userData.y || 0) + (reduced ? 0 : Math.sin(t * 0.9) * 0.12);

    orbit.forEach((c) => {
      const u = c.userData;
      const a = u.a + (reduced ? 0 : t * 0.06) + pos * 0.35;
      c.position.set(Math.cos(a) * u.r * (st.aspect < 0.8 ? 0.6 : 1.25), Math.sin(a) * u.r * 0.62 + Math.sin(t + u.bob) * 0.15, u.z);
      c.rotation.set(u.tilt + t * u.spin * 0.4, t * u.spin, 0);
    });

    const w = Math.round(i + e) % n;
    if (w !== shown) {
      shown = w;
      words.forEach((el, k) => el.classList.toggle('on', k === w));
      idxEl.textContent = String(w + 1).padStart(2, '0');
      tagEl.textContent = words[w].dataset.tag;
    }
    bar.style.transform = `scaleX(${(((pos % n) + 1) / n).toFixed(4)})`;
  };
  section.addEventListener('slideleave', () => { wasOn = false; });
}

// =====================================================================
// 2. GROW: tumpukan koin naik seperti grafik batang
// =====================================================================
function initGrow(designs) {
  const section = document.getElementById('grow');
  const st = stage(section.querySelector('canvas'), { fov: 30, shadows: true });
  const cam = st.camera;
  const look = new THREE.Vector3(0, 1.9, 0);

  const sun = new THREE.DirectionalLight(0xffe2b0, 2.4);
  sun.position.set(-6, 12, 7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 40 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  st.scene.add(sun);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.ShadowMaterial({ opacity: 0.55 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  st.scene.add(floor);

  // tumpukan = porsi tiap aset dalam satu basket (contoh)
  const heights = [16, 24, 12, 19, 10, 14];
  const kinds = ['NVDA', 'BTC', 'TSLA', 'ETH', 'QQQ', 'SOL'];
  const S = 0.92, T = 0.15 * S; // skala & tebal koin
  const gap = 2.15;
  const stacks = heights.map((h, j) => {
    const inst = coinInstances(designs[kinds[j]], h, { shadows: true });
    inst.meshes.forEach((m) => st.scene.add(m));
    const jit = Array.from({ length: h }, () => ({
      x: (Math.random() - 0.5) * 0.07, z: (Math.random() - 0.5) * 0.07, r: Math.random() * Math.PI * 2,
    }));
    return { inst, h, x: 0, z: 0, jit };
  });

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(), eul = new THREE.Euler();
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  let narrow = false;
  st.onResize = () => {
    narrow = st.aspect < 0.9;
    // layar sempit: tumpukan disusun diagonal ke belakang supaya muat
    const mid = (heights.length - 1) / 2;
    stacks.forEach((s, j) => {
      s.x = narrow ? (j - mid) * 0.75 + 0.45 : (j - mid) * gap;
      s.z = narrow ? (mid - j) * 1.9 : 0;
    });
    look.set(0, narrow ? 2.2 : 1.9, 0);
    cam.fov = narrow ? 46 : 30;
    cam.position.set(narrow ? 3 : 2.5, narrow ? 7.5 : 6.2, narrow ? 19 : 18.5);
    cam.updateProjectionMatrix();
    cam.lookAt(look);
  };
  st.onResize();

  let shown = 0;
  st.update = (t, dt) => {
    const p = reduced ? 1 : slideProgress(section, 3.2);
    if (p === 0) shown = 0;
    shown += (p - shown) * Math.min(1, dt * 5);
    stacks.forEach((s, j) => {
      for (let k = 0; k < s.h; k++) {
        // tiap koin jatuh ke tempatnya pada urutan sendiri
        const start = j * 0.07 + (k / 24) * 0.5;
        const a = clamp((shown - start) / 0.08, 0, 1);
        if (a <= 0) { s.inst.set(k, zero); continue; }
        const e = easeOut(a);
        const jt = s.jit[k];
        v.set(s.x + jt.x, T / 2 + k * T + (1 - e) * 2.2, s.z + jt.z);
        q.setFromEuler(eul.set((1 - e) * 0.6, jt.r + (1 - e) * 2, 0));
        sc.setScalar(S);
        s.inst.set(k, m.compose(v, q, sc));
      }
      s.inst.commit();
    });
    // kamera sedikit berputar mengikuti progres
    const ang = (narrow ? 0.12 : -0.18) + shown * (narrow ? 0.12 : 0.3) + (reduced ? 0 : Math.sin(t * 0.25) * 0.03);
    const R = Math.hypot(cam.position.x, cam.position.z);
    cam.position.x = Math.sin(ang) * R;
    cam.position.z = Math.cos(ang) * R;
    cam.lookAt(look);
  };
}

// =====================================================================
// 3. CTA: hujan koin
// =====================================================================
function initRain(designs) {
  const section = document.getElementById('start');
  const st = stage(section.querySelector('canvas'), { fov: 35 });
  st.camera.position.set(0, 0, 20);
  const key = new THREE.DirectionalLight(0xffe6c0, 2);
  key.position.set(-5, 8, 10);
  st.scene.add(key);

  const per = 5;
  const sets = KEYS.map((k) => {
    const inst = coinInstances(designs[k], per);
    inst.meshes.forEach((mm) => st.scene.add(mm));
    return inst;
  });
  let W = 14, H = 8;
  st.onResize = () => {
    const vh = 2 * Math.tan(THREE.MathUtils.degToRad(st.camera.fov / 2)) * 20;
    H = vh / 2 + 2; W = (vh * st.aspect) / 2 + 1;
  };
  st.onResize();
  // lebih banyak di kanan supaya judul di kiri tetap lega
  const rx = () => (Math.random() < 0.75 ? 0.05 + Math.random() * 0.95 : -1 + Math.random() * 1.05);
  const coins = [];
  sets.forEach((inst, si) => {
    for (let k = 0; k < per; k++) {
      coins.push({
        inst, k,
        x: rx(), y: Math.random() * 2 - 1, z: -10 + Math.random() * 11,
        vy: 1.0 + Math.random() * 1.4, s: 0.5 + Math.random() * 0.45,
        rx: Math.random() * 6, ry: Math.random() * 6,
        wx: (Math.random() - 0.5) * 2.4, wy: (Math.random() - 0.5) * 3,
      });
    }
  });
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(), eul = new THREE.Euler();
  st.update = (t, dt) => {
    const speed = reduced ? 0 : dt;
    coins.forEach((c) => {
      c.y -= (c.vy * speed) / H;
      if (c.y < -1) { c.y = 1; c.x = rx(); }
      c.rx += c.wx * speed; c.ry += c.wy * speed;
      v.set(c.x * W, c.y * H, c.z);
      q.setFromEuler(eul.set(c.rx, c.ry, 0));
      sc.setScalar(c.s);
      c.inst.set(c.k, m.compose(v, q, sc));
    });
    sets.forEach((s) => s.commit());
  };
}


// =====================================================================
// KORELASI: NVDA vs BTC. Engine menemukan jeda (lag) lalu menyejajarkannya.
// =====================================================================
function seeded(seed) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }

function initSyncChart() {
  const section = document.getElementById('sync');
  const svg = section.querySelector('.sync-chart svg');
  const lnA = svg.querySelector('.ln-a'), lnB = svg.querySelector('.ln-b');
  const lagLine = svg.querySelector('.lag-line'), lagText = svg.querySelector('.lag-text');
  const rhoEl = section.querySelector('.sync-rho'), lagEl = section.querySelector('.sync-lagv');
  const N = 140, LAG = 14, W = 1000, H = 360, dx = W / (N - 1);
  const rnd = seeded(7);
  // jalan acak dengan momentum = "harga" NVDA; BTC mengikuti dengan jeda + sedikit derau
  const w = [];
  let v = 0, y = 0;
  for (let i = 0; i < N + LAG; i++) { v = v * 0.86 + (rnd() - 0.5) * 0.9; y += v; w.push(y); }
  const a = w.slice(LAG);
  const b = w.slice(0, N).map((x) => x * 0.95 + (rnd() - 0.5) * 0.9);
  const all = [...a, ...b], lo = Math.min(...all), hi = Math.max(...all);
  const Y = (x) => H - 24 - ((x - lo) / (hi - lo)) * (H - 48);
  const path = (arr) => arr.map((x, i) => `${i ? 'L' : 'M'}${(i * dx).toFixed(1)} ${Y(x).toFixed(1)}`).join('');
  lnA.setAttribute('d', path(a));
  // b digambar sepanjang N + LAG supaya tetap penuh saat digeser ke kiri
  let nz = 0;
  const bFull = w.map((x) => { nz = nz * 0.82 + (rnd() - 0.5) * 2.2; return x * 0.95 + nz; });
  lnB.setAttribute('d', path(bFull));
  const grid = svg.querySelector('.sync-grid');
  for (let i = 1; i < 4; i++) grid.insertAdjacentHTML('beforeend', `<line x1="0" x2="${W}" y1="${(H / 4) * i}" y2="${(H / 4) * i}"/>`);
  const lenA = lnA.getTotalLength(), lenB = lnB.getTotalLength();
  lnA.style.strokeDasharray = lenA; lnB.style.strokeDasharray = lenB;

  // korelasi Pearson antara a dan b yang digeser s titik
  const corr = (s) => {
    const xs = [], ys = [];
    for (let i = 0; i < N; i++) { const j = i + s; if (j >= 0 && j < bFull.length) { xs.push(a[i]); ys.push(bFull[j]); } }
    const m = (q) => q.reduce((p, c) => p + c, 0) / q.length;
    const mx = m(xs), my = m(ys);
    let sxy = 0, sx = 0, sy = 0;
    xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sx += (x - mx) ** 2; sy += (ys[i] - my) ** 2; });
    return sxy / Math.sqrt(sx * sy);
  };
  // dalam waktu nyata b tertinggal LAG titik: mulai tergeser ke kanan, lalu disejajarkan
  const rho0 = corr(0), rho1 = corr(LAG);
  let shown = 0;
  return (t, dt) => {
    const p = reduced ? 1 : slideProgress(section, 5.5);
    if (p === 0) shown = 0;
    shown += (p - shown) * Math.min(1, dt * 6);
    const draw = smooth(0.0, 0.35, shown);
    const align = smooth(0.42, 0.78, shown);
    lnA.style.strokeDashoffset = lenA * (1 - draw);
    lnB.style.strokeDashoffset = lenB * (1 - draw);
    // b berada di x = (j - LAG) * dx saat sejajar; sebelum sejajar digeser +LAG*dx
    const off = -LAG * dx + LAG * dx * (1 - align);
    lnB.setAttribute('transform', `translate(${off.toFixed(1)} 0)`);
    const gap = LAG * dx * (1 - align);
    const xm = W * 0.62;
    lagLine.setAttribute('x1', xm); lagLine.setAttribute('x2', xm + gap);
    lagLine.setAttribute('y1', 24); lagLine.setAttribute('y2', 24);
    lagLine.style.opacity = draw * (1 - align * 0.9);
    lagText.setAttribute('x', xm + gap / 2); lagText.setAttribute('y', 14);
    lagText.textContent = align < 0.98 ? `lag ${Math.round(LAG * (1 - align))} min` : 'aligned';
    lagText.style.opacity = draw;
    const rho = draw * (rho0 + (rho1 - rho0) * align);
    rhoEl.textContent = Math.max(0, rho).toFixed(2);
    lagEl.textContent = align > 0.5 ? `${LAG} min` : '?';
    section.classList.toggle('locked', align > 0.97);
    return { draw, align };
  };
}

function initSync(designs) {
  const section = document.getElementById('sync');
  const chart = initSyncChart();
  const st = stage(section.querySelector('canvas'), { fov: 30 });
  st.camera.position.set(0, 0, 16);
  const key = new THREE.DirectionalLight(0xffe6c0, 2.2);
  key.position.set(-4, 6, 8);
  st.scene.add(key);
  const A = coinMesh(designs.NVDA, true), B = coinMesh(designs.BTC, true);
  st.scene.add(A, B);
  let hw = 6, hh = 4;
  st.onResize = () => {
    hh = Math.tan(THREE.MathUtils.degToRad(st.camera.fov / 2)) * 16;
    hw = hh * st.aspect;
    const s = st.aspect < 0.8 ? 0.68 : 1.55;
    A.scale.setScalar(s); B.scale.setScalar(s);
  };
  st.onResize();
  st.update = (t, dt) => {
    const { align } = chart(t, dt);
    const narrow = st.aspect < 0.8;
    // dua koin saling mendekat ketika korelasinya ditemukan
    const x = hw * (narrow ? 0.55 : 0.8) - align * hw * (narrow ? 0.2 : 0.2);
    const y = narrow ? -hh * 0.52 : hh * 0.4;
    A.position.set(-x, y, 0); B.position.set(x, y, 0);
    const spin = reduced ? 0 : t * 0.5;
    A.rotation.set(-0.15, 0.5 + spin + align * Math.PI, 0);
    B.rotation.set(-0.15, -0.5 - spin - align * Math.PI, 0);
  };
}

// =====================================================================
// 24/7: kalender satu minggu, 168 jam
// =====================================================================
function initAlways() {
  const section = document.getElementById('always');
  const week = section.querySelector('.week');
  const days = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  const cells = [];
  days.forEach((d, di) => {
    const row = document.createElement('div');
    row.className = 'wk-row';
    row.innerHTML = `<span class="wk-day">${d}</span>`;
    for (let h = 0; h < 24; h++) {
      const c = document.createElement('i');
      // jam bursa AS (ET) dibulatkan ke 09–16
      if (di < 5 && h >= 9 && h < 16) c.className = 'ws';
      row.appendChild(c);
      cells.push(c);
    }
    week.appendChild(row);
  });
  const hours = document.createElement('div');
  hours.className = 'wk-hours';
  hours.innerHTML = '<span></span>' + [0, 6, 12, 18].map((h) => `<b style="grid-column:${h + 2}">${String(h).padStart(2, '0')}</b>`).join('');
  week.appendChild(hours);
  const count = section.querySelector('.always-count');
  let lit = -1, shown = 0;
  return (t, dt) => {
    const p = reduced ? 1 : slideProgress(section, 4.2);
    if (p === 0) shown = 0;
    shown += (p - shown) * Math.min(1, dt * 6);
    const n = Math.round(smooth(0.05, 0.85, shown) * 168);
    if (n === lit) return;
    cells.forEach((c, i) => { c.classList.toggle('on', i < n); c.classList.toggle('now', i === n - 1 && n < 168); });
    lit = n;
    count.textContent = n;
  };
}

// =====================================================================
// AGENT: prompt diketik, 3 MCP menyala, sinyal, lalu basket siap disetujui
// =====================================================================
function initAgent() {
  const section = document.getElementById('agent');
  const typed = section.querySelector('.typed');
  const prompt = 'If TSLA beats earnings and BTC holds support, split my 1,000 USDC: 50% TSLA, 50% SOL';
  const mcps = [...section.querySelectorAll('.mcp li')];
  const signal = section.querySelector('.signal'), basket = section.querySelector('.basket');
  let shown = 0;
  return (t, dt) => {
    const p = reduced ? 1 : slideProgress(section, 7);
    if (p === 0) shown = 0;
    shown += (p - shown) * Math.min(1, dt * 6);
    typed.textContent = prompt.slice(0, Math.round(smooth(0.02, 0.3, shown) * prompt.length));
    mcps.forEach((li, i) => {
      li.classList.toggle('busy', shown > 0.32 + i * 0.08 && shown <= 0.4 + i * 0.08);
      li.classList.toggle('ok', shown > 0.4 + i * 0.08);
    });
    signal.classList.toggle('on', shown > 0.62);
    basket.classList.toggle('on', shown > 0.74);
    section.classList.toggle('ready', shown > 0.88);
  };
}

function initAgentCoins(designs) {
  const section = document.getElementById('agent');
  const st = stage(section.querySelector('canvas'), { fov: 32 });
  st.camera.position.set(0, 0, 18);
  const key = new THREE.DirectionalLight(0xffe6c0, 2);
  key.position.set(-5, 8, 10);
  st.scene.add(key);
  const list = ['TSLA', 'SOL', 'BTC', 'NVDA', 'QQQ', 'ETH', 'TSLA', 'SOL'];
  const coins = list.map((k, i) => {
    const c = coinMesh(designs[k], true);
    c.userData = { a: (i / list.length) * Math.PI * 2, s: 0.7 + (i % 3) * 0.25, z: -4 + (i % 4) * 1.5, sp: 0.2 + (i % 3) * 0.1 };
    c.scale.setScalar(c.userData.s);
    st.scene.add(c);
    return c;
  });
  const agent = initAgent();
  let hw = 8, hh = 5;
  st.onResize = () => { hh = Math.tan(THREE.MathUtils.degToRad(st.camera.fov / 2)) * 18; hw = hh * st.aspect; };
  st.onResize();
  st.update = (t, dt) => {
    agent(t, dt);
    const ready = section.classList.contains('ready');
    coins.forEach((c, i) => {
      const u = c.userData;
      const a = u.a + (reduced ? 0 : t * 0.05);
      // TSLA & SOL (dua koin pertama) mendekat ke kartu saat basket siap
      const pull = ready && i < 2 ? 0.55 : 1;
      c.position.set(Math.cos(a) * hw * 0.88 * pull, Math.sin(a) * hh * 0.8 * pull, u.z);
      c.rotation.set(0.3 + Math.sin(t * u.sp + i) * 0.4, t * u.sp * 2 + i, 0);
    });
  };
}


// =====================================================================
// Scroll biasa. Section yang setengahnya terlihat dianggap "tampil": animasi isinya
// mulai dari awal; saat keluar layar, animasinya di-reset untuk kunjungan berikutnya.
// =====================================================================
const slideIO = new IntersectionObserver((entries) => {
  for (const e of entries) {
    const el = e.target, on = e.intersectionRatio >= 0.5;
    if (on === el.classList.contains('on')) continue;
    el.classList.toggle('on', on);
    if (on) arrivedAt.set(el, performance.now());
    else el.dispatchEvent(new Event('slideleave'));
  }
}, { threshold: [0, 0.5, 1] });
document.querySelectorAll('.slide').forEach((el) => slideIO.observe(el));

const alwaysTick = initAlways();

// ---------- loop ----------
const clock = new THREE.Clock();
function loop() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  alwaysTick(t, dt);
  for (const st of stages) {
    if (!st.visible || !st.update) continue;
    st.update(t, dt);
    st.renderer.render(st.scene, st.camera);
  }
  requestAnimationFrame(loop);
}

loadCoins().then(async (gltf) => {
  const designs = {};
  for (const k of KEYS) designs[k] = await coinParts(gltf, k);
  initShowcase(designs);
  initSync(designs);
  initAgentCoins(designs);
  initGrow(designs);
  initRain(designs);
  document.body.classList.add('coins-ready');
  loop();
}).catch((err) => console.error('Koin gagal dimuat', err));
