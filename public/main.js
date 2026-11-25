import { W, H, DESKS, zoneOf, isShared, hearRadius, staticObjects, robot, areaAt, RIDES, CHAIRS } from './world.js';
import { PRESETS, BANK } from './presets.js';
import { drawBox } from './iso.js';
import { createScene } from './scene3d.js';
import { avatarBoxes, OUTFITS, HAIRSTYLES } from './avatar.js';
import { createRTC } from './rtc.js';
import { createArcade } from './arcade.js';

const $ = (id) => document.getElementById(id);
const canvas = $('stage');
const ctx = canvas.getContext('2d');
const scene = createScene($('gl')); // the 3D town; the canvas above it only carries name tags and signs
if (new URLSearchParams(location.search).get('look') === '8bit') scene.setLook('8bit'); // try the whole town in the retro look
const STATUS = {
  available: { label: 'Available', color: '#1f9d63' },
  meeting: { label: 'In a meeting', color: '#ef4d5a', banner: "You're in a meeting. Your mic and camera are off and you can't hear the office." },
  busy: { label: 'Busy, do not disturb', color: '#d97706', banner: "Do not disturb is on. Your mic and camera are off and you can't hear the office." },
};

// ---------- small helpers ----------
function store(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch { /* private window: carry on without it */ }
  return null;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- state ----------
const players = new Map();
let me = null;
let ws = null;
let desks = {};
let bots = [];
let aiOn = false;
let objects = [];
let solid = new Set();
const fixed = staticObjects().map((o) => ({ ...o, sorted: o.boxes }));
for (const o of fixed) if (o.decor) scene.addDecor(o);
const keys = new Set();
let hover = null;
let hoverObject = null;
let pending = null; // the thing to use once we have walked up to it
let near = null;
let panel = null; // { kind: 'bot' | 'desk', ... }
const botChats = {};
const cam = { x: 9, y: 12 };
let userZoom = Number(store('hq.zoom')) || 1;
let introStart = null; // when the camera began swooping in
const chairAt = new Map(CHAIRS.map((c) => [`${c.x},${c.y}`, c]));
// Stand still on a chair and you sit in it.
const chairOf = (p) => (p.ride || p.step > 0 || (p === me && me.path.length) ? null : chairAt.get(`${Math.floor(p.x)},${Math.floor(p.y)}`) || null);

// "In a meeting" and "Busy" both mean: no calls. The call code reads p.meeting.
const norm = (p) => { p.status ||= 'available'; p.meeting = p.status !== 'available'; return p; };

function rebuildObjects() {
  objects = [...fixed];
  for (const d of DESKS) {
    const design = desks[d.id]?.design || PRESETS[BANK[DESKS.indexOf(d) % BANK.length]];
    objects.push({ kind: 'desk', id: d.id, x: d.x, y: d.y, w: d.w, d: d.d, desk: d, sorted: design.boxes, boxes: design.boxes });
  }
  for (const b of bots) {
    objects.push({ kind: 'bot', id: b.id, bot: b, x: b.x, y: b.y, w: 1, d: 1, sorted: robot(b.color), boxes: robot(b.color) });
  }
  for (const o of objects) if (o.kind) o.top = Math.max(0.6, ...o.sorted.map((b) => b.z + b.h));
  scene.setStatic(objects.filter((o) => o.kind !== 'desk'));
  scene.setDesks(objects.filter((o) => o.kind === 'desk'));
  solid = new Set();
  for (const o of objects) for (let i = 0; i < o.w; i++) for (let j = 0; j < o.d; j++) solid.add(`${o.x + i},${o.y + j}`);
}
const walkable = (i, j) => i >= 0 && j >= 0 && i < W && j < H && !solid.has(`${i},${j}`);
const tileOf = (p) => [Math.floor(p.x), Math.floor(p.y)];
const isBeside = (o, i, j) => i >= o.x - 1 && i <= o.x + o.w && j >= o.y - 1 && j <= o.y + o.d;

// Shortest walk from a tile to the first tile that satisfies isGoal.
function findPath(from, isGoal) {
  const startKey = `${from[0]},${from[1]}`;
  const prev = new Map([[startKey, null]]);
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    if (isGoal(cur[0], cur[1])) {
      const path = [];
      for (let c = cur; c && `${c[0]},${c[1]}` !== startKey; c = prev.get(`${c[0]},${c[1]}`)) path.unshift(c);
      return path;
    }
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const n = [cur[0] + dx, cur[1] + dy];
      const k = `${n[0]},${n[1]}`;
      if (!prev.has(k) && walkable(n[0], n[1])) { prev.set(k, cur); queue.push(n); }
    }
  }
  return null;
}

// ---------- networking ----------
function send(msg) { if (ws?.readyState === 1) ws.send(JSON.stringify(msg)); }
const rtc = createRTC({ send: (to, data) => send({ t: 'signal', to, data }), container: $('videos'), screens: $('screens') });
const arcade = createArcade({ send, myId: () => me?.id });
window.__hq = { players, rtc, scene, arcade, get me() { return me; } }; // handy for debugging in the console

