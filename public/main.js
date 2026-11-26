import { W, H, DESKS, zoneOf, isShared, hearRadius, staticObjects, robot, areaAt, RIDES, CHAIRS, DANCE, onDanceFloor, DECOR_AREAS, decorAreaAt } from './world.js';
import * as sound from './sound.js';
import { createRecorder, canRecord } from './recorder.js';
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

// Recording a call to your own computer (see recorder.js). Everyone you can hear
// sees a Recording sign over your head and a notice while it's going.
const recorder = createRecorder({
  videos: $('videos'),
  screens: $('screens'),
  myScreen: () => screenStream,
  myName: () => me?.name,
  onChange: (why) => {
    if (!me) return;
    if (!!me.rec !== recorder.active()) { me.rec = recorder.active(); sendState(); }
    applyMedia();
    if (why === 'time') toast('Recording stopped after 90 minutes and saved to your Downloads. Press Record to carry on.');
  },
});
async function toggleRecording() {
  if (!me) return;
  if (recorder.active()) { recorder.stop(); toast('Recording saved to your Downloads.'); return; }
  if (!canRecord()) return toast("This browser can't record calls. Try Chrome or Edge.");
  if (me.meeting) return toast('Set yourself to Available to record a call.');
  if (await recorder.start()) { sound.play('chime'); toast('Recording. Everyone who can hear you sees a Recording sign over your head. Press Stop recording to save it.', [], 8000); }
  else toast("Couldn't start recording in this browser.");
}
$('btnRec').onclick = toggleRecording;
addEventListener('beforeunload', (e) => { if (recorder.active()) { e.preventDefault(); e.returnValue = ''; } });

// Tell people when someone they're talking to is recording.
let recSeen = new Set();
function updateRecNotice() {
  const others = [...players.values()].filter((p) => p !== me && p.rec && rtc.has(p.id));
  for (const p of others) {
    if (recSeen.has(p.id)) continue;
    toast(`${p.name} is recording. Your voice, camera and any screen you share are in it while you can hear each other.`, [], 9000);
    sound.play('chime');
  }
  recSeen = new Set(others.map((p) => p.id));
  const parts = [];
  if (recorder.active()) parts.push(`You're recording · ${recorder.elapsed()}`);
  if (others.length) parts.push(`${others.map((p) => p.name).join(', ')} ${others.length === 1 ? 'is' : 'are'} recording`);
  const el = $('recNotice');
  el.style.display = parts.length ? 'block' : 'none';
  el.textContent = parts.length ? `● ${parts.join(' · ')}` : '';
}
const arcade = createArcade({ send, myId: () => me?.id, sfx: (n) => sound.play(n) });
window.__hq = { players, rtc, scene, arcade, findPath, get me() { return me; } }; // handy for debugging in the console

