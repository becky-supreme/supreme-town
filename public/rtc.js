// Proximity audio, video and screen sharing. Browsers call each other directly;
// the server only passes the set-up messages along. Of any two people, the one
// with the smaller id starts and ends the call, so the two sides never disagree.
import { zoneOf, isShared, hearRadius } from './world.js';
import { iceAction } from './media-health.js';

const ICE = [{ urls: 'stun:stun.l.google.com:19302' }];
const RECOVER_WAIT_MS = 4000;

export function createRTC({ send, container, screens }) {
  const peers = new Map(); // id -> { pc, tile, video, streams, screenEl, queue, ready }
  const retryAfter = new Map(); // id -> timestamp, so a dead call doesn't reopen every frame
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

  function noteRemoteAudio(peer, track) {
    const mark = () => {
      if (track.readyState === 'ended') peer.remoteMicDown = true;
    };
    track.addEventListener('ended', mark);
    track.addEventListener('unmute', () => { if (track.readyState === 'live') peer.remoteMicDown = false; });
    mark();
  }

  function open(id, initiator) {
    if (initiator && (retryAfter.get(id) || 0) > Date.now()) return null;
    drop(id);
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const { tile, video } = makeTile(id);
    const peer = {
      pc, tile, video, streams: new Map(), screenEl: null, queue: [], ready: false,
      initiator, senders: { audio: null, video: null }, restartAttempts: 0,
      recoverTimer: null, recovering: false, downSince: 0, remoteMicDown: false,
    };
    peers.set(id, peer);
    pc.onicecandidate = (e) => { if (e.candidate) send(id, { ice: e.candidate }); };
    // Tracks arrive grouped into streams: one for mic + camera, one for a shared screen.
    pc.ontrack = (e) => {
      for (const s of e.streams) peer.streams.set(s.id, s);
      for (const s of e.streams) for (const t of s.getAudioTracks()) noteRemoteAudio(peer, t);
      if (e.track?.kind === 'audio') noteRemoteAudio(peer, e.track);
    };
    const kick = () => considerConnection(id, peer);
    pc.onconnectionstatechange = () => { tile.dataset.state = pc.connectionState; kick(); };
    pc.oniceconnectionstatechange = kick;
    let audio = 0, videos = 0;
    if (local) {
      for (const t of local.getTracks()) {
        const sender = pc.addTrack(t, local);
        if (t.kind === 'audio' && !peer.senders.audio) peer.senders.audio = sender;
        if (t.kind === 'video' && !peer.senders.video) peer.senders.video = sender;
        if (t.kind === 'audio') audio++; else videos++;
      }
    }
    if (screen) for (const t of screen.getVideoTracks()) { pc.addTrack(t, screen); videos++; }
    if (initiator) {
      // Always leave room for the other person's voice, camera and screen,
      // even when we have nothing of our own to send in that slot.
      if (!audio) {
        const trans = pc.addTransceiver('audio', { direction: 'recvonly' });
        peer.senders.audio = trans.sender;
      }
      for (; videos < 2; videos++) pc.addTransceiver('video', { direction: 'recvonly' });
      sendOffer(id, peer).catch((err) => console.warn('offer failed', err));
    }
    return peer;
  }

  function drop(id) {
    const peer = peers.get(id);
    if (!peer) return;
    peers.delete(id);
    clearTimeout(peer.recoverTimer);
    try { peer.pc.close(); } catch { /* already closed */ }
    peer.video.srcObject = null;
    peer.tile.remove();
    peer.screenEl?.remove();
  }

  function considerConnection(id, peer) {
    if (peers.get(id) !== peer) return;
    const ice = peer.pc.iceConnectionState;
    const conn = peer.pc.connectionState;
    const state = conn === 'failed' || ice === 'failed' ? 'failed'
      : (conn === 'disconnected' || ice === 'disconnected') ? 'disconnected'
      : conn;
    if (state === 'connected' || state === 'completed') {
      clearTimeout(peer.recoverTimer);
      peer.recoverTimer = null;
      peer.restartAttempts = 0;
      peer.downSince = 0;
      return;
    }
    if (state === 'disconnected' || state === 'failed') {
      if (!peer.downSince) peer.downSince = Date.now();
    } else peer.downSince = 0;
    const action = iceAction(state, peer.downSince ? Date.now() - peer.downSince : 0, peer.restartAttempts);
    if (action === 'wait') {
      if (!peer.recoverTimer) peer.recoverTimer = setTimeout(() => { peer.recoverTimer = null; considerConnection(id, peer); }, RECOVER_WAIT_MS);
      return;
    }
    if (action === 'restart' || action === 'drop') void recover(id, peer, action);
  }

  // ICE restart keeps the same call. The person who started it sends the new
  // offer; the other side asks them to. After two tries the call is hung up
  // and the usual proximity loop opens a fresh one, after a short pause.
  async function recover(id, peer, action) {
    if (peer.recovering || peers.get(id) !== peer) return;
    peer.recovering = true;
    try {
      if (action === 'drop' || peer.pc.connectionState === 'closed' || peer.pc.signalingState === 'closed') {
        retryAfter.set(id, Date.now() + 1500);
        send(id, { bye: true });
        drop(id);
        return;
      }
      peer.restartAttempts = (peer.restartAttempts || 0) + 1;
      if (!peer.initiator) { send(id, { restart: true }); return; }
      await sendOffer(id, peer, true);
    } catch (err) {
      console.warn('call reconnect failed', err);
      retryAfter.set(id, Date.now() + 1500);
      send(id, { bye: true });
      drop(id);
    } finally {
      if (peers.get(id) === peer) peer.recovering = false;
    }
  }

  async function sendOffer(id, peer, iceRestart = false) {
    if (!peer.initiator || peers.get(id) !== peer) return;
    if (peer.pc.signalingState !== 'stable') return;
    if (iceRestart && typeof peer.pc.restartIce === 'function') peer.pc.restartIce();
    const offer = await peer.pc.createOffer(iceRestart ? { iceRestart: true } : undefined);
    if (peers.get(id) !== peer) return;
    await peer.pc.setLocalDescription(offer);
    send(id, { sdp: peer.pc.localDescription });
  }

  // Swap the mic or camera on calls that are already up, without hanging up.
  async function replaceOutgoingTrack(kind, track) {
    for (const [id, peer] of [...peers.entries()]) {
      if (peers.get(id) !== peer || peer.pc.connectionState === 'closed') continue;
      const sender = peer.senders?.[kind];
      const hadLive = !!(sender?.track && sender.track.readyState === 'live');
      try {
        if (sender) {
          const trans = peer.pc.getTransceivers().find((t) => t.sender === sender);
          if (trans && track && (trans.direction === 'recvonly' || trans.direction === 'inactive')) trans.direction = 'sendrecv';
          await sender.replaceTrack(track);
          if (peer.initiator && track && !hadLive) await sendOffer(id, peer);
        } else if (track && peer.initiator && local) {
          peer.senders[kind] = peer.pc.addTrack(track, local);
          await sendOffer(id, peer);
        } else if (track) {
          // The other side started the call before we had this device, and
          // there's no slot to fill. Hang up so their next offer includes it.
          send(id, { bye: true });
          drop(id);
        }
      } catch (err) {
        console.warn('could not update the call', err);
      }
    }
  }

  async function acceptOffer(from, peer, sdp) {
    peer.queue = [];
    peer.ready = false;
    await peer.pc.setRemoteDescription(sdp);
    if (peers.get(from) !== peer) return;
    peer.ready = true;
    for (const c of peer.queue) await peer.pc.addIceCandidate(c).catch(() => {});
    peer.queue = [];
    const answer = await peer.pc.createAnswer();
    if (peers.get(from) !== peer) return;
    await peer.pc.setLocalDescription(answer);
    send(from, { sdp: peer.pc.localDescription });
  }

  async function handleSignal(from, data, me, players) {
    if (data.bye) return drop(from);
    if (data.restart) {
      const peer = peers.get(from);
      if (peer?.initiator) void recover(from, peer, 'restart');
      return;
    }
    if (data.sdp?.type === 'offer') {
      const existing = peers.get(from);
      if (existing && me && from < me.id) {
        const other = players.get(from);
        if (!other || me.meeting || other.meeting || !inRange(me, other, 0.8)) {
          send(from, { bye: true });
          drop(from);
          return;
        }
        try { await acceptOffer(from, existing, data.sdp); }
        catch (err) {
          console.warn('call update failed', err);
          send(from, { bye: true });
          drop(from);
        }
        return;
      }
      // Answering a call shares our mic and camera, so be strict about who may call:
      // only the agreed caller of the pair (the smaller id), only when neither of us
      // is unavailable, and only when they can really hear us from where they stand.
      const other = players.get(from);
      if (!me || me.meeting || !other || other.meeting || !(from < me.id) || !inRange(me, other, 0.8)) return send(from, { bye: true });
      const peer = open(from, false);
      if (!peer) return;
      await acceptOffer(from, peer, data.sdp);
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
  // slack: extra squares of leeway, so calls don't flicker at the edge of earshot
  function inRange(me, other, slack = 0) {
    const r = reach(me, other);
    if (r.shared) return r.same;
    return r.d <= r.radius + slack;
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
        const want = !other.meeting && inRange(me, other, has ? 0.8 : 0);
        if (want && !has) open(other.id, true);
        else if (!want && has) { send(other.id, { bye: true }); drop(other.id); }
      } else if (has && !inRange(me, other, 2)) {
        // The other person normally ends the call; hang up ourselves if they don't.
        send(other.id, { bye: true }); drop(other.id);
      }
      const peer = peers.get(other.id);
      if (!peer) continue;
      // Which incoming stream is the shared screen? The sharer tells us its id.
      const shared = (other.screen && peer.streams.get(other.screen)) || null;
      const face = [...peer.streams.values()].find((s) => s.id !== other.screen) || null;
      if (peer.video.srcObject !== face) { peer.video.srcObject = face; if (face) peer.video.play().catch(() => {}); }
      showScreen(peer, other, shared);
      peer.video.volume = volumeFor(me, other);
      const liveAudio = [...peer.streams.values()].some((s) => s.getAudioTracks().some((t) => t.readyState === 'live'));
      if (liveAudio && !other.micDown) peer.remoteMicDown = false;
      peer.tile.classList.toggle('camoff', !!other.camOff);
      peer.tile.classList.toggle('novideo', !peer.video.videoWidth);
      peer.tile.classList.toggle('muted', !!other.muted && !other.micDown);
      peer.tile.classList.toggle('nomic', !!other.micDown || !!peer.remoteMicDown);
      peer.tile.querySelector('.nm').textContent = other.name;
      peer.tile.querySelector('.initial').textContent = (other.name || '?')[0].toUpperCase();
      peer.tile.querySelector('.initial').style.background = other.look?.shirt || '#555';
    }
  }

  function closeAll() {
    for (const id of [...peers.keys()]) { send(id, { bye: true }); drop(id); }
  }

  return {
    update, handleSignal, closeAll, drop, replaceOutgoingTrack,
    setLocalStream(stream) { local = stream; },
    setScreenStream(stream) { screen = stream; },
    count: () => peers.size,
    has: (id) => peers.has(id),
    states: () => [...peers.entries()].map(([id, p]) => ({ id, state: p.pc.connectionState, streams: p.streams.size, screen: !!p.screenEl })),
  };
}