function connect(profile) {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
  ws.onopen = () => send({ t: 'join', ...profile });
  ws.onclose = () => { if (me) $('lost').style.display = 'flex'; };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.t === 'init') {
      desks = m.desks;
      for (const p of m.players) players.set(p.id, norm({ ...p, tx: p.x, ty: p.y, step: 0 }));
      me = norm({ ...m.you, path: [], step: 0 });
      players.set(me.id, me);
      cam.x = me.x; cam.y = me.y;
      introStart = performance.now();
      $('welcome').classList.add('show');
      rebuildObjects();
      updateCount();
    } else if (m.t === 'join') {
      players.set(m.player.id, norm({ ...m.player, tx: m.player.x, ty: m.player.y, step: 0 }));
      logChat(null, `${m.player.name} walked in`);
      updateCount();
    } else if (m.t === 'leave') {
      const p = players.get(m.id);
      if (p) logChat(null, `${p.name} left`);
      players.delete(m.id);
      rtc.drop(m.id);
      updateCount();
    } else if (m.t === 'move') {
      const p = players.get(m.id);
      if (p) { p.tx = m.x; p.ty = m.y; p.f = m.f; }
    } else if (m.t === 'pos') {
      // the server didn't accept where we said we were: go back to where it has us
      if (me) { me.x = m.x; me.y = m.y; me.path = []; }
    } else if (m.t === 'look') {
      const p = players.get(m.id);
      if (p) { p.look = m.look; p.name = m.name; }
    } else if (m.t === 'state') {
      const p = players.get(m.id);
      if (p) norm(Object.assign(p, { status: m.status, muted: m.muted, camOff: m.camOff, item: m.item, ride: m.ride, screen: m.screen }));
    } else if (m.t === 'chat') {
      const p = players.get(m.id);
      if (p) p.bubble = { text: m.text, until: performance.now() + 6000 };
      logChat(m.name, m.text);
    } else if (m.t === 'arcade') {
      arcade.handle(m);
    } else if (m.t === 'signal') {
      rtc.handleSignal(m.from, m.data, me, players).catch((err) => console.warn('call set-up failed', err));
    } else if (m.t === 'desk') {
      desks[m.deskId] = m.desk;
      rebuildObjects();
      if (panel?.kind === 'desk' && panel.deskId === m.deskId) renderDeskPanel();
    }
  };
}
function updateCount() { $('count').textContent = `${players.size} here`; }
function logChat(name, text) {
  const div = document.createElement('div');
  if (name) { const b = document.createElement('b'); b.textContent = `${name}: `; div.append(b); }
  else div.style.color = '#a59fc7';
  div.append(text);
  $('chatlog').append(div);
  while ($('chatlog').children.length > 8) $('chatlog').firstChild.remove();
  setTimeout(() => div.remove(), 30000);
}

// ---------- microphone, camera and status ----------
let localStream = null;
const myTile = (() => {
  const tile = document.createElement('div');
  tile.className = 'tile me novideo';
  tile.innerHTML = '<video autoplay playsinline muted></video><div class="initial"></div><span class="nm">You</span>';
  $('videos').append(tile);
  return tile;
})();

async function acquireMedia() {
  if (!navigator.mediaDevices?.getUserMedia) return null; // needs https or localhost
  const audio = { echoCancellation: true, noiseSuppression: true };
  try { return await navigator.mediaDevices.getUserMedia({ audio, video: { width: 320, height: 240 } }); } catch { /* try sound only */ }
  try { return await navigator.mediaDevices.getUserMedia({ audio }); } catch { return null; }
}
function applyMedia() {
  const quiet = me.meeting;
  const hasMic = !!localStream?.getAudioTracks().length;
  const hasCam = !!localStream?.getVideoTracks().length;
  localStream?.getAudioTracks().forEach((t) => { t.enabled = !me.muted; });
  localStream?.getVideoTracks().forEach((t) => { t.enabled = !me.camOff; });
  myTile.querySelector('video').srcObject = localStream;
  myTile.classList.toggle('novideo', !hasCam || me.camOff);
  myTile.querySelector('.initial').textContent = (me.name || '?')[0].toUpperCase();
  myTile.querySelector('.initial').style.background = me.look.shirt;
  const mic = $('btnMic'), cam2 = $('btnCam');
  mic.disabled = cam2.disabled = quiet;
  mic.textContent = !hasMic && !quiet ? 'No mic' : me.muted || quiet ? 'Mic off' : 'Mic on';
  cam2.textContent = !hasCam && !quiet ? 'No camera' : me.camOff || quiet ? 'Camera off' : 'Camera on';
  mic.classList.toggle('off', me.muted || quiet || !hasMic);
  cam2.classList.toggle('off', me.camOff || quiet || !hasCam);
  for (const b of $('status').children) b.classList.toggle('on', b.dataset.status === me.status);
  document.body.classList.toggle('quiet', quiet);
  document.body.classList.toggle('busy', me.status === 'busy');
  $('banner').textContent = STATUS[me.status].banner || '';
  $('btnScreen').disabled = quiet;
  $('btnScreen').textContent = screenStream ? 'Stop sharing' : 'Share screen';
  $('btnScreen').classList.toggle('sharing', !!screenStream);
  $('btnRide').hidden = !me.ride;
  $('btnItem').hidden = !me.item;
  $('btnItem').textContent = me.item === 'coffee' ? 'Finish coffee' : 'Finish lunch';
}
function sendState() { send({ t: 'state', status: me.status, muted: me.muted, camOff: me.camOff, item: me.item, ride: me.ride, screen: me.screen || null }); }