// If the connection drops (for example while a new version of the town goes live),
// quietly reconnect and carry on from the same spot, with the same status.
let reconnectTries = 0;
function connect(profile) {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
  ws.onopen = () => {
    const where = me ? { status: me.status, muted: me.muted, camOff: me.camOff, item: me.item, ride: me.ride } : {};
    send({ t: 'join', ...profile, ...(me ? { name: me.name, look: me.look } : {}), ...where });
  };
  ws.onclose = (e) => {
    if (!me) return;
    if (e.code === 4401 || reconnectTries >= 30) { $('lost').style.display = 'flex'; return; } // signed out, or the server is really gone
    reconnectTries++;
    $('reconnecting').style.display = 'block';
    rtc.closeAll();
    setTimeout(() => connect(profile), Math.min(5000, 1000 + reconnectTries * 500));
  };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.t === 'init') {
      const back = !!me; // reconnecting rather than arriving
      reconnectTries = 0;
      $('reconnecting').style.display = 'none';
      desks = m.desks;
      for (const a of DECOR_AREAS) scene.setAreaDecor(a, m.areaDecor?.[a.id] || null);
      players.clear();
      for (const p of m.players) players.set(p.id, norm({ ...p, tx: p.x, ty: p.y, step: 0 }));
      me = norm({ ...m.you, path: [], step: 0 });
      me.rec = recorder.active();
      players.set(me.id, me);
      if (back && me.rec) sendState();
      if (!back) {
        cam.x = me.x; cam.y = me.y;
        introStart = performance.now();
        $('welcome').classList.add('show');
      } else {
        loadConfig(); // a new version may have new receptionists or settings
      }
      rebuildObjects();
      updateCount();
    } else if (m.t === 'join') {
      players.set(m.player.id, norm({ ...m.player, tx: m.player.x, ty: m.player.y, step: 0 }));
      logChat(null, `${m.player.name} walked in`);
      sound.play('chime');
      updateCount();
    } else if (m.t === 'leave') {
      const p = players.get(m.id);
      if (p) logChat(null, `${p.name} left`);
      players.delete(m.id);
      dmUnread.delete(m.id);
      if (panel?.kind === 'dm' && panel.id === m.id) { toast(`${p?.name || 'They'} left town.`); openPeople(); }
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
      if (p) norm(Object.assign(p, { status: m.status, muted: m.muted, camOff: m.camOff, item: m.item, ride: m.ride, screen: m.screen, dance: m.dance, rec: m.rec }));
    } else if (m.t === 'dm') {
      const thread = dmThreads.get(m.from) || [];
      thread.push({ mine: false, text: m.text });
      dmThreads.set(m.from, thread);
      if (panel?.kind === 'dm' && panel.id === m.from) renderDm();
      else {
        dmUnread.set(m.from, (dmUnread.get(m.from) || 0) + 1);
        updateCount();
        if (!me?.meeting) sound.play('chat');
        toast(`${m.name}: ${m.text.length > 80 ? m.text.slice(0, 80) + '…' : m.text}`, [{ label: 'Reply', go: true, run: () => openDm(m.from) }], 12000);
      }
    } else if (m.t === 'emote') {
      const p = players.get(m.id);
      if (p) p.emoteUntil = performance.now() + 1800;
    } else if (m.t === 'poke') {
      const p = players.get(m.from);
      if (m.kind === 'wave') { toast(`${m.name} waved at you 👋`); sound.play('wave'); }
      else {
        sound.play('invite');
        toast(`${m.name} invited you over`, [
          { label: 'Go over', go: true, run: () => { const q = players.get(m.from); if (q) walkTo(q); else toast(`${m.name} has left.`); } },
          { label: 'Not now', run: () => {} },
        ], 20000);
      }
      if (p) p.emoteUntil = m.kind === 'wave' ? p.emoteUntil : performance.now() + 1800;
    } else if (m.t === 'poke-result') {
      const p = players.get(m.to);
      const who = p?.name || 'They';
      if (!m.ok) toast(`${who} is ${m.reason === 'busy' ? 'set to Busy' : 'in a meeting'}, so they weren't disturbed.`);
      else if (m.kind === 'invite') toast(`Invite sent to ${who}.`);
    } else if (m.t === 'chat') {
      const p = players.get(m.id);
      if (p) p.bubble = { text: m.text, until: performance.now() + 6000 };
      logChat(m.name, m.text);
      sound.play('chat');
    } else if (m.t === 'arcade') {
      arcade.handle(m);
    } else if (m.t === 'signal') {
      rtc.handleSignal(m.from, m.data, me, players).catch((err) => console.warn('call set-up failed', err));
    } else if (m.t === 'area') {
      const a = DECOR_AREAS.find((x) => x.id === m.areaId);
      if (a) scene.setAreaDecor(a, m.decor);
      if (a && m.decor) { logChat(null, `${a.name} has been decorated: ${m.decor.name}`); sound.play('magic'); }
      if (panel?.kind === 'decor' && panel.area.id === m.areaId) { panel.current = m.decor; renderDecorPanel(); }
    } else if (m.t === 'desk') {
      desks[m.deskId] = m.desk;
      rebuildObjects();
      if (panel?.kind === 'desk' && panel.deskId === m.deskId) renderDeskPanel();
    }
  };
}
function updateCount() {
  const unread = [...dmUnread.values()].reduce((a, b) => a + b, 0);
  $('count').textContent = `${players.size} here`;
  if (unread) { const b = document.createElement('span'); b.className = 'badge'; b.textContent = unread; $('count').append(b); }
}
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
  $('btnRec').disabled = quiet && !recorder.active();
  $('btnRec').textContent = recorder.active() ? `Stop recording ${recorder.elapsed()}` : 'Record';
  $('btnRec').classList.toggle('recording', recorder.active());
  $('btnRide').hidden = !me.ride;
  $('btnItem').hidden = !me.item;
  $('btnItem').textContent = { coffee: 'Finish coffee', lunch: 'Finish lunch', beer: 'Finish beer', cocktail: 'Finish cocktail', soda: 'Finish drink' }[me.item] || 'Put it down';
  $('btnDance').classList.toggle('sharing', !!me.dance);
  $('btnDance').textContent = me.dance ? 'Stop dancing' : 'Dance';
  $('btnSound').textContent = sound.isMuted() ? 'Sound off' : 'Sound on';
  $('btnSound').classList.toggle('off', sound.isMuted());
}
function sendState() { send({ t: 'state', status: me.status, muted: me.muted, camOff: me.camOff, item: me.item, ride: me.ride, screen: me.screen || null, dance: !!me.dance, rec: recorder.active() }); }

