// Share music from your computer with the people who can already hear you.
// Chrome and Edge can capture a tab or the screen (the user has to tick Share
// audio). The music goes out on its own call, separate from the microphone, so
// voice keeps its echo cancellation and this stream can stay stereo.
//
// The browser will only capture tab audio together with a video track. That
// video stays on this computer and is never sent. Stopping it would stop the
// audio too, which is why it is held open until sharing ends.
import { inEarshot, musicConflict, musicVolume, tuneMusicSdp } from './music-rules.js';

const ICE = [{ urls: 'stun:stun.l.google.com:19302' }];
const VOL_KEY = 'hq.musicVol';
const MUTE_KEY = 'hq.musicMuted';
const MUSIC_BITRATE = 510000;

export function musicCaptureSupport() {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) {
    return { ok: false, reason: 'insecure' };
  }
  const ua = navigator.userAgent || '';
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const firefox = /Firefox\//.test(ua);
  const safari = /Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\/|OPR\//.test(ua);
  if (ios || firefox || safari) return { ok: false, reason: 'browser' };
  return { ok: true, reason: '' };
}

const UNSUPPORTED = "This browser can't share music from your computer. Use Chrome or Edge, tick Share audio, and pick a tab or your screen. Safari and Firefox can't capture that audio.";
const INSECURE = "Sharing music needs a secure page (https, or localhost) in Chrome or Edge. Tick Share audio and pick a tab or your screen.";
const NO_AUDIO = "No audio came through. Tick Share audio in the browser prompt, then pick a tab or your screen.";
const HOW = "In the browser prompt, tick Share audio and pick a tab or your screen. People in this room, or nearby, hear it on their speakers. One person plays at a time.";

function remembered() {
  let volume = 0.7, muted = false;
  try {
    const raw = localStorage.getItem(VOL_KEY);
    const v = raw == null || raw === '' ? NaN : Number(raw);
    if (Number.isFinite(v)) volume = Math.min(1, Math.max(0, v));
    muted = localStorage.getItem(MUTE_KEY) === '1';
  } catch { /* private window */ }
  return { volume, muted };
}