// Screen sharing: everyone you are currently talking to sees it. Calls restart
// for a moment so the screen can be added to (or taken out of) them.
let screenStream = null;
async function startShare() {
  if (!navigator.mediaDevices?.getDisplayMedia) return logChat(null, "This browser can't share a screen here (it needs https or localhost).");
  let stream;
  try { stream = await navigator.mediaDevices.getDisplayMedia({ video: true }); } catch { return; } // they cancelled the picker
  if (me.meeting) { stream.getTracks().forEach((t) => t.stop()); return; }
  screenStream = stream;
  stream.getVideoTracks()[0].addEventListener('ended', stopShare); // the browser's own "Stop sharing" bar
  rtc.setScreenStream(stream);
  me.screen = stream.id;
  sendState();
  rtc.closeAll();
  applyMedia();
}
function stopShare() {
  if (!screenStream) return;
  screenStream.getTracks().forEach((t) => t.stop());
  screenStream = null;
  rtc.setScreenStream(null);
  me.screen = null;
  sendState();
  rtc.closeAll();
  applyMedia();
}
$('btnScreen').onclick = () => (screenStream ? stopShare() : startShare());

$('btnMic').onclick = () => { me.muted = !me.muted; applyMedia(); sendState(); };
$('btnCam').onclick = () => { me.camOff = !me.camOff; applyMedia(); sendState(); };
$('btnRide').onclick = () => { me.ride = null; applyMedia(); sendState(); };
$('btnItem').onclick = () => { me.item = null; applyMedia(); sendState(); };
async function setStatus(status) {
  if (!me || me.status === status) return;
  const wasQuiet = me.meeting;
  me.status = status;
  norm(me);
  if (!wasQuiet && me.meeting) {
    stopShare();
    // Hang up on everyone and let go of the mic and camera so another call can use them.
    rtc.closeAll();
    localStream?.getTracks().forEach((t) => t.stop());
    localStream = null;
    rtc.setLocalStream(null);
  }
  applyMedia();
  sendState();
  if (wasQuiet && !me.meeting) {
    const stream = await acquireMedia();
    if (me.meeting) { stream?.getTracks().forEach((t) => t.stop()); return; }
    localStream = stream;
    rtc.setLocalStream(stream);
    applyMedia();
  }
}
for (const b of $('status').children) b.onclick = () => setStatus(b.dataset.status);

// ---------- joining ----------
const PALETTES = {
  shirt: ['#8b5cf6', '#4f8cff', '#3ecf8e', '#ffb020', '#ff7a59', '#ef4d5a', '#ff6fb5', '#f4f4f1', '#22252f'],
  hair: ['#3b2a20', '#14121a', '#8a5a2b', '#d9a441', '#c0392b', '#b9bcc4', '#ff6fb5', '#4f8cff'],
  skin: ['#fbe0c8', '#f2c9a0', '#dca876', '#b97f52', '#8a5a3a', '#5c3a26'],
};
const look = { shirt: PALETTES.shirt[0], hair: PALETTES.hair[0], skin: PALETTES.skin[1], outfit: 'casual', hairStyle: 'short', ...(JSON.parse(store('hq.look') || 'null') || {}) };
// The little preview of your character on the way in.
function drawPreview() {
  const c = $('lookPreview'), g = c.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, c.width, c.height);
  g.setTransform(2.6, 0, 0, 2.6, 75, 160);
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.beginPath(); g.ellipse(0, 0, 15, 7.5, 0, 0, Math.PI * 2); g.fill();
  for (const b of avatarBoxes(look, 'y+')) drawBox(g, b);
}
for (const [part, id, list] of [['outfit', 'swOutfit', OUTFITS], ['hairStyle', 'swHairStyle', HAIRSTYLES]]) {
  for (const o of list) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = o.name;
    b.dataset.value = o.id;
    b.classList.toggle('sel', look[part] === o.id);
    b.onclick = () => { look[part] = o.id; look.custom = null; $('lookStatus').textContent = ''; [...$(id).children].forEach((x) => x.classList.toggle('sel', x === b)); drawPreview(); };
    $(id).append(b);
  }
}
for (const [part, id] of [['shirt', 'swShirt'], ['hair', 'swHair'], ['skin', 'swSkin']]) {
  for (const c of PALETTES[part]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.style.background = c;
    b.setAttribute('aria-label', `${part} colour ${c}`);
    b.classList.toggle('sel', look[part] === c);
    b.onclick = () => { look[part] = c; [...$(id).children].forEach((x) => x.classList.toggle('sel', x === b)); drawPreview(); };
    $(id).append(b);
  }
}
drawPreview();
$('joinName').value = store('hq.name') || '';