// ---------- dancing, sound and decorating ----------
function setDance(on) {
  if (!me || !!me.dance === on) return;
  me.dance = on;
  if (on) { me.path = []; sound.play('dance'); }
  applyMedia();
  sendState();
}
$('btnDance').onclick = () => setDance(!me?.dance);

// ---------- who's here, and private messages ----------
const dmThreads = new Map(); // person id -> [{ mine, text }]
const dmUnread = new Map(); // person id -> count
$('count').onclick = () => (panel?.kind === 'people' ? closePanel() : openPeople());

// Turns web links in a message into clickable links, safely (only http and https).
function linkify(el, text) {
  el.textContent = '';
  const re = /https?:\/\/[^\s<>()"']+[^\s<>()"'.,;:!?]/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    el.append(text.slice(last, m.index));
    const a = document.createElement('a');
    // Only real Notion addresses get the short label; anything else shows the link itself.
    let host = '';
    try { host = new URL(m[0]).hostname.toLowerCase(); } catch { /* not a valid address */ }
    const isNotion = host === 'notion.so' || host === 'www.notion.so' || host.endsWith('.notion.site');
    a.href = m[0]; a.textContent = isNotion ? 'Open in Notion' : m[0];
    a.target = '_blank'; a.rel = 'noopener noreferrer';
    el.append(a);
    last = m.index + m[0].length;
  }
  el.append(text.slice(last));
}

function openPeople() {
  panel = { kind: 'people' };
  openPanel("Who's here", 'Click someone to message, join or follow them', '#3ecf8e');
  $('panelFoot').innerHTML = '';
  renderPeople();
}
function renderPeople() {
  if (panel?.kind !== 'people') return;
  const body = $('panelBody');
  const others = [...players.values()].filter((p) => p !== me).sort((a, b) => a.name.localeCompare(b.name));
  const sig = JSON.stringify(others.map((p) => [p.id, p.name, p.status, areaAt(p.tx ?? p.x, p.ty ?? p.y), dmUnread.get(p.id) || 0, me.follow === p.id]));
  if (panel.sig === sig) return; // nothing changed: don't redraw under the mouse
  panel.sig = sig;
  body.innerHTML = '';
  if (!others.length) { const d = document.createElement('div'); d.className = 'status'; d.textContent = "It's just you here at the moment."; body.append(d); return; }
  for (const p of others) {
    const card = document.createElement('div');
    card.className = 'person';
    const top = document.createElement('div'); top.className = 'top';
    const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = STATUS[p.status]?.color || '#888';
    const who = document.createElement('div'); who.className = 'who';
    const name = document.createElement('b'); name.textContent = p.name;
    const unread = dmUnread.get(p.id);
    if (unread) { const b = document.createElement('span'); b.className = 'badge'; b.textContent = unread; name.append(b); }
    const where = document.createElement('small');
    where.textContent = `${STATUS[p.status]?.label || ''} · ${areaAt(p.tx ?? p.x, p.ty ?? p.y)}`;
    who.append(name, where);
    top.append(dot, who);
    const acts = document.createElement('div'); acts.className = 'acts';
    const btn = (label, run, main) => { const b = document.createElement('button'); b.textContent = label; if (main) b.className = 'main'; b.onclick = run; acts.append(b); };
    btn('Message', () => openDm(p.id), true);
    btn('Go to them', () => { closePanel(); if (!walkTo(p)) toast(`Can't find a way to ${p.name} from here.`); });
    btn(me.follow === p.id ? 'Stop following' : 'Follow', () => { if (me.follow === p.id) stopFollowing(); else { startFollowing(p); closePanel(); } renderPeople(); });
    btn('Wave', () => { send({ t: 'poke', to: p.id, kind: 'wave' }); me.emoteUntil = performance.now() + 1800; sound.play('wave'); });
    btn('Invite over', () => send({ t: 'poke', to: p.id, kind: 'invite' }));
    card.append(top, acts);
    body.append(card);
  }
}
setInterval(renderPeople, 1000);