function streamKey(stream) {
  const safe = String(stream?.id || '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 80);
  return safe || `music-${Math.random().toString(36).slice(2, 12)}`;
}
function niceLabel(label) {
  const s = String(label || '').replace(/\s+/g, ' ').trim();
  if (!s || /^(audio|tab audio|system audio|screen audio|window audio|default|microphone)$/i.test(s)) return '';
  return s.length > 70 ? `${s.slice(0, 69)}…` : s;
}

export function createMusic({ send, toast, getMe, getPlayers }) {
  const prefs = remembered();
  let volume = prefs.volume;
  let userMuted = prefs.muted;
  let captured = null; // the display capture, video included, kept only locally
  let audioTrack = null;
  let sharing = false; // we asked the server, or it agreed
  const peers = new Map(); // id -> { pc, audio, queue, ready }
  const retryAt = new Map();
  let sinkVideo = null;

  const style = document.createElement('style');
  style.textContent = `
    #musicPop { position: fixed; left: 50%; bottom: 78px; transform: translateX(-50%); z-index: 16; width: min(440px, calc(100vw - 24px)); background: rgba(28,23,52,.98); border: 1px solid var(--accent); border-radius: 16px; padding: 14px 16px; box-shadow: 0 12px 40px rgba(0,0,0,.45); }
    #musicPop[hidden] { display: none !important; }
    #musicPop h3 { margin: 0 0 6px; font-size: 16px; }
    #musicPop p { margin: 0 0 8px; color: var(--muted); }
    #musicPop strong { color: var(--text); font-weight: 650; }
    #musicPop .acts { display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px; }
    #musicPop button { border: 1px solid var(--line); background: #2d2752; border-radius: 10px; padding: 8px 12px; }
    #musicPop button.primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
    #nowPlaying { position: fixed; left: 50%; bottom: 78px; transform: translateX(-50%); z-index: 6; display: flex; align-items: center; gap: 8px; max-width: calc(100vw - 20px); background: rgba(28,23,52,.95); border: 1px solid var(--accent); border-radius: 999px; padding: 6px 8px 6px 14px; box-shadow: 0 8px 28px rgba(0,0,0,.35); }
    #nowPlaying[hidden] { display: none !important; }
    #nowPlaying .np-text { font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: min(52vw, 520px); }
    #nowPlaying button { border: 1px solid var(--line); background: #2d2752; border-radius: 999px; padding: 5px 10px; white-space: nowrap; }
    #nowPlaying button.off { background: #4a2233; border-color: #7a3346; color: #ffb3ba; }
    #nowPlaying label.vol { display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 12px; }
    #nowPlaying input[type=range] { width: 108px; accent-color: var(--accent); }
    #musicSink { position: fixed; width: 0; height: 0; overflow: hidden; }
    body.music-on #hint { bottom: 132px; }
  `;
  document.head.append(style);

  const btn = document.createElement('button');
  btn.id = 'btnMusic';
  btn.type = 'button';
  btn.textContent = 'Share music';
  btn.title = HOW;
  const screenBtn = document.getElementById('btnScreen');
  const toolbar = document.getElementById('toolbar');
  if (toolbar) toolbar.insertBefore(btn, screenBtn || null);

  const pop = document.createElement('div');
  pop.id = 'musicPop';
  pop.hidden = true;
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-labelledby', 'musicPopTitle');
  const popTitle = document.createElement('h3');
  popTitle.id = 'musicPopTitle';
  popTitle.textContent = 'Share music';
  const popText = document.createElement('p');
  const popHint = document.createElement('p');
  const popActs = document.createElement('div');
  popActs.className = 'acts';
  const goBtn = document.createElement('button');
  goBtn.type = 'button';
  goBtn.className = 'primary';
  goBtn.id = 'musicGo';
  goBtn.textContent = 'Choose what to share';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.id = 'musicCancel';
  cancelBtn.textContent = 'Cancel';
  popActs.append(cancelBtn, goBtn);
  pop.append(popTitle, popText, popHint, popActs);
  document.body.append(pop);

  const bar = document.createElement('div');
  bar.id = 'nowPlaying';
  bar.hidden = true;
  bar.setAttribute('role', 'status');
  const barText = document.createElement('span');
  barText.className = 'np-text';
  const muteBtn = document.createElement('button');
  muteBtn.type = 'button';
  muteBtn.id = 'musicMute';
  const volLabel = document.createElement('label');
  volLabel.className = 'vol';
  volLabel.append('Music');
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.id = 'musicVol';
  slider.min = '0';
  slider.max = '100';
  slider.value = String(Math.round(volume * 100));
  slider.setAttribute('aria-label', 'Shared music volume');
  volLabel.append(slider);
  const stopBtn = document.createElement('button');
  stopBtn.type = 'button';
  stopBtn.id = 'musicStop';
  stopBtn.textContent = 'Stop';
  bar.append(barText, muteBtn, volLabel, stopBtn);
  document.body.append(bar);

  const sink = document.createElement('div');
  sink.id = 'musicSink';
  sink.setAttribute('aria-hidden', 'true');
  document.body.append(sink);

  function persist() {
    try {
      localStorage.setItem(VOL_KEY, String(volume));
      localStorage.setItem(MUTE_KEY, userMuted ? '1' : '0');
    } catch { /* ignore */ }
  }
  function signal(to, data) { send({ t: 'music-signal', to, data }); }
  function support() { return musicCaptureSupport(); }

  function closePrompt() { pop.hidden = true; }
  function openPrompt() {
    const me = getMe();
    if (!me) return;
    const sup = support();
    const other = sup.ok && me.status === 'available' ? musicConflict(me, getPlayers().values()) : null;
    popTitle.textContent = 'Share music';
    if (!sup.ok) {
      popText.textContent = sup.reason === 'insecure' ? INSECURE : UNSUPPORTED;
      popHint.textContent = '';
      goBtn.hidden = true;
    } else if (me.meeting) {
      popText.textContent = 'Set yourself to Available first. While you are in a meeting or busy, you can neither play music nor hear it.';
      popHint.textContent = '';
      goBtn.hidden = true;
    } else if (other) {
      popText.textContent = `${other.name} is already playing music here. One person at a time.`;
      popHint.textContent = HOW;
      goBtn.hidden = true;
    } else {
      popText.textContent = 'People in this room, or nearby, will hear the music through their own speakers. You keep hearing it on your computer.';
      popHint.textContent = '';
      popHint.append('In the next prompt, tick ');
      const b = document.createElement('strong');
      b.textContent = 'Share audio';
      popHint.append(b, ' and pick a tab or your screen.');
      goBtn.hidden = false;
    }
    pop.hidden = false;
    (goBtn.hidden ? cancelBtn : goBtn).focus();
  }

  function hold(stream) {
    sinkVideo?.remove();
    sinkVideo = document.createElement('video');
    sinkVideo.muted = true;
    sinkVideo.playsInline = true;
    sinkVideo.setAttribute('aria-hidden', 'true');
    sinkVideo.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px;opacity:0';
    sink.append(sinkVideo);
    sinkVideo.srcObject = stream;
    sinkVideo.play().catch(() => {});
  }
  function releaseCapture() {
    sharing = false;
    audioTrack = null;
    captured?.getTracks().forEach((t) => { try { t.stop(); } catch { /* already ended */ } });
    captured = null;
    sinkVideo?.remove();
    sinkVideo = null;
  }

  function stop({ tell = true } = {}) {
    const was = sharing || !!captured;
    releaseCapture();
    closeAll();
    if (tell && was) send({ t: 'music', on: false });
    const me = getMe();
    if (me && was) { me.music = null; me.musicLabel = null; }
    refresh();
  }

  async function beginCapture() {
    const me = getMe();
    if (!me || sharing) return;
    const sup = support();
    if (!sup.ok) { toast(sup.reason === 'insecure' ? INSECURE : UNSUPPORTED, [], 9000); return; }
    if (me.meeting) { toast('Set yourself to Available to share music.'); return; }
    const other = musicConflict(me, getPlayers().values());
    if (other) { toast(`${other.name} is already playing music here. One person at a time.`, [], 7000); return; }
    closePrompt();
    let stream;
    const video = { frameRate: { ideal: 1, max: 5 }, width: { ideal: 16, max: 320 }, height: { ideal: 16, max: 240 } };
    const audio = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: { ideal: 2 },
      sampleRate: { ideal: 48000 },
    };
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video, audio,
        systemAudio: 'include',
        selfBrowserSurface: 'include',
        surfaceSwitching: 'include',
        monitorTypeSurfaces: 'include',
      });
    } catch (err) {
      if (err?.name === 'NotAllowedError' || err?.name === 'AbortError') return; // they closed the prompt
      try { stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }); }
      catch (err2) {
        if (err2?.name === 'NotAllowedError' || err2?.name === 'AbortError') return;
        toast(err2?.name === 'NotSupportedError' ? UNSUPPORTED : "Couldn't capture audio from this browser.", [], 9000);
        return;
      }
    }
    if (!getMe() || getMe().meeting) { stream.getTracks().forEach((t) => t.stop()); return; }
    const track = stream.getAudioTracks()[0];
    if (!track) {
      stream.getTracks().forEach((t) => t.stop());
      toast(NO_AUDIO, [], 9000);
      openPrompt();
      popText.textContent = NO_AUDIO;
      return;
    }
    try {
      await track.applyConstraints({ echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2, sampleRate: 48000 });
    } catch {
      try { await track.applyConstraints({ echoCancellation: false, noiseSuppression: false, autoGainControl: false }); } catch { /* the track stays as the browser gave it */ }
    }
    try { track.contentHint = 'music'; } catch { /* older browsers */ }
    captured = stream;
    audioTrack = track;
    sharing = true;
    const label = niceLabel(track.label) || niceLabel(stream.getVideoTracks()[0]?.label) || '';
    hold(stream);
    const ended = () => { if (captured === stream) stop(); };
    track.addEventListener('ended', ended);
    stream.getVideoTracks().forEach((t) => t.addEventListener('ended', ended));
    send({ t: 'music', on: true, id: streamKey(stream), label });
    refresh();
  }

  function drop(id) {
    const peer = peers.get(id);
    if (!peer) return;
    peers.delete(id);
    try { peer.pc.close(); } catch { /* already closed */ }
    peer.audio.srcObject = null;
    peer.audio.remove();
  }
  function closeAll() {
    for (const id of [...peers.keys()]) { signal(id, { bye: true }); drop(id); }
  }

  async function bumpBitrate(pc) {
    const sender = pc.getSenders().find((s) => s.track?.kind === 'audio');
    if (!sender) return;
    try {
      const params = sender.getParameters();
      if (!params.encodings?.length) params.encodings = [{}];
      params.encodings[0].maxBitrate = MUSIC_BITRATE;
      await sender.setParameters(params);
    } catch { /* the SDP bitrate still applies */ }
  }

  function ensurePeer(id) {
    const existing = peers.get(id);
    if (existing) return existing;
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.playsInline = true;
    audio.dataset.peer = id;
    sink.append(audio);
    const peer = { pc, audio, queue: [], ready: false };
    peers.set(id, peer);
    pc.onicecandidate = (e) => { if (e.candidate) signal(id, { ice: e.candidate }); };
    pc.ontrack = (e) => {
      audio.srcObject = e.streams[0] || new MediaStream([e.track]);
      applyOne(id);
      audio.play().catch(() => {});
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') bumpBitrate(pc);
      if (pc.connectionState === 'failed' && peers.get(id) === peer) {
        retryAt.set(id, performance.now() + 1500);
        drop(id);
      }
    };
    return peer;
  }

  async function call(id) {
    if (peers.has(id) || (retryAt.get(id) || 0) > performance.now()) return;
    if (!audioTrack || audioTrack.readyState !== 'live') return;
    const peer = ensurePeer(id);
    try {
      const stream = new MediaStream([audioTrack]);
      peer.pc.addTransceiver(audioTrack, { direction: 'sendonly', streams: [stream] });
      await bumpBitrate(peer.pc);
      const offer = await peer.pc.createOffer();
      await peer.pc.setLocalDescription({ type: 'offer', sdp: tuneMusicSdp(offer.sdp) });
      signal(id, { sdp: peer.pc.localDescription });
    } catch (err) {
      console.warn('music offer failed', err);
      retryAt.set(id, performance.now() + 1500);
      drop(id);
    }
  }

  function applyOne(id) {
    const me = getMe();
    const other = getPlayers().get(id);
    const peer = peers.get(id);
    if (!me || !other || !peer) return;
    const spatial = musicVolume(me, other);
    const level = userMuted ? 0 : spatial * volume;
    peer.audio.muted = userMuted || level === 0;
    peer.audio.volume = Math.max(0, Math.min(1, level));
  }
  function applyAll() {
    for (const id of peers.keys()) applyOne(id);
  }

  function heard() {
    const me = getMe();
    if (!me || me.meeting) return [];
    const out = [];
    for (const p of getPlayers().values()) {
      if (p === me || !p.music || p.meeting) continue;
      if (musicVolume(me, p) > 0) out.push(p);
    }
    return out;
  }

  function refresh() {
    const me = getMe();
    const mine = !!(sharing && captured);
    btn.textContent = mine ? 'Stop music' : 'Share music';
    btn.classList.toggle('sharing', mine);
    btn.disabled = !!(me && me.meeting && !mine);
    btn.title = mine ? 'Stop sharing music' : HOW;
    const list = heard();
    const show = mine || list.length > 0;
    bar.hidden = !show;
    document.body.classList.toggle('music-on', show);
    stopBtn.hidden = !mine;
    muteBtn.hidden = mine;
    volLabel.hidden = mine;
    if (mine) {
      const label = niceLabel(audioTrack?.label) || niceLabel(captured?.getVideoTracks?.()[0]?.label) || me?.musicLabel || '';
      barText.textContent = label ? `You're sharing music · ${label}` : "You're sharing music";
    } else if (list.length) {
      const names = list.map((p) => p.name).join(' and ');
      const label = list.map((p) => niceLabel(p.musicLabel)).filter(Boolean)[0] || '';
      barText.textContent = label ? `Now playing: ${names} · ${label}` : `Now playing: ${names}`;
    }
    muteBtn.textContent = userMuted ? 'Unmute music' : 'Mute music';
    muteBtn.classList.toggle('off', userMuted);
    muteBtn.setAttribute('aria-pressed', userMuted ? 'true' : 'false');
    if (document.activeElement !== slider) slider.value = String(Math.round(volume * 100));
  }

  function update() {
    const me = getMe();
    const players = getPlayers();
    if (!me) return;
    if (me.meeting) {
      if (sharing) stop();
      else closeAll();
      refresh();
      return;
    }
    for (const id of [...peers.keys()]) {
      const other = players.get(id);
      const keep = other && !other.meeting && (me.music || other.music) && inEarshot(me, other, 0.8);
      if (!keep) { signal(id, { bye: true }); drop(id); }
    }
    // Only the person sharing places the calls, so the two sides never both offer.
    if (sharing && me.music && audioTrack) {
      for (const other of players.values()) {
        if (other.id === me.id || other.meeting || peers.has(other.id)) continue;
        if (inEarshot(me, other, 0)) call(other.id);
      }
    }
    applyAll();
    refresh();
  }

  async function handleSignal(from, data) {
    const me = getMe();
    const players = getPlayers();
    if (!me || !data) return;
    if (data.bye) return drop(from);
    if (data.sdp?.type === 'offer') {
      const other = players.get(from);
      if (me.meeting || !other?.music || other.meeting || !inEarshot(me, other, 0.8)) return signal(from, { bye: true });
      drop(from);
      const peer = ensurePeer(from);
      try {
        await peer.pc.setRemoteDescription(data.sdp);
        peer.ready = true;
        for (const c of peer.queue) await peer.pc.addIceCandidate(c).catch(() => {});
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription({ type: 'answer', sdp: tuneMusicSdp(answer.sdp) });
        signal(from, { sdp: peer.pc.localDescription });
      } catch (err) {
        console.warn('music answer failed', err);
        drop(from);
      }
      return;
    }
    const peer = peers.get(from);
    if (!peer) return;
    try {
      if (data.sdp?.type === 'answer') {
        await peer.pc.setRemoteDescription(data.sdp);
        peer.ready = true;
        for (const c of peer.queue) await peer.pc.addIceCandidate(c).catch(() => {});
      } else if (data.ice) {
        if (peer.ready) await peer.pc.addIceCandidate(data.ice).catch(() => {});
        else peer.queue.push(data.ice);
      }
    } catch (err) {
      console.warn('music signal failed', err);
    }
  }

  function onServer(m) {
    const me = getMe();
    if (!me || m.id !== me.id) return;
    if (m.music) return;
    if (!sharing && !captured) return;
    const denied = !!m.denied;
    const stopped = m.stopped || '';
    const by = m.by || 'Someone';
    stop({ tell: false });
    if (denied) toast(`${by} is already playing music here. One person at a time.`, [], 8000);
    else if (stopped === 'room') toast(`${by} is already playing music where you walked, so yours stopped.`, [], 8000);
    else if (stopped !== 'status') toast("Couldn't share that music. If someone is already playing here, one person at a time.", [], 8000);
  }

  function handle(m) {
    if (m.t === 'music') {
      const p = getPlayers().get(m.id);
      if (p) { p.music = m.music || null; p.musicLabel = m.musicLabel || null; }
      onServer(m);
      update();
    } else if (m.t === 'music-signal') {
      handleSignal(m.from, m.data).catch((err) => console.warn('music signal failed', err));
    }
  }

  function reannounce() {
    if (!captured || !audioTrack || audioTrack.readyState !== 'live') return;
    sharing = true;
    const label = niceLabel(audioTrack.label) || niceLabel(captured.getVideoTracks()[0]?.label) || '';
    send({ t: 'music', on: true, id: streamKey(captured), label });
    refresh();
  }

  btn.onclick = () => {
    if (sharing) stop();
    else openPrompt();
  };
  goBtn.onclick = () => beginCapture();
  cancelBtn.onclick = () => closePrompt();
  stopBtn.onclick = () => stop();
  muteBtn.onclick = () => {
    userMuted = !userMuted;
    persist();
    applyAll();
    refresh();
    for (const p of peers.values()) p.audio.play?.().catch(() => {});
  };
  slider.addEventListener('input', () => {
    volume = Number(slider.value) / 100;
    persist();
    applyAll();
    for (const p of peers.values()) p.audio.play?.().catch(() => {});
  });

  refresh();
  return {
    handle, update, stop, closeAll, reannounce, closePrompt, refresh,
    debug: () => ({ sharing: !!(sharing && captured), peers: [...peers.keys()].map((id) => ({ id, state: peers.get(id).pc.connectionState })), volume, muted: userMuted }),
  };
}