// Signing in. With logins on, your character is saved against your email, so it
// follows you to any browser. Without them, this browser remembers it.
function showCharacter(user) {
  $('signin').hidden = true;
  $('joinForm').hidden = false;
  if (!user) return;
  $('signout').hidden = false;
  if (user.name) {
    $('joinText').textContent = `Welcome back, ${user.name}. Change your character here any time.`;
    $('joinName').value = user.name;
    Object.assign(look, user.look);
  } else {
    $('joinText').textContent = `You're in as ${user.email}. Make your character.`;
    $('joinName').value = user.googleName || '';
  }
  for (const [part, id] of [['shirt', 'swShirt'], ['hair', 'swHair'], ['skin', 'swSkin']]) {
    [...$(id).children].forEach((b, n) => b.classList.toggle('sel', PALETTES[part][n] === look[part]));
  }
  for (const [part, id] of [['outfit', 'swOutfit'], ['hairStyle', 'swHairStyle']]) {
    [...$(id).children].forEach((b) => b.classList.toggle('sel', b.dataset.value === look[part]));
  }
  drawPreview();
}
async function startSignIn() {
  const info = await fetch('/api/me').then((r) => r.json());
  if (!info.authRequired || info.user) return showCharacter(info.user);
  $('signin').hidden = false;
  $('signinText').textContent = `Sign in with your @${info.domain} Google account to come in.`;
  const script = document.createElement('script');
  script.src = 'https://accounts.google.com/gsi/client';
  script.onload = () => {
    google.accounts.id.initialize({
      client_id: info.clientId,
      callback: async ({ credential }) => {
        const r = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential }) });
        const data = await r.json();
        if (data.user) { showCharacter(data.user); loadConfig(); } else $('signinErr').textContent = data.error || 'Sign-in failed.';
      },
    });
    google.accounts.id.renderButton($('gbtn'), { theme: 'filled_blue', size: 'large', text: 'signin_with', shape: 'pill' });
  };
  script.onerror = () => { $('signinErr').textContent = "Couldn't load Google sign-in. Check your connection."; };
  document.head.append(script);
}
startSignIn().catch(() => showCharacter(null));
$('signout').onclick = async () => { await fetch('/api/logout', { method: 'POST' }); location.reload(); };
// "Make me look like a mouse": the AI builds the whole character from a description.
$('lookGo').onclick = async () => {
  const prompt = $('lookPrompt').value.trim();
  const status = $('lookStatus');
  status.className = 'status';
  if (!prompt) { status.textContent = 'Describe how you want to look first.'; return; }
  $('lookGo').disabled = true;
  status.textContent = 'Designing your character… this can take a few seconds or a couple of minutes, so hang tight.';
  try {
    const r = await fetch('/api/look', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt }) });
    const data = await r.json();
    if (data.custom) { look.custom = data.custom; status.textContent = `Done: ${data.custom.name}. Pick an outfit to go back to the standard looks.`; drawPreview(); }
    else { status.className = 'status err'; status.textContent = data.error || "That didn't work. Try again."; }
  } catch { status.className = 'status err'; status.textContent = "Couldn't reach the server."; }
  $('lookGo').disabled = false;
};
$('lookPrompt').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('lookGo').click(); } });
// Change your character any time, without leaving town.
$('btnLook').onclick = () => {
  if (!me) return;
  Object.assign(look, me.look);
  $('joinName').value = me.name;
  $('joinText').textContent = 'Change your character. Everyone sees the new you straight away.';
  $('joinGo').textContent = 'Save my look';
  for (const [part, id] of [['shirt', 'swShirt'], ['hair', 'swHair'], ['skin', 'swSkin']]) [...$(id).children].forEach((b, n) => b.classList.toggle('sel', PALETTES[part][n] === look[part]));
  for (const [part, id] of [['outfit', 'swOutfit'], ['hairStyle', 'swHairStyle']]) [...$(id).children].forEach((b) => b.classList.toggle('sel', !look.custom && b.dataset.value === look[part]));
  drawPreview();
  $('join').style.display = 'flex';
};