function openDm(id) {
  const p = players.get(id);
  if (!p) { toast('They have left.'); return; }
  panel = { kind: 'dm', id };
  dmUnread.delete(id);
  updateCount();
  openPanel(p.name, 'Private message: only the two of you see this', STATUS[p.status]?.color || '#8b5cf6');
  $('panelFoot').innerHTML = '<button class="link" id="dmBack" style="align-self:center">Everyone</button><input id="dmInput" placeholder="Write a message…" maxlength="500" autocomplete="off"><button class="primary" id="dmSend">Send</button>';
  $('dmBack').onclick = () => openPeople();
  const input = $('dmInput');
  const go = () => {
    const text = input.value.trim();
    if (!text || !players.get(id)) return;
    send({ t: 'dm', to: id, text });
    const thread = dmThreads.get(id) || [];
    thread.push({ mine: true, text });
    dmThreads.set(id, thread);
    input.value = '';
    renderDm();
  };
  $('dmSend').onclick = go;
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  renderDm();
  input.focus();
}
function renderDm() {
  if (panel?.kind !== 'dm') return;
  const body = $('panelBody');
  body.innerHTML = '';
  const thread = dmThreads.get(panel.id) || [];
  if (!thread.length) { const d = document.createElement('div'); d.className = 'status'; d.textContent = 'Say hello. Messages last until one of you leaves town.'; body.append(d); }
  for (const m of thread) {
    const div = document.createElement('div');
    div.className = `msg ${m.mine ? 'user' : 'assistant'}`;
    linkify(div, m.text);
    body.append(div);
  }
  body.scrollTop = body.scrollHeight;
}

// ---------- waving, inviting and following ----------
// Who (other than you) is under the mouse, by how close their figure is on screen.
function personAt(cx, cy) {
  let best = null, bestD = 34;
  for (const p of players.values()) {
    if (p === me) continue;
    const c = chairOf(p);
    for (const z of [0.4, 0.9, 1.4]) {
      const s = scene.screenOf(c ? c.x + 0.5 : p.x, c ? c.y + 0.5 : p.y, z);
      if (!s.visible) continue;
      const d = Math.hypot(s.x - cx, s.y - cy);
      if (d < bestD) { bestD = d; best = p; }
    }
  }
  return best;
}
let menuFor = null;
function openPersonMenu(p, x, y) {
  menuFor = p.id;
  $('pmName').textContent = p.name;
  $('pmFollow').textContent = me.follow === p.id ? 'Stop following' : 'Follow';
  const m = $('personMenu');
  m.hidden = false;
  m.style.left = `${Math.min(x + 12, innerWidth - m.offsetWidth - 10)}px`;
  m.style.top = `${Math.min(y - 10, innerHeight - m.offsetHeight - 90)}px`;
}
function closePersonMenu() { $('personMenu').hidden = true; menuFor = null; }
$('pmWave').onclick = () => {
  const p = players.get(menuFor); closePersonMenu();
  if (!p) return;
  send({ t: 'poke', to: p.id, kind: 'wave' });
  me.emoteUntil = performance.now() + 1800; // see yourself wave straight away
  sound.play('wave');
};
$('pmInvite').onclick = () => { const p = players.get(menuFor); closePersonMenu(); if (p) send({ t: 'poke', to: p.id, kind: 'invite' }); };
$('pmFollow').onclick = () => { const p = players.get(menuFor); closePersonMenu(); if (!p) return; if (me.follow === p.id) stopFollowing(); else startFollowing(p); };
$('followStop').onclick = () => stopFollowing();
addEventListener('keydown', (e) => { if (e.key === 'Escape') closePersonMenu(); });

