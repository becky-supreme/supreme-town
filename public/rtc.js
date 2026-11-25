// Proximity audio, video and screen sharing. Browsers call each other directly;
// the server only passes the set-up messages along. Of any two people, the one
// with the smaller id starts and ends the call, so the two sides never disagree.
import { zoneOf, isShared, hearRadius } from './world.js';

const ICE = [{ urls: 'stun:stun.l.google.com:19302' }];

export function createRTC({ send, container, screens }) {
  const peers = new Map(); // id -> { pc, tile, video, streams, screenEl, queue, ready }
  let local = null; // mic and camera
  let screen = null; // a shared screen, if we are sharing one

  function makeTile(id) {
    const tile = document.createElement('div');
    tile.className = 'tile';
    tile.dataset.id = id;
    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    const badge = document.createElement('div');
    badge.className = 'initial';
    const name = document.createElement('span');
    name.className = 'nm';
    tile.append(video, badge, name);
    container.append(tile);
    return { tile, video };
  }

  function open(id, initiator) {
    drop(id);
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const { tile, video } = makeTile(id);
    const peer = { pc, tile, video, streams: new Map(), screenEl: null, queue: [], ready: false };
    peers.set(id, peer);
    pc.onicecandidate = (e) => { if (e.candidate) send(id, { ice: e.candidate }); };
    // Tracks arrive grouped into streams: one for mic + camera, one for a shared screen.
    pc.ontrack = (e) => { for (const s of e.streams) peer.streams.set(s.id, s); };
    pc.onconnectionstatechange = () => {
      tile.dataset.state = pc.connectionState;
      if (pc.connectionState === 'failed' && peers.get(id) === peer) drop(id);
    };
    let audio = 0, videos = 0;
    if (local) for (const t of local.getTracks()) { pc.addTrack(t, local); if (t.kind === 'audio') audio++; else videos++; }
    if (screen) for (const t of screen.getVideoTracks()) { pc.addTrack(t, screen); videos++; }
    if (initiator) {
      // Always leave room for the other person's voice, camera and screen,
      // even when we have nothing of our own to send in that slot.
      if (!audio) pc.addTransceiver('audio', { direction: 'recvonly' });
      for (; videos < 2; videos++) pc.addTransceiver('video', { direction: 'recvonly' });
      pc.createOffer()
        .then((o) => pc.setLocalDescription(o))
        .then(() => send(id, { sdp: pc.localDescription }))
        .catch((err) => console.warn('offer failed', err));
    }
    return peer;
  }

  function drop(id) {
    const peer = peers.get(id);
    if (!peer) return;
    peers.delete(id);
    try { peer.pc.close(); } catch { /* already closed */ }
    peer.video.srcObject = null;
    peer.tile.remove();
    peer.screenEl?.remove();
  }

  async function handleSignal(from, data, inMeeting) {
    if (data.bye) return drop(from);
    if (data.sdp?.type === 'offer') {
      if (inMeeting) return send(from, { bye: true });
      const peer = open(from, false);
      await peer.pc.setRemoteDescription(data.sdp);
      peer.ready = true;
      for (const c of peer.queue) await peer.pc.addIceCandidate(c).catch(() => {});
      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(answer);
      send(from, { sdp: peer.pc.localDescription });
      return;
    }
    const peer = peers.get(from);
    if (!peer) return;
    if (data.sdp?.type === 'answer') {
      await peer.pc.setRemoteDescription(data.sdp);
      peer.ready = true;
      for (const c of peer.queue) await peer.pc.addIceCandidate(c).catch(() => {});
    } else if (data.ice) {
      if (peer.ready) await peer.pc.addIceCandidate(data.ice).catch(() => {});
      else peer.queue.push(data.ice);
    }
  }

  // The hearing rules live in world.js: shared spaces are whole-room
  // conversations; everywhere else it depends how close you are.
  function reach(me, other) {
    const za = zoneOf(me.x, me.y), zb = zoneOf(other.x, other.y);
    if (isShared(za) || isShared(zb)) return { shared: true, same: za === zb };
    return { shared: false, radius: Math.min(hearRadius(za), hearRadius(zb)), d: Math.hypot(me.x - other.x, me.y - other.y) };
  }
  // How loudly should we hear someone? 0 means out of earshot.
  function volumeFor(me, other) {
    const r = reach(me, other);
    if (r.shared) return r.same ? 1 : 0;
    if (r.d >= r.radius + 0.8) return 0;
    return Math.max(0.08, Math.min(1, 1 - (r.d - r.radius * 0.35) / (r.radius * 0.9)));
  }
  function inRange(me, other, already) {
    const r = reach(me, other);
    if (r.shared) return r.same;
    return r.d <= r.radius + (already ? 0.8 : 0); // a little slack so calls don't flicker
  }

  function showScreen(peer, other, stream) {
    if (!stream) { peer.screenEl?.remove(); peer.screenEl = null; return; }
    if (!peer.screenEl) {
      const el = document.createElement('div');
      el.className = 'screen';
      const video = document.createElement('video');
      video.autoplay = true; video.playsInline = true; video.muted = true;
      const label = document.createElement('span');
      label.className = 'nm';
      el.append(video, label);
      el.title = 'Click to make bigger or smaller';
      el.onclick = () => el.classList.toggle('big');
      screens.append(el);
      peer.screenEl = el;
    }
    const video = peer.screenEl.querySelector('video');
    if (video.srcObject !== stream) { video.srcObject = stream; video.play().catch(() => {}); }
    peer.screenEl.querySelector('.nm').textContent = `${other.name}'s screen`;
  }

  // Called a few times a second with everyone's latest position.
  function update(me, players) {
    for (const id of [...peers.keys()]) {
      const other = players.get(id);
      if (!other || me.meeting || other.meeting) drop(id);
    }
    if (me.meeting) return;
    for (const other of players.values()) {
      if (other.id === me.id) continue;
      const has = peers.has(other.id);
      if (me.id < other.id) {
        const want = !other.meeting && inRange(me, other, has);
        if (want && !has) open(other.id, true);
        else if (!want && has) { send(other.id, { bye: true }); drop(other.id); }
      }
      const peer = peers.get(other.id);
      if (!peer) continue;
      // Which incoming stream is the shared screen? The sharer tells us its id.
      const shared = (other.screen && peer.streams.get(other.screen)) || null;
      const face = [...peer.streams.values()].find((s) => s.id !== other.screen) || null;
      if (peer.video.srcObject !== face) { peer.video.srcObject = face; if (face) peer.video.play().catch(() => {}); }
      showScreen(peer, other, shared);
      peer.video.volume = volumeFor(me, other);
      peer.tile.classList.toggle('camoff', !!other.camOff);
      peer.tile.classList.toggle('novideo', !peer.video.videoWidth);
      peer.tile.classList.toggle('muted', !!other.muted);
      peer.tile.querySelector('.nm').textContent = other.name;
      peer.tile.querySelector('.initial').textContent = (other.name || '?')[0].toUpperCase();
      peer.tile.querySelector('.initial').style.background = other.look?.shirt || '#555';
    }
  }

  function closeAll() {
    for (const id of [...peers.keys()]) { send(id, { bye: true }); drop(id); }
  }

  return {
    update, handleSignal, closeAll, drop,
    setLocalStream(stream) { local = stream; },
    setScreenStream(stream) { screen = stream; },
    count: () => peers.size,
    states: () => [...peers.entries()].map(([id, p]) => ({ id, state: p.pc.connectionState, streams: p.streams.size, screen: !!p.screenEl })),
  };
}