$('joinForm').onsubmit = async (e) => {
  e.preventDefault();
  const name = $('joinName').value.trim();
  if (!name) return;
  store('hq.name', name);
  store('hq.look', JSON.stringify(look));
  await fetch('/api/profile', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, look }) }).catch(() => {});
  $('join').style.display = 'none';
  if (me) { // already in town: just swap the character
    me.name = name; me.look = JSON.parse(JSON.stringify(look));
    send({ t: 'look', name, look });
    applyMedia();
    return;
  }
  loadConfig();
  connect({ name, look });
  const wait = setInterval(() => { if (me) { clearInterval(wait); applyMedia(); } }, 50);
  // Don't hold people at the door while the browser asks about the mic and camera.
  const stream = await acquireMedia();
  if (!stream) return;
  if (me?.meeting) { stream.getTracks().forEach((t) => t.stop()); return; }
  localStream = stream;
  rtc.setLocalStream(stream);
  rtc.closeAll(); // calls already under way restart with our mic and camera
  if (me) applyMedia();
};
// The receptionists and AI switches. With sign-in on, the server only answers once you
// are signed in, so this is asked again after signing in and again on joining.
function loadConfig() {
  return fetch('/api/config').then((r) => (r.ok ? r.json() : null)).then((cfg) => {
    if (!cfg) return;
    bots = cfg.bots; aiOn = cfg.ai; rebuildObjects();
  }).catch(() => {});
}
loadConfig();
rebuildObjects();

// ---------- input ----------
function typing() { return ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName); }
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { arcade.close(); closePanel(); document.activeElement?.blur(); return; }
  if (typing() || !me || arcade.isOpen()) return; // the arcade has the keyboard while you play
  if (e.key === 'Enter') { $('chatInput').focus(); e.preventDefault(); return; }
  if (e.key === 'e' || e.key === 'E') { if (near) interact(near); return; }
  if ((e.key === 'x' || e.key === 'X') && me.ride) { $('btnRide').click(); return; }
  if (e.key === 'g' || e.key === 'G') { showSquares = !showSquares; lastArea = ''; return; }
  keys.add(e.key.toLowerCase());
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());
$('chatInput').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const text = e.target.value.trim();
  if (text) send({ t: 'chat', text });
  e.target.value = '';
  e.target.blur();
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  userZoom = Math.max(0.3, Math.min(2.6, userZoom * (e.deltaY > 0 ? 0.9 : 1.1)));
  store('hq.zoom', String(userZoom));
}, { passive: false });

function mouseTile(e) {
  const g = scene.groundAt(e.clientX, e.clientY);
  return g ? [Math.floor(g[0]), Math.floor(g[1])] : [-1, -1];
}
// Desks, bots and rides are picked by their whole 3D shape, nearest the camera first.
const pickObject = (e) => scene.pick(objects.filter((o) => o.kind), e.clientX, e.clientY);
canvas.addEventListener('mousemove', (e) => { hover = mouseTile(e); hoverObject = pickObject(e); });
canvas.addEventListener('mouseleave', () => { hover = null; hoverObject = null; });
canvas.addEventListener('click', (e) => {
  if (!me) return;
  const [i, j] = mouseTile(e);
  const o = pickObject(e);
  const from = tileOf(me);
  if (o) {
    if (isBeside(o, from[0], from[1])) return interact(o);
    // Clicking a desk just walks you to its seat; other things open when you arrive.
    const seat = o.desk?.seat;
    const path = (seat && findPath(from, (a, b) => a === seat[0] && b === seat[1])) || findPath(from, (a, b) => isBeside(o, a, b));
    if (path) { me.path = path; pending = o.kind === 'desk' ? null : o; }
    return;
  }
  pending = null;
  if (!walkable(i, j)) return;
  const path = findPath(from, (a, b) => a === i && b === j);
  if (path) me.path = path;
});

// ---------- using things ----------
function interact(o) {
  pending = null;
  if (o.kind === 'bot') return openBot(o.bot);
  if (o.kind === 'desk') return openDesk(o.id);
  if (o.kind === 'arcade') return arcade.open(o.id);
  if (o.kind === 'pickup') { me.item = o.item; me.itemUntil = Date.now() + 10 * 60000; }
  if (o.kind === 'vehicle') { me.ride = o.ride; closePanel(); }
  applyMedia();
  sendState();
}
function hintFor(o) {
  if (o.kind === 'bot') return `<kbd>E</kbd>Talk to ${esc(o.bot.name)}`;
  if (o.kind === 'desk') return "<kbd>E</kbd>Change this desk's look";
  return `<kbd>E</kbd>${esc(o.label)}`;
}

function openPanel(title, sub, color) {
  $('panelTitle').innerHTML = `${esc(title)}<small>${esc(sub || '')}</small>`;
  $('panelDot').style.background = color;
  $('panel').classList.add('open');
}
function closePanel() { panel = null; $('panel').classList.remove('open'); }
$('panelClose').onclick = closePanel;