// Walk to a free square right next to someone.
function walkTo(p) {
  const from = tileOf(me), tx = Math.floor(p.tx ?? p.x), ty = Math.floor(p.ty ?? p.y);
  const path = findPath(from, (a, b) => Math.abs(a - tx) + Math.abs(b - ty) === 1);
  if (path) { me.path = path; me.dance = false; pending = null; return true; }
  return false;
}
function startFollowing(p) {
  me.follow = p.id;
  me.followCheck = 0;
  $('followingName').textContent = `Following ${p.name}`;
  $('following').style.display = 'flex';
}
function stopFollowing() {
  if (!me?.follow) return;
  me.follow = null;
  $('following').style.display = 'none';
}
// Called every frame: keep a few steps behind whoever we're following.
function keepFollowing(dt) {
  if (!me?.follow) return;
  const p = players.get(me.follow);
  if (!p) { toast('The person you were following has left.'); return stopFollowing(); }
  me.followCheck -= dt;
  if (me.followCheck > 0) return;
  me.followCheck = 0.4;
  const d = Math.hypot((p.tx ?? p.x) - me.x, (p.ty ?? p.y) - me.y);
  if (d > 1.6) walkTo(p);
}

// Little messages in the top-right corner, with optional buttons.
function toast(text, actions = [], ms = 6000) {
  const t = document.createElement('div');
  t.className = 'toast';
  const msg = document.createElement('div');
  msg.textContent = text;
  t.append(msg);
  if (actions.length) {
    const row = document.createElement('div');
    row.className = 'acts';
    for (const a of actions) {
      const b = document.createElement('button');
      b.textContent = a.label;
      if (a.go) b.className = 'go';
      b.onclick = () => { t.remove(); a.run(); };
      row.append(b);
    }
    t.append(row);
  }
  $('toasts').append(t);
  setTimeout(() => t.remove(), ms);
}
$('btnSound').onclick = () => { sound.setMuted(!sound.isMuted()); if (me) applyMedia(); };
$('btnDecor').onclick = () => openDecor();

