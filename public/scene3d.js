// Supreme Town in 3D. Everything in the town is still described as coloured
// boxes (world.js, presets.js, avatar.js); this file turns them into a lit 3D
// scene with shadows and neon glow, and adds the decor.
// Town coordinates (x, y, height) map to 3D as (x, height, y).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPixelatedPass } from 'three/addons/postprocessing/RenderPixelatedPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { W, H, floorColor, FLOOR_LABELS, WALL_SIGNS, TEAMS, CHAIRS, chairBoxes, vehicleBoxes, RIDES, SIT, HEAR_RADIUS } from './world.js';
import { avatarBoxes } from './avatar.js';
import { drawPoster, POSTERS } from './decor.js';

const WALL_H = 4.4;
const CAM_DIR = new THREE.Vector3(1, 1.02, 1).normalize();

export function createScene(glCanvas) {
  const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#120f26');
  scene.fog = new THREE.Fog('#120f26', 70, 190);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 400);

  // ---------- light ----------
  const hemi = new THREE.HemisphereLight('#cfd8ff', '#3a2f55', 1.15);
  scene.add(hemi);
  const glowLights = [];
  const sun = new THREE.DirectionalLight('#fff1dc', 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 120;
  for (const k of ['left', 'bottom']) sun.shadow.camera[k] = -30;
  for (const k of ['right', 'top']) sun.shadow.camera[k] = 30;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  const glowLight = (color, x, y, z, power, reach) => { const l = new THREE.PointLight(color, power, reach, 1.6); l.position.set(x, z, y); l.userData.power = power; scene.add(l); glowLights.push(l); return l; };
  glowLight('#ff3df2', 37, 31.5, 2.2, 60, 16); // the bar
  glowLight('#27e0ff', 37, 38, 2.4, 40, 14);
  glowLight('#ffd9a0', 6, 33, 2.6, 45, 14); // lounge lamps
  glowLight('#ffd9a0', 15, 33, 2.6, 45, 14);
  glowLight('#ffd9a0', 24, 33, 2.6, 45, 14);
  glowLight('#7aa2ff', 22, 12, 3.4, 60, 16); // the globe
  glowLight('#ffd24a', 51.5, 35.5, 2.4, 55, 14); // the dance floor

  // ---------- boxes ----------
  const cube = new RoundedBoxGeometry(1, 1, 1, 2, 0.06);
  const plainCube = new THREE.BoxGeometry(1, 1, 1);
  const MATS = {
    solid: new THREE.MeshStandardMaterial({ roughness: 0.72, metalness: 0.02 }),
    glow: new THREE.MeshBasicMaterial({ toneMapped: false }),
    glass: new THREE.MeshStandardMaterial({ roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.32, depthWrite: false }),
  };
  const mtx = new THREE.Matrix4(), pos = new THREE.Vector3(), scl = new THREE.Vector3(), quat = new THREE.Quaternion(), col = new THREE.Color();
  // One draw call per kind of box, however many boxes there are.
  function boxGroup(list) {
    const group = new THREE.Group();
    const kinds = { solid: [], glow: [], glass: [] };
    for (const b of list) (b.alpha !== undefined && b.alpha < 1 ? kinds.glass : b.glow ? kinds.glow : kinds.solid).push(b);
    for (const [kind, boxes] of Object.entries(kinds)) {
      if (!boxes.length) continue;
      const mesh = new THREE.InstancedMesh(kind === 'glass' ? plainCube : cube, MATS[kind], boxes.length);
      boxes.forEach((b, n) => {
        pos.set(b.x + b.w / 2, b.z + b.h / 2, b.y + b.d / 2);
        scl.set(b.w, b.h, b.d);
        mesh.setMatrixAt(n, mtx.compose(pos, quat, scl));
        col.set(b.color);
        if (kind === 'glow') col.multiplyScalar(2.4);
        mesh.setColorAt(n, col);
      });
      mesh.castShadow = kind === 'solid';
      mesh.receiveShadow = kind === 'solid';
      mesh.frustumCulled = false;
      group.add(mesh);
    }
    return group;
  }
  function clearGroup(group) {
    if (!group) return;
    scene.remove(group);
    group.traverse((o) => { if (o.isInstancedMesh) o.dispose(); });
  }
  const offset = (o) => o.boxes.map((b) => ({ ...b, x: b.x + o.x, y: b.y + o.y }));

  let staticGroup = null, deskGroup = null;
  function setStatic(objects) {
    clearGroup(staticGroup);
    const list = objects.flatMap(offset);
    for (const c of CHAIRS) list.push(...chairBoxes(c.type, c.face, c.color).map((b) => ({ ...b, x: b.x + c.x + 0.5, y: b.y + c.y + 0.5 })));
    scene.add(staticGroup = boxGroup(list));
  }
  function setDesks(objects) {
    clearGroup(deskGroup);
    scene.add(deskGroup = boxGroup(objects.flatMap(offset)));
  }

  // ---------- floor: painted once onto a texture ----------
  let floorMat; const floorTex = {}; let wallMatRef;
  {
    const px = 40;
    const c = document.createElement('canvas');
    c.width = W * px; c.height = H * px;
    const g = c.getContext('2d');
    for (let i = 0; i < W; i++) for (let j = 0; j < H; j++) { g.fillStyle = floorColor(i, j); g.fillRect(i * px, j * px, px, px); }
    g.strokeStyle = 'rgba(0,0,0,0.05)'; g.lineWidth = 1;
    for (let i = 0; i <= W; i += 2) { g.beginPath(); g.moveTo(i * px, 0); g.lineTo(i * px, H * px); g.stroke(); }
    for (let j = 0; j <= H; j += 2) { g.beginPath(); g.moveTo(0, j * px); g.lineTo(W * px, j * px); g.stroke(); }
    g.textBaseline = 'top';
    for (const l of FLOOR_LABELS) {
      g.font = `800 ${l.size * (px / 32) * 1.5}px system-ui, sans-serif`;
      g.fillStyle = l.color;
      g.globalAlpha = l.glow ? 1 : 0.7;
      if (l.glow) { g.shadowColor = l.color; g.shadowBlur = 24; }
      g.fillText(l.text, l.x * px, l.y * px);
      g.shadowBlur = 0; g.globalAlpha = 1;
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.05 }));
    // the 8-bit floor: plain tiles with a grid, and no painted words (they turn to mush in big pixels)
    const rc = document.createElement('canvas'); rc.width = W * 16; rc.height = H * 16;
    const rg = rc.getContext('2d');
    for (let i = 0; i < W; i++) for (let j = 0; j < H; j++) {
      rg.fillStyle = floorColor(i, j); rg.fillRect(i * 16, j * 16, 16, 16);
      rg.fillStyle = 'rgba(0,0,0,0.13)'; rg.fillRect(i * 16, j * 16 + 15, 16, 1); rg.fillRect(i * 16 + 15, j * 16, 1, 16);
      rg.fillStyle = 'rgba(255,255,255,0.12)'; rg.fillRect(i * 16, j * 16, 16, 1);
    }
    const rtex = new THREE.CanvasTexture(rc);
    rtex.colorSpace = THREE.SRGBColorSpace; rtex.magFilter = THREE.NearestFilter; rtex.minFilter = THREE.NearestFilter; rtex.generateMipmaps = false;
    floorTex.modern = tex; floorTex['8bit'] = rtex; floorMat = floor.material;
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(W / 2, 0, H / 2);
    floor.receiveShadow = true;
    scene.add(floor);
    // the town floats on a dark slab with a neon edge
    const slab = new THREE.Mesh(new THREE.BoxGeometry(W + 0.6, 1.2, H + 0.6), new THREE.MeshStandardMaterial({ color: '#1b1830', roughness: 0.9 }));
    slab.position.set(W / 2, -0.62, H / 2);
    scene.add(slab);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(W + 0.7, 0.08, H + 0.7), new THREE.MeshBasicMaterial({ color: new THREE.Color('#8b5cf6').multiplyScalar(1.5), toneMapped: false }));
    edge.position.set(W / 2, -0.08, H / 2);
    scene.add(edge);
  }

  // ---------- walls, windows, signs and posters ----------
  function textTexture(text, color, size = 96, weight = 800) {
    const c = document.createElement('canvas');
    const g = c.getContext('2d');
    g.font = `${weight} ${size}px system-ui, sans-serif`;
    c.width = Math.ceil(g.measureText(text).width) + 60; c.height = Math.ceil(size * 1.5);
    g.font = `${weight} ${size}px system-ui, sans-serif`;
    g.textBaseline = 'middle';
    g.shadowColor = color; g.shadowBlur = 22;
    g.fillStyle = color;
    g.fillText(text, 30, c.height / 2);
    g.fillText(text, 30, c.height / 2);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return { tex, aspect: c.width / c.height };
  }
  // A flat picture standing in the town. side: 'A' (on the y = 0 wall), 'B' (on the x = 0 wall) or 'free' (facing the camera).
  function panel(tex, side, along, zMid, width, height, glow = true, out = 0.06, at = 0, gain = 1.2) {
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: !glow });
    if (glow) mat.color.multiplyScalar(gain);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
    if (side === 'A') mesh.position.set(along + width / 2, zMid, out);
    else if (side === 'B') { mesh.rotation.y = Math.PI / 2; mesh.position.set(out, zMid, along - width / 2); }
    else { mesh.rotation.y = Math.PI / 4; mesh.position.set(along, zMid, at); }
    scene.add(mesh);
    return mesh;
  }
  function neon(text, color, side, along, zMid, height, at) {
    const { tex, aspect } = textTexture(text, color);
    // small free-standing signs get less glow so they stay readable
    return panel(tex, side, along, zMid, height * aspect, height, true, 0.08, at, side === 'free' ? 1.15 : 2.0);
  }
  {
    const wallMat = wallMatRef = new THREE.MeshStandardMaterial({ color: '#2a2d44', roughness: 0.85 });
    const a = new THREE.Mesh(new THREE.BoxGeometry(W + 0.4, WALL_H, 0.4), wallMat);
    a.position.set(W / 2 - 0.2, WALL_H / 2, -0.2);
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.4, WALL_H, H), wallMat);
    b.position.set(-0.2, WALL_H / 2, H / 2);
    a.receiveShadow = b.receiveShadow = true;
    scene.add(a, b);
    // a strip of light along the bottom of both walls
    const strip = new THREE.MeshBasicMaterial({ color: new THREE.Color('#8b5cf6').multiplyScalar(1.6), toneMapped: false });
    const sa = new THREE.Mesh(new THREE.BoxGeometry(W, 0.06, 0.05), strip); sa.position.set(W / 2, 0.1, 0.03);
    const sb = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, H), strip); sb.position.set(0.03, 0.1, H / 2);
    scene.add(sa, sb);

    // windows onto a dusk skyline
    const wc = document.createElement('canvas'); wc.width = 256; wc.height = 256;
    const g = wc.getContext('2d');
    const sky = g.createLinearGradient(0, 0, 0, 256);
    sky.addColorStop(0, '#2b2f77'); sky.addColorStop(0.55, '#b0569e'); sky.addColorStop(1, '#ffb37a');
    g.fillStyle = sky; g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#1a1838';
    for (let x = 0, n = 0; x < 256; n++) { const w = 18 + ((n * 37) % 26), h = 50 + ((n * 53) % 110); g.fillRect(x, 256 - h, w, h); g.fillStyle = '#ffd98a'; for (let k = 0; k < 4; k++) g.fillRect(x + 4 + ((k * 7) % (w - 8)), 256 - h + 10 + k * 14, 3, 4); g.fillStyle = '#1a1838'; x += w + 3; }
    g.fillStyle = '#12142a'; g.fillRect(124, 0, 8, 256);
    const winTex = new THREE.CanvasTexture(wc); winTex.colorSpace = THREE.SRGBColorSpace;
    const win = (side, along, width) => panel(winTex, side, along, 1.5, width, 2.0, false, 0.02);
    for (const t of TEAMS.filter((x) => x.top)) { win('A', t.ox + 0.4, 3.2); win('A', t.ox + 8.2, 3.2); }
    for (const y of [8.2, 19.5, 24.5]) win('B', y, 3.2);

    for (const s of WALL_SIGNS) neon(s.text, s.color, 'A', s.x, 3.1, 0.62);
    neon('SUPREME TOWN', '#b79bff', 'B', 16.5, 3.45, 1.5);

    // posters and screens: the marketing and life sciences decor
    const poster = (name, side, along, zMid, width, height) => {
      const c = document.createElement('canvas'); c.width = 640; c.height = Math.round(640 * height / width);
      drawPoster(name, c);
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
      const frame = new THREE.Mesh(new THREE.BoxGeometry(side === 'A' ? width + 0.16 : 0.06, height + 0.16, side === 'A' ? 0.06 : width + 0.16), new THREE.MeshStandardMaterial({ color: '#0f1020', roughness: 0.4 }));
      if (side === 'A') frame.position.set(along + width / 2, zMid, 0.03); else frame.position.set(0.03, zMid, along - width / 2);
      scene.add(frame);
      panel(tex, side, along, zMid, width, height, name !== 'whiteboard', 0.07); // the whiteboard is paper, not a screen: no glow
    };
    TEAMS.filter((x) => x.top).forEach((t, n) => poster(POSTERS[n], 'A', t.ox + 4.2, 1.5, 3.4, 1.9));
    poster('whiteboard', 'A', 41, 1.6, 3.6, 1.9);
    poster('world', 'B', 43, 2.9, 6, 2.4);
    poster('lifesci', 'B', 36, 2.9, 5, 2.4);
    poster('funnel', 'B', 30.2, 2.9, 3.6, 2.4);
    poster('molecule', 'B', 4.4, 1.9, 3, 3);
  }

  // ---------- centrepieces ----------
  const spinners = [];
  const plinth = (x, y, w = 1) => {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.48, w * 0.5, 0.5, 32), new THREE.MeshStandardMaterial({ color: '#1b1830', roughness: 0.4, metalness: 0.3 }));
    p.position.set(x, 0.25, y); p.castShadow = p.receiveShadow = true; scene.add(p);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(w * 0.5, 0.03, 8, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color('#27e0ff').multiplyScalar(1.6), toneMapped: false }));
    ring.rotation.x = Math.PI / 2; ring.position.set(x, 0.5, y); scene.add(ring);
  };
  function addDecor(d) {
    const cx = d.x + d.w / 2, cy = d.y + d.d / 2;
    if (d.decor === 'globe') {
      plinth(cx, cy, 2);
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.SphereGeometry(1.05, 40, 28), new THREE.MeshStandardMaterial({ color: '#16307a', roughness: 0.35, metalness: 0.2, emissive: '#0a1a55', emissiveIntensity: 0.6 })));
      g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(1.08, 2), new THREE.MeshBasicMaterial({ color: new THREE.Color('#5fd0ff').multiplyScalar(1.3), wireframe: true, toneMapped: false, transparent: true, opacity: 0.55 })));
      const pinGeo = new THREE.SphereGeometry(0.055, 10, 8);
      const pinMats = ['#ff3df2', '#ffd24a', '#39ff9c'].map((c) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(1.8), toneMapped: false }));
      for (let n = 0; n < 34; n++) { // offices everywhere: we're taking over the world
        const lat = Math.asin(((n * 0.618) % 1) * 1.7 - 0.85), lon = n * 2.4;
        const pin = new THREE.Mesh(pinGeo, pinMats[n % 3]);
        pin.position.set(Math.cos(lat) * Math.cos(lon) * 1.09, Math.sin(lat) * 1.09, Math.cos(lat) * Math.sin(lon) * 1.09);
        g.add(pin);
      }
      g.position.set(cx, 2.0, cy); g.rotation.z = 0.35;
      scene.add(g); spinners.push({ o: g, speed: 0.25 });
      const halo = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.025, 8, 80), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff3df2').multiplyScalar(1.6), toneMapped: false }));
      halo.position.set(cx, 2.0, cy); halo.rotation.x = 1.1; scene.add(halo); spinners.push({ o: halo, speed: -0.4, axis: 'z' });
      neon('TAKING OVER THE WORLD', '#ffd24a', 'free', cx, 3.9, 0.55, cy);
    } else if (d.decor === 'dna') {
      plinth(cx, cy, 1);
      const g = new THREE.Group();
      const ball = new THREE.SphereGeometry(0.085, 12, 10);
      const m1 = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff3df2').multiplyScalar(1.5), toneMapped: false });
      const m2 = new THREE.MeshBasicMaterial({ color: new THREE.Color('#27e0ff').multiplyScalar(1.5), toneMapped: false });
      const rungMat = new THREE.MeshStandardMaterial({ color: '#e8eef5', roughness: 0.4 });
      for (let n = 0; n < 22; n++) {
        const a = n * 0.5, h = n * 0.115;
        const s1 = new THREE.Mesh(ball, m1), s2 = new THREE.Mesh(ball, m2);
        s1.position.set(Math.cos(a) * 0.3, h, Math.sin(a) * 0.3); s2.position.set(-Math.cos(a) * 0.3, h, -Math.sin(a) * 0.3);
        const rung = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.025, 0.025), rungMat);
        rung.position.set(0, h, 0); rung.rotation.y = -a;
        g.add(s1, s2, rung);
      }
      g.position.set(cx, 0.65, cy);
      scene.add(g); spinners.push({ o: g, speed: 0.7 });
      neon(d.label || 'LIFE SCIENCES', '#39ff9c', 'free', cx, 3.5, 0.3, cy);
    } else if (d.decor === 'rocket') {
      plinth(cx, cy, 1);
      const g = new THREE.Group();
      const white = new THREE.MeshStandardMaterial({ color: '#f4f6f9', roughness: 0.35, metalness: 0.2 });
      const red = new THREE.MeshStandardMaterial({ color: '#ef4d5a', roughness: 0.4 });
      const bodyM = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 1.3, 24), white); bodyM.position.y = 1.05;
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.55, 24), red); nose.position.y = 1.97;
      const port = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color('#27e0ff').multiplyScalar(1.5), toneMapped: false })); port.position.set(0.19, 1.3, 0.19);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.5, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb020').multiplyScalar(1.8), toneMapped: false })); flame.position.y = 0.16; flame.rotation.x = Math.PI;
      g.add(bodyM, nose, port, flame);
      for (let k = 0; k < 3; k++) { const fin = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.45, 0.3), red); const a = k * 2.094; fin.position.set(Math.cos(a) * 0.33, 0.55, Math.sin(a) * 0.33); fin.rotation.y = -a + Math.PI / 2; g.add(fin); }
      g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      g.position.set(cx, 0.6, cy);
      scene.add(g); spinners.push({ o: g, bob: 0.12 });
      neon('GROWTH', '#ff7a59', 'free', cx, 3.6, 0.3, cy);
    }
  }

  // happy little lights drifting up through the air
  const motes = (() => {
    const n = 420, p = new Float32Array(n * 3), c = new Float32Array(n * 3);
    const palette = ['#ff3df2', '#27e0ff', '#ffd24a', '#39ff9c', '#b79bff'].map((x) => new THREE.Color(x));
    for (let i = 0; i < n; i++) {
      p[i * 3] = Math.random() * (W + 10) - 5; p[i * 3 + 1] = Math.random() * 9; p[i * 3 + 2] = Math.random() * (H + 10) - 5;
      palette[i % 5].toArray(c, i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.11, vertexColors: true, transparent: true, opacity: 0.85, toneMapped: false, depthWrite: false }));
    scene.add(pts);
    return pts;
  })();

  // ---------- markers on the floor ----------
  const flat = (geo, color, opacity) => { const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, toneMapped: false })); m.rotation.x = -Math.PI / 2; m.visible = false; scene.add(m); return m; };
  const hoverMark = flat(new THREE.PlaneGeometry(1, 1), '#ffffff', 0.28);
  const goalMark = flat(new THREE.RingGeometry(0.28, 0.42, 32), '#b79bff', 0.95);
  const hearRing = flat(new THREE.RingGeometry(HEAR_RADIUS - 0.06, HEAR_RADIUS, 96), '#b79bff', 0.55);
  const hearFill = flat(new THREE.CircleGeometry(HEAR_RADIUS, 64), '#8b5cf6', 0.06);
  function setMarkers({ hover, goal, hear }) {
    hoverMark.visible = !!hover;
    if (hover) { hoverMark.scale.set(hover.w, hover.d, 1); hoverMark.position.set(hover.x + hover.w / 2, 0.03, hover.y + hover.d / 2); }
    goalMark.visible = !!goal;
    if (goal) goalMark.position.set(goal[0] + 0.5, 0.04, goal[1] + 0.5);
    hearRing.visible = hearFill.visible = !!hear;
    if (hear) {
      const k = (hear[2] || HEAR_RADIUS) / HEAR_RADIUS;
      hearRing.scale.set(k, k, 1); hearFill.scale.set(k, k, 1);
      hearRing.position.set(hear[0], 0.035, hear[1]); hearFill.position.set(hear[0], 0.03, hear[1]);
    }
  }

  // ---------- people ----------
  const people = new Map(); // id -> { group, key, facing }
  const matCache = new Map();
  const matFor = (b) => {
    const key = (b.glow ? 'g' : 's') + b.color;
    let m = matCache.get(key);
    if (!m) {
      m = b.glow ? new THREE.MeshBasicMaterial({ color: new THREE.Color(b.color).multiplyScalar(2.4), toneMapped: false })
        : new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.7 });
      matCache.set(key, m);
    }
    return m;
  };
  const ANGLE = { 'y+': 0, 'x+': Math.PI / 2, 'y-': Math.PI, 'x-': -Math.PI / 2 };
  function buildPerson(p, chair) {
    const group = new THREE.Group();
    const lift = p.ride ? RIDES[p.ride].lift : 0;
    const boxes = avatarBoxes(p.look, 'y+', 0, p.item, chair ? SIT[chair.type] : null, true).map((b) => ({ ...b, z: b.z + lift }));
    if (p.ride) boxes.push(...vehicleBoxes(p.ride, 'y'));
    for (const b of boxes) {
      const mesh = new THREE.Mesh(cube, matFor(b));
      mesh.position.set(b.x + b.w / 2, b.z + b.h / 2, b.y + b.d / 2);
      mesh.scale.set(b.w, b.h, b.d);
      mesh.castShadow = !b.glow;
      group.add(mesh);
    }
    return group;
  }
  // players: iterable of people. chairOf(p) says which chair they are sitting in, if any.
  function syncPeople(players, chairOf, dt, time) {
    const seen = new Set();
    for (const p of players) {
      seen.add(p.id);
      const chair = chairOf(p);
      const key = JSON.stringify([p.look, p.item, p.ride, chair?.type, p.meeting]);
      let e = people.get(p.id);
      if (!e || e.key !== key) {
        if (e) scene.remove(e.group);
        e = { group: buildPerson(p, chair), key, angle: e?.angle ?? ANGLE[p.f] ?? 0 };
        scene.add(e.group);
        people.set(p.id, e);
      }
      const target = ANGLE[chair ? chair.face : p.f] ?? 0;
      let diff = target - e.angle;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      e.angle += diff * Math.min(1, dt * 14);
      e.group.rotation.y = e.angle;
      const moving = p.step > 0 && !chair;
      const bob = moving && !p.ride ? Math.abs(Math.sin(p.step)) * 0.07 : p.ride === 'hoverboard' ? 0.05 + Math.sin(time * 3) * 0.03 : 0;
      e.group.position.set(chair ? chair.x + 0.5 : p.x, bob, chair ? chair.y + 0.5 : p.y);
      e.group.rotation.z = moving && !p.ride ? Math.sin(p.step) * 0.05 : 0;
    }
    for (const [id, e] of people) if (!seen.has(id)) { scene.remove(e.group); people.delete(id); }
  }

  // ---------- camera, picking and drawing ----------
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.6, 1.0);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // The 8-bit look, in the spirit of classic top-down pixel games: seen straight
  // on from the front, crisp big pixels, dark outlines, flat bright colour.
  // No glow, no floating lights, no dither, and the picture is snapped to the
  // pixel grid so it stays sharp and still as the camera moves.
  const PIXEL = 3; // size of one "pixel" on screen
  const ELEV = 0.96; // how steeply the 8-bit camera looks down (about 55 degrees)
  const RETRO_DIR = new THREE.Vector3(0, Math.sin(ELEV), Math.cos(ELEV));
  const orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.5, 400);
  const retro = new EffectComposer(renderer);
  retro.addPass(new RenderPixelatedPass(PIXEL * renderer.getPixelRatio(), scene, orthoCam, { normalEdgeStrength: 0.25, depthEdgeStrength: 0.9 }));
  retro.addPass(new OutputPass());
  retro.addPass(new ShaderPass({ // a smaller, flatter set of colours
    uniforms: { tDiffuse: { value: null }, levels: { value: 12 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform sampler2D tDiffuse; uniform float levels; varying vec2 vUv;
      void main() {
        vec3 c = texture2D(tDiffuse, vUv).rgb;
        gl_FragColor = vec4(floor(c * levels + 0.5) / levels, 1.0);
      }`,
  }));
  let lookName = 'modern';
  function setLook(name) {
    lookName = name === '8bit' ? '8bit' : 'modern';
    const r = lookName === '8bit';
    motes.visible = !r;
    scene.background.set(r ? '#6dbb5e' : '#120f26'); // grass outside, instead of night sky
    scene.fog.near = r ? 1e5 : 70; scene.fog.far = r ? 1e6 : 190;
    hemi.intensity = r ? 2.3 : 1.15;
    sun.intensity = r ? 1.5 : 2.2;
    sun.castShadow = !r;
    for (const l of glowLights) l.intensity = l.userData.power * (r ? 0.12 : 1);
    wallMatRef.color.set(r ? '#e6d2ac' : '#2a2d44');
    floorMat.map = floorTex[lookName]; floorMat.needsUpdate = true;
    renderer.toneMappingExposure = r ? 1.0 : 0.92;
    glCanvas.style.imageRendering = r ? 'pixelated' : 'auto';
  }
  const activeCam = () => (lookName === '8bit' ? orthoCam : camera);

  let cw = 1, ch = 1;
  function resize() {
    cw = innerWidth; ch = innerHeight;
    renderer.setSize(cw, ch, false);
    composer.setSize(cw, ch);
    retro.setSize(cw, ch);
    camera.aspect = cw / ch;
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);
  resize();

  const look = new THREE.Vector3(), v = new THREE.Vector3();
  function render(target, distance, time) {
    if (lookName === '8bit') {
      const span = distance * 0.36; // how many tiles fit top to bottom
      const unit = span / (ch / PIXEL); // the size of one big pixel in the town
      const uy = unit / Math.sin(ELEV);
      look.set(Math.round(target.x / unit) * unit, 0.9, Math.round(target.y / uy) * uy);
      orthoCam.top = span / 2; orthoCam.bottom = -span / 2;
      orthoCam.right = span / 2 * (cw / ch); orthoCam.left = -orthoCam.right;
      orthoCam.updateProjectionMatrix();
      orthoCam.position.copy(look).addScaledVector(RETRO_DIR, 90);
      orthoCam.lookAt(look);
    } else {
      look.set(target.x, 0.9, target.y);
      camera.position.copy(look).addScaledVector(CAM_DIR, distance);
      camera.lookAt(look);
    }
    sun.target.position.copy(look);
    sun.position.set(look.x - 16, 34, look.z + 9);
    for (const s of spinners) {
      if (s.bob) s.o.position.y = 0.6 + Math.sin(time * 1.6) * s.bob;
      else if (s.axis === 'z') s.o.rotation.z = time * s.speed;
      else s.o.rotation.y = time * s.speed;
    }
    const arr = motes.geometry.attributes.position.array;
    for (let i = 1; i < arr.length; i += 3) { arr[i] += 0.004 + (i % 7) * 0.0006; if (arr[i] > 9) arr[i] = 0; }
    motes.geometry.attributes.position.needsUpdate = true;
    (lookName === '8bit' ? retro : composer).render();
  }
  // Where a point in the town lands on screen.
  function screenOf(x, y, z) {
    v.set(x, z, y).project(activeCam());
    return { x: (v.x + 1) / 2 * cw, y: (1 - v.y) / 2 * ch, visible: v.z < 1 && v.x > -1.15 && v.x < 1.15 && v.y > -1.2 && v.y < 1.2 };
  }
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function castRay(clientX, clientY) {
    ndc.set(clientX / cw * 2 - 1, -(clientY / ch) * 2 + 1);
    ray.setFromCamera(ndc, activeCam());
    return ray.ray;
  }
  // The floor position under the mouse.
  function groundAt(clientX, clientY) {
    const r = castRay(clientX, clientY);
    if (r.direction.y >= -1e-4) return null;
    const t = -r.origin.y / r.direction.y;
    return [r.origin.x + r.direction.x * t, r.origin.z + r.direction.z * t];
  }
  // The nearest thing under the mouse, from a list of { x, y, w, d, top }.
  function pick(objects, clientX, clientY) {
    const r = castRay(clientX, clientY);
    let best = null, bestT = Infinity;
    for (const o of objects) {
      let t0 = 0, t1 = Infinity, hit = true;
      for (const [org, dir, lo, hi] of [[r.origin.x, r.direction.x, o.x, o.x + o.w], [r.origin.y, r.direction.y, 0, o.top], [r.origin.z, r.direction.z, o.y, o.y + o.d]]) {
        if (Math.abs(dir) < 1e-8) { if (org < lo || org > hi) { hit = false; break; } continue; }
        const a = (lo - org) / dir, b = (hi - org) / dir;
        t0 = Math.max(t0, Math.min(a, b)); t1 = Math.min(t1, Math.max(a, b));
        if (t0 > t1) { hit = false; break; }
      }
      if (hit && t0 < bestT) { bestT = t0; best = o; }
    }
    return best;
  }

  return { setStatic, setDesks, addDecor, syncPeople, setMarkers, render, screenOf, groundAt, pick, setLook };
}