function openBot(bot) {
  panel = { kind: 'bot', bot };
  botChats[bot.id] ??= [{ role: 'assistant', content: bot.greeting }];
  openPanel(bot.name, bot.title, bot.color);
  // Show how fresh this bot's Notion knowledge is.
  fetch('/api/config').then((r) => r.json()).then((cfg) => {
    const n = cfg.bots.find((b) => b.id === bot.id)?.notion;
    if (!n || panel?.bot?.id !== bot.id) return;
    const mins = n.syncedAt ? Math.max(0, Math.round((Date.now() - new Date(n.syncedAt)) / 60000)) : null;
    const status = !n.on ? 'Notion not connected yet'
      : n.error ? `Notion problem: ${n.error}`
      : mins === null ? 'Reading Notion…'
      : `${n.items} Notion ${n.items === 1 ? 'page' : 'pages'}, synced ${mins < 1 ? 'just now' : `${mins} min ago`}`;
    $('panelTitle').querySelector('small').textContent = `${bot.title} · ${status}`;
  }).catch(() => {});
  $('panelFoot').innerHTML = '<input id="botInput" placeholder="Ask a question…" maxlength="2000" autocomplete="off"><button class="primary" id="botSend">Send</button>';
  const input = $('botInput');
  const ask = async () => {
    const text = input.value.trim();
    if (!text || panel?.busy) return;
    input.value = '';
    const chat = botChats[bot.id];
    chat.push({ role: 'user', content: text });
    panel.busy = true;
    renderBot(bot, true);
    let reply;
    try {
      const r = await fetch('/api/bot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ botId: bot.id, messages: chat }) });
      const data = await r.json();
      reply = data.reply || data.error || 'No answer came back.';
    } catch { reply = "I couldn't reach the server."; }
    chat.push({ role: 'assistant', content: reply });
    if (panel?.kind === 'bot' && panel.bot.id === bot.id) { panel.busy = false; renderBot(bot, false); }
  };
  $('botSend').onclick = ask;
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') ask(); });
  renderBot(bot, false);
  input.focus();
}
function renderBot(bot, typingNow) {
  const body = $('panelBody');
  body.innerHTML = '';
  for (const m of botChats[bot.id]) {
    const div = document.createElement('div');
    div.className = `msg ${m.role}`;
    div.textContent = m.content;
    body.append(div);
  }
  if (typingNow) {
    const div = document.createElement('div');
    div.className = 'msg assistant typing';
    div.textContent = `${bot.name} is thinking… this can take a few seconds, or up to a minute for bigger questions.`;
    body.append(div);
  }
  body.scrollTop = body.scrollHeight;
}

function openDesk(deskId) {
  panel = { kind: 'desk', deskId, status: '', err: false };
  openPanel('This desk', 'Open desk: anyone can sit here and change it', '#8b5cf6');
  $('panelFoot').innerHTML = '';
  renderDeskPanel();
}
function renderDeskPanel() {
  const d = desks[panel.deskId];
  if (!d) return closePanel();
  const body = $('panelBody');
  const draft = $('deskPrompt')?.value ?? '';
  body.innerHTML = `
    <div class="label">Right now</div><div>${esc(d.design.name)}</div>
    ${aiOn ? `<div class="label">Describe the desk you want</div>
    <textarea id="deskPrompt" maxlength="400" placeholder="Make this desk a gothic thing, with candles and a raven"></textarea>
    <button class="primary" id="deskGo">Design it</button>
    <div class="hint-note">AI designs can take anywhere from a few seconds to a couple of minutes.</div>` : ''}
    <div class="status ${panel.err ? 'err' : ''}" id="deskStatus">${esc(panel.status)}</div>
    <div class="label">${aiOn ? 'Or pick a ready-made design' : 'Pick a design'}</div>
    <div class="chips" id="deskChips"></div>`;
  for (const key of BANK) {
    const b = document.createElement('button');
    b.textContent = PRESETS[key].name.replace(' desk', '');
    b.classList.toggle('sel', d.preset === key);
    b.onclick = () => submitDesk({ preset: key });
    $('deskChips').append(b);
  }
  if (aiOn) {
    $('deskPrompt').value = draft;
    $('deskGo').onclick = () => submitDesk({ prompt: $('deskPrompt').value });
    $('deskGo').disabled = !!panel.busy;
  }
}
async function submitDesk(payload) {
  if (panel?.kind !== 'desk' || panel.busy) return;
  const mine = panel;
  if (payload.prompt !== undefined && !payload.prompt.trim()) { mine.status = 'Describe the desk you want first.'; mine.err = true; return renderDeskPanel(); }
  mine.busy = true; mine.err = false;
  mine.status = payload.preset ? '' : 'Designing the desk… this can take a few seconds or a couple of minutes, so hang tight.';
  renderDeskPanel();
  try {
    const r = await fetch('/api/desk', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deskId: mine.deskId, ...payload }) });
    const data = await r.json();
    mine.err = !!data.error;
    mine.status = data.error || data.note || '';
  } catch { mine.err = true; mine.status = "Couldn't reach the server."; }
  mine.busy = false;
  if (panel === mine) renderDeskPanel();
}