function openDecor() {
  if (!me) return;
  const area = decorAreaAt(me.x, me.y);
  panel = { kind: 'decor', area, status: '', err: false, current: null };
  openPanel(area ? `Decorate: ${area.name}` : 'Decorate', 'Describe it and the AI dresses the whole area', '#ff3df2');
  $('panelFoot').innerHTML = '';
  if (area) fetch('/api/config').then(() => {}); // keeps the session fresh
  renderDecorPanel();
}
function renderDecorPanel() {
  const body = $('panelBody');
  const { area } = panel;
  if (!area) {
    body.innerHTML = '<div>Walk into a shared space (the lounge, the bar, the lunch area, the kitchen, the meeting room, the entrance or a team area), then press Decorate again.</div>';
    return;
  }
  const draft = $('decorPrompt')?.value ?? '';
  body.innerHTML = `
    <div class="label">Describe the decorations</div>
    <textarea id="decorPrompt" maxlength="300" placeholder="It's Sam's birthday: balloons, bunting and a big HAPPY BIRTHDAY SAM sign"></textarea>
    <button class="primary" id="decorGo">Decorate it</button>
    <div class="hint-note">AI designs can take anywhere from a few seconds to a couple of minutes. Everyone sees the result, and the area goes back to normal by itself after a day.</div>
    <div class="status ${panel.err ? 'err' : ''}" id="decorStatus"></div>
    <button class="link" id="decorReset">Put this area back to normal now</button>`;
  $('decorStatus').textContent = panel.status;
  $('decorPrompt').value = draft;
  $('decorGo').disabled = !!panel.busy;
  $('decorGo').onclick = () => submitDecor({ prompt: $('decorPrompt').value });
  $('decorReset').onclick = () => submitDecor({ reset: true });
}
async function submitDecor(payload) {
  if (panel?.kind !== 'decor' || panel.busy || !panel.area) return;
  const mine = panel;
  if (payload.prompt !== undefined && !payload.prompt.trim()) { mine.status = 'Describe the decorations first.'; mine.err = true; return renderDecorPanel(); }
  mine.busy = true; mine.err = false;
  mine.status = payload.reset ? 'Tidying up…' : 'Decorating… this can take a few seconds or a couple of minutes, so hang tight.';
  renderDecorPanel();
  try {
    const r = await fetch('/api/area', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ areaId: mine.area.id, ...payload }) });
    const data = await r.json();
    mine.err = !!data.error;
    mine.status = data.error || (payload.reset ? 'Back to normal.' : `Done: ${data.name}.`);
  } catch { mine.err = true; mine.status = "Couldn't reach the server."; }
  mine.busy = false;
  if (panel === mine) renderDecorPanel();
}

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
$('btnRide').onclick = () => { me.ride = null; sound.play('hopOff'); applyMedia(); sendState(); };
$('btnItem').onclick = () => { me.item = null; applyMedia(); sendState(); };
async function setStatus(status) {
  if (!me || me.status === status) return;
  const wasQuiet = me.meeting;
  me.status = status;
  norm(me);
  if (!wasQuiet && me.meeting) {
    if (recorder.active()) { recorder.stop(); toast('Recording saved to your Downloads.'); }
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
  sound.start();
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
  if (e.key === 'v' || e.key === 'V') { setDance(!me.dance); return; }
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
canvas.addEventListener('mousemove', (e) => {
  canvas.style.cursor = me && personAt(e.clientX, e.clientY) ? 'context-menu' : 'pointer'; hover = mouseTile(e); hoverObject = pickObject(e); });
canvas.addEventListener('mouseleave', () => { hover = null; hoverObject = null; });
canvas.addEventListener('click', (e) => {
  if (!me) return;
  closePersonMenu();
  const who = personAt(e.clientX, e.clientY);
  if (who) return openPersonMenu(who, e.clientX, e.clientY);
  stopFollowing(); // clicking somewhere to walk takes over from following
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
  if (o.kind === 'arcade') { sound.play('blip'); return arcade.open(o.id); }
  if (o.kind === 'pickup') { me.item = o.item; me.itemUntil = Date.now() + 10 * 60000; sound.play(['beer', 'cocktail', 'soda'].includes(o.item) ? 'drink' : 'pickup'); }
  if (o.kind === 'vehicle') { me.ride = o.ride; me.dance = false; closePanel(); sound.play('hop'); if (o.ride === 'kart') sound.play('engine'); }
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
    linkify(div, m.content);
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
    if (step && walkable(step[0], step[1])) { me.path = [step]; pending = null; stopFollowing(); }
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
  keepFollowing(dt);
  if (moved && me.dance) setDance(false); // walking off stops the dancing
  // footsteps (not on rides), about two a second
  if (moved && !me.ride) { me.stepClock = (me.stepClock || 0) + dt; if (me.stepClock > 0.32) { me.stepClock = 0; sound.play('step'); } }
  const sittingNow = !moved && !me.ride && !!chairAt.get(`${Math.floor(me.x)},${Math.floor(me.y)}`);
  if (sittingNow && !me.wasSitting) sound.play('sit');
  me.wasSitting = sittingNow;
  // the dance floor music: loud in the middle, fading out over a few squares, off when unavailable
  {
    const cx = (DANCE.x0 + DANCE.x1 + 1) / 2, cy = (DANCE.y0 + DANCE.y1 + 1) / 2;
    const d = Math.hypot(me.x - cx, me.y - cy);
    sound.setMusicLevel(me.meeting ? 0 : Math.max(0, Math.min(1, 1.25 - d / 9)));
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
  else if (onDanceFloor(me.x, me.y) && !panel && !me.dance && !me.path.length) { hint.innerHTML = '<kbd>V</kbd>Dance'; hint.style.display = 'block'; }
  else hint.style.display = 'none';
  const area = showSquares ? (hover && hover[0] >= 0 ? `Square ${hover[0]}, ${hover[1]}` : 'Point at the floor') : areaAt(me.x, me.y) + (isShared(zoneOf(me.x, me.y)) ? ' · everyone here can hear you' : '');
  if (area !== lastArea) { lastArea = area; $('where').textContent = area; $('where').style.display = 'block'; }
}
setInterval(() => { if (me) { rtc.update(me, players); updateRecNotice(); } }, 250);

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
    // signs stack upwards over the name: status, then recording, then any speech bubble
    let up = 19;
    if (p.meeting && !atDesk.has(p)) { pill(STATUS[p.status].label, s.x, s.y - up, STATUS[p.status].color); up += 19; }
    if (p.rec) { pill('● Recording', s.x, s.y - up, '#ef4d5a', '#fff', '700 11px system-ui, sans-serif'); up += 19; }
    if (p.bubble && p.bubble.until > now) bubble(p.bubble.text, s.x, s.y - up + 4);
    else if (p.emoteUntil && p.emoteUntil > now) bubble('👋', s.x, s.y - up + 4);
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