// ---------- moving ----------
let lastSent = 0;
let lastArea = '';
let showSquares = false; // press G: the corner label shows which square the mouse is over
function update(dt, now) {
  if (!me) return;
  if (me.item && Date.now() > me.itemUntil) { me.item = null; applyMedia(); sendState(); }
  // keyboard: step to the next tile in the held direction
  if (!me.path.length && !typing() && !arcade.isOpen()) {
    const [i, j] = tileOf(me);
    let step = null;
    if (keys.has('arrowup') || keys.has('w')) step = [i, j - 1];
    else if (keys.has('arrowdown') || keys.has('s')) step = [i, j + 1];
    else if (keys.has('arrowleft') || keys.has('a')) step = [i - 1, j];
    else if (keys.has('arrowright') || keys.has('d')) step = [i + 1, j];
    if (step && walkable(step[0], step[1])) { me.path = [step]; pending = null; }
  }
  let moved = false;
  let budget = (me.ride ? RIDES[me.ride].speed : 5.5) * dt;
  while (me.path.length && budget > 0) {
    const [ti, tj] = me.path[0];
    const dx = ti + 0.5 - me.x, dy = tj + 0.5 - me.y;
    const dist = Math.hypot(dx, dy);
    if (Math.abs(dx) > Math.abs(dy)) me.f = dx > 0 ? 'x+' : 'x-'; else if (dist > 0.001) me.f = dy > 0 ? 'y+' : 'y-';
    if (dist <= budget) {
      me.x = ti + 0.5; me.y = tj + 0.5; me.path.shift(); budget -= dist;
      // Report every square we pass through, so the server sees the real route round corners.
      send({ t: 'move', x: me.x, y: me.y, f: me.f });
      lastSent = now;
    }
    else { me.x += (dx / dist) * budget; me.y += (dy / dist) * budget; budget = 0; }
    moved = true;
  }
  me.step = moved ? me.step + dt * 14 : 0;
  if ((moved && now - lastSent > 70) || (!moved && me.dirty)) {
    send({ t: 'move', x: me.x, y: me.y, f: me.f });
    lastSent = now; me.dirty = false;
  }
  if (moved) me.dirty = true;

  for (const p of players.values()) {
    if (p === me) continue;
    const dx = p.tx - p.x, dy = p.ty - p.y;
    const k = Math.min(1, dt * 14);
    p.x += dx * k; p.y += dy * k;
    p.step = Math.hypot(dx, dy) > 0.02 ? p.step + dt * 14 : 0;
  }
  const follow = Math.min(1, dt * 6);
  cam.x += (me.x - cam.x) * follow; cam.y += (me.y - cam.y) * follow;

  // what are we standing next to?
  const [i, j] = tileOf(me);
  near = null;
  let best = Infinity;
  for (const o of objects) {
    if (!o.kind || !isBeside(o, i, j)) continue;
    const d = Math.hypot(o.x + o.w / 2 - me.x, o.y + o.d / 2 - me.y);
    if (d < best) { best = d; near = o; }
  }
  if (pending && !me.path.length) { const o = pending; pending = null; if (isBeside(o, i, j)) interact(o); }
  const hint = $('hint');
  if (near && !panel && !me.path.length) { hint.innerHTML = hintFor(near) + (me.ride ? ' &nbsp;·&nbsp; <kbd>X</kbd>Hop off' : ''); hint.style.display = 'block'; }
  else if (me.ride && !panel) { hint.innerHTML = `<kbd>X</kbd>Hop off the ${RIDES[me.ride].name}`; hint.style.display = 'block'; }
  else hint.style.display = 'none';
  const area = showSquares ? (hover && hover[0] >= 0 ? `Square ${hover[0]}, ${hover[1]}` : 'Point at the floor') : areaAt(me.x, me.y) + (isShared(zoneOf(me.x, me.y)) ? ' · everyone here can hear you' : '');
  if (area !== lastArea) { lastArea = area; $('where').textContent = area; $('where').style.display = 'block'; }
}
setInterval(() => { if (me) rtc.update(me, players); }, 250);

// ---------- drawing ----------
function resize() {
  const dpr = devicePixelRatio || 1;
  canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr;
}
addEventListener('resize', resize);
resize();

function pill(text, x, y, bg, fg = '#fff', font = '600 11px system-ui, sans-serif') {
  ctx.font = font;
  const w = ctx.measureText(text).width + 12;
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - 8, w, 16, 8);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + 0.5);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
}
function bubble(text, x, y) {
  ctx.font = '12px system-ui, sans-serif';
  const words = text.split(/\s+/), lines = [];
  let line = '';
  for (const w of words) {
    if (ctx.measureText(`${line} ${w}`).width > 170 && line) { lines.push(line); line = w; } else line = line ? `${line} ${w}` : w;
  }
  lines.push(line);
  const shown = lines.slice(0, 4);
  const width = Math.max(...shown.map((l) => ctx.measureText(l).width)) + 16;
  const height = shown.length * 15 + 10;
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.roundRect(x - width / 2, y - height, width, height, 9); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x - 5, y - 1); ctx.lineTo(x + 5, y - 1); ctx.lineTo(x, y + 6); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#1b1b25'; ctx.textAlign = 'center';
  shown.forEach((l, n) => ctx.fillText(l, x, y - height + 18 + n * 15));
  ctx.textAlign = 'left';
}

// Name tags, desk signs and speech bubbles, drawn flat over the 3D view.
function drawLabels(now, distance) {
  const dpr = devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  if (!me || introStart !== null) return; // keep the fly-in clean
  const close = distance < 46; // when zoomed right out, only people are labelled
  const seated = new Map();
  for (const p of players.values()) seated.set(`${Math.floor(p.x)},${Math.floor(p.y)}`, p);
  const atDesk = new Set();
  for (const o of objects) {
    if (!o.kind) continue;
    if (o.kind === 'bot') {
      if (!close) continue;
      const s = scene.screenOf(o.x + 0.5, o.y + 0.5, 1.85);
      if (!s.visible) continue;
      pill(o.bot.name, s.x, s.y - 9, o.bot.color);
      pill(o.bot.title, s.x, s.y + 8, 'rgba(15,12,30,.8)', '#d9d4f5', '10px system-ui, sans-serif');
      if (o.bot.needsContext) bubble('Needs context', s.x, s.y - 24);
    } else if (o.kind === 'pickup' || o.kind === 'vehicle' || o.kind === 'arcade') {
      if (Math.hypot(o.x + 0.5 - me.x, o.y + 0.5 - me.y) > 7) continue;
      const s = scene.screenOf(o.x + 0.5, o.y + 0.5, o.top + 0.5);
      if (s.visible) pill(o.label, s.x, s.y, 'rgba(15,12,30,.8)', '#fff', '10px system-ui, sans-serif');
    } else if (o.kind === 'desk') {
      // the desk sign: who is sitting here and whether they can be disturbed
      const p = seated.get(`${o.desk.seat[0]},${o.desk.seat[1]}`);
      if (!p || p.ride) continue;
      atDesk.add(p);
      const s = scene.screenOf(o.x + 1, o.y + 0.5, 2.15);
      if (s.visible) pill(`${p.name} · ${STATUS[p.status].label}`, s.x, s.y, STATUS[p.status].color, '#fff', '700 11px system-ui, sans-serif');
    }
  }
  for (const p of players.values()) {
    const sitting = chairOf(p);
    const s = scene.screenOf(sitting ? sitting.x + 0.5 : p.x, sitting ? sitting.y + 0.5 : p.y, 1.72 + (p.ride ? RIDES[p.ride].lift : 0));
    if (!s.visible) continue;
    const tag = p === me ? `${p.name} (you)` : p.name;
    pill(p.muted && !p.meeting ? `${tag} · muted` : tag, s.x, s.y, p === me ? '#8b5cf6' : 'rgba(15,12,30,.82)');
    const showStatus = p.meeting && !atDesk.has(p);
    if (showStatus) pill(STATUS[p.status].label, s.x, s.y - 19, STATUS[p.status].color);
    if (p.bubble && p.bubble.until > now) bubble(p.bubble.text, s.x, s.y - (showStatus ? 34 : 15));
  }
}

function draw(now, dt) {
  const t = now / 1000;
  let distance = (innerWidth < 800 ? 40 : 31) / userZoom;
  let tx = cam.x, ty = cam.y;
  if (!me) {
    // before you come in: a slow drift high over the town
    distance = 105; tx = W / 2 + Math.sin(t * 0.12) * 7; ty = H / 2 + Math.cos(t * 0.12) * 5;
  } else if (introStart !== null) {
    // arriving: the camera swoops down from above the whole town to you
    const k = Math.min(1, (now - introStart) / 3800);
    const ease = 1 - (1 - k) ** 3;
    distance = 105 + (distance - 105) * ease;
    tx = W / 2 + (cam.x - W / 2) * ease; ty = H / 2 + (cam.y - H / 2) * ease;
    if (k >= 1) introStart = null;
  }
  scene.syncPeople(players.values(), chairOf, dt, t);
  if (hoverObject && !objects.includes(hoverObject)) hoverObject = null;
  const hoverTile = hover && walkable(hover[0], hover[1]) ? { x: hover[0], y: hover[1], w: 1, d: 1 } : null;
  scene.setMarkers({
    hover: me ? hoverObject || hoverTile : null,
    goal: me?.path.length ? me.path[me.path.length - 1] : null,
    // the ring shows how far your voice carries; shared spaces have no ring because the whole room hears you
    hear: me && !me.meeting && !isShared(zoneOf(me.x, me.y)) ? [me.x, me.y, hearRadius(zoneOf(me.x, me.y))] : null,
  });
  scene.render({ x: tx, y: ty }, distance, t);
  drawLabels(now, distance);
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  update(dt, now);
  draw(now, dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
// Background tabs stop drawing; keep people moving for everyone else anyway.
setInterval(() => { if (document.hidden) { const now = performance.now(); update(Math.min(0.25, (now - last) / 1000), now); last = now; } }, 100);
