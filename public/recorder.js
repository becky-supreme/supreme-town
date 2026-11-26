// Recording a call to your own computer. Nothing goes to the server: the browser
// draws everyone's camera (and any shared screen) onto one picture, mixes
// everyone's voice together, and saves a video file to Downloads when you stop.
// You can only record people you can already hear, because it records the call
// tiles that are on your screen.

const WIDTH = 1280, HEIGHT = 720, FPS = 20;
const MAX_MINUTES = 90; // long recordings live in memory until saved, so stop at 90 minutes

export const canRecord = () => !!(window.MediaRecorder && HTMLCanvasElement.prototype.captureStream && (window.AudioContext || window.webkitAudioContext));

export function createRecorder({ videos, screens, myScreen, myName = () => 'You', onChange = () => {} }) {
  let rec = null;

  function pickType() {
    for (const t of ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']) {
      if (MediaRecorder.isTypeSupported?.(t)) return t;
    }
    return '';
  }

  // Every stream with a voice in it (yours and everyone you're talking to) goes into the mix.
  function syncAudio() {
    const want = new Map();
    for (const v of videos.querySelectorAll('video')) {
      const s = v.srcObject;
      if (s && s.getAudioTracks().length) want.set(s.id, s);
    }
    for (const [id, node] of rec.sources) if (!want.has(id)) { node.disconnect(); rec.sources.delete(id); }
    for (const [id, s] of want) {
      if (rec.sources.has(id)) continue;
      try { const n = rec.ac.createMediaStreamSource(s); n.connect(rec.dest); rec.sources.set(id, n); } catch { /* stream already ended */ }
    }
  }

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  // Draws a video inside a box, either filling it (cover) or fitting it whole.
  function drawVideo(g, video, x, y, w, h, cover) {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return false;
    const k = cover ? Math.max(w / vw, h / vh) : Math.min(w / vw, h / vh);
    const dw = vw * k, dh = vh * k;
    g.save();
    roundRect(g, x, y, w, h, 12); g.clip();
    g.drawImage(video, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    g.restore();
    return true;
  }
  function drawFace(g, f, x, y, w, h) {
    g.fillStyle = '#231d42';
    roundRect(g, x, y, w, h, 12); g.fill();
    if (!(f.show && drawVideo(g, f.video, x, y, w, h, true))) {
      const r = Math.min(w, h) * 0.22;
      g.fillStyle = f.color || '#8b5cf6';
      g.beginPath(); g.arc(x + w / 2, y + h / 2, r, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = `700 ${Math.round(r)}px system-ui, sans-serif`;
      g.fillText(f.initial, x + w / 2, y + h / 2 + 1);
    }
    g.font = '600 15px system-ui, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle';
    const label = f.muted ? `${f.name} · muted` : f.name;
    const tw = g.measureText(label).width;
    g.fillStyle = 'rgba(10,8,22,.75)';
    roundRect(g, x + 8, y + h - 34, tw + 20, 26, 8); g.fill();
    g.fillStyle = '#fff'; g.fillText(label, x + 18, y + h - 21);
  }

  function draw() {
    const { g } = rec;
    g.fillStyle = '#120f22'; g.fillRect(0, 0, WIDTH, HEIGHT);
    const faces = [...videos.querySelectorAll('.tile')].map((t) => ({
      video: t.querySelector('video'),
      name: (t.classList.contains('me') ? myName() : t.querySelector('.nm')?.textContent) || '',
      initial: t.querySelector('.initial')?.textContent || '?',
      color: t.querySelector('.initial')?.style.background,
      show: !t.classList.contains('novideo') && !t.classList.contains('camoff'),
      muted: t.classList.contains('muted'),
    }));
    const shared = [...screens.querySelectorAll('video')].filter((v) => v.videoWidth);
    if (myScreen()) {
      if (!rec.myScreenVideo || rec.myScreenVideo.srcObject !== myScreen()) {
        const v = document.createElement('video');
        v.muted = true; v.playsInline = true; v.srcObject = myScreen(); v.play().catch(() => {});
        rec.myScreenVideo = v;
      }
      if (rec.myScreenVideo.videoWidth) shared.unshift(rec.myScreenVideo);
    } else rec.myScreenVideo = null;

    const top = 44, pad = 12;
    if (shared.length) {
      // a shared screen takes the stage, with everyone's faces down the right-hand side
      const side = faces.length ? 260 : 0;
      drawVideo(g, shared[0], pad, top, WIDTH - side - pad * 2 - (side ? pad : 0), HEIGHT - top - pad, false);
      const fh = Math.min(170, (HEIGHT - top - pad) / Math.max(1, faces.length) - pad);
      faces.forEach((f, i) => drawFace(g, f, WIDTH - side - pad, top + i * (fh + pad), side, fh));
    } else {
      // everyone in a tidy grid
      const n = Math.max(1, faces.length);
      const cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
      const cw = (WIDTH - pad * (cols + 1)) / cols, ch = (HEIGHT - top - pad * rows) / rows;
      const w = Math.min(cw, ch * 4 / 3), h = w * 3 / 4;
      faces.forEach((f, i) => {
        const r = Math.floor(i / cols), c = i % cols;
        const inRow = Math.min(cols, n - r * cols);
        const x0 = (WIDTH - (inRow * w + (inRow - 1) * pad)) / 2;
        const y0 = top + (HEIGHT - top - (rows * h + (rows - 1) * pad)) / 2;
        drawFace(g, f, x0 + c * (w + pad), y0 + r * (h + pad), w, h);
      });
    }
    // the header: a recording dot, the town's name and how long it has been going
    g.fillStyle = '#ef4d5a'; g.beginPath(); g.arc(24, 22, 7, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.font = '700 16px system-ui, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText(`Supreme Town · ${elapsedText()}`, 40, 23);
  }

  function elapsedText() {
    const s = rec ? Math.floor((Date.now() - rec.started) / 1000) : 0;
    const mm = String(Math.floor(s / 60)).padStart(2, '0'), ss = String(s % 60).padStart(2, '0');
    return s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
  }

  function tick() {
    if (!rec) return;
    if (++rec.ticks % 10 === 0) syncAudio();
    draw();
    if (rec.ticks % FPS === 0) onChange();
    if (Date.now() - rec.started > MAX_MINUTES * 60000) stop('time');
  }

  async function start() {
    if (rec || !canRecord()) return false;
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH; canvas.height = HEIGHT;
    const AC = window.AudioContext || window.webkitAudioContext;
    const ac = new AC();
    await ac.resume().catch(() => {});
    const dest = ac.createMediaStreamDestination();
    // A silent hum keeps the sound track running when nobody is talking; without it
    // some browsers record nothing at all until the first voice arrives.
    const hum = ac.createConstantSource(), hush = ac.createGain();
    hush.gain.value = 0;
    hum.connect(hush); hush.connect(dest); hum.start();
    const stream = new MediaStream([...canvas.captureStream(FPS).getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const type = pickType();
    let mr;
    try { mr = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), videoBitsPerSecond: 1_000_000, audioBitsPerSecond: 96_000 }); }
    catch { ac.close(); return false; }
    // Background tabs slow ordinary timers right down, so the drawing is paced by a
    // tiny worker, which keeps the video smooth even when you switch tabs.
    const ticker = new Worker(URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), ${Math.round(1000 / FPS)});`], { type: 'text/javascript' })));
    rec = { mr, chunks: [], canvas, g: canvas.getContext('2d'), ac, dest, sources: new Map(), started: Date.now(), ticks: 0, ticker, type: mr.mimeType || type, why: null };
    const mine = rec;
    mr.ondataavailable = (e) => { if (e.data.size) mine.chunks.push(e.data); };
    mr.onstop = () => save(mine);
    ticker.onmessage = tick;
    syncAudio();
    draw();
    mr.start(1000);
    onChange();
    return true;
  }

  // why: 'time' when it hit the 90-minute limit; anything else is a normal stop
  function stop(why = null) {
    if (!rec) return;
    const mine = rec;
    rec = null;
    mine.why = why;
    mine.ticker.terminate();
    try { mine.mr.stop(); } catch { save(mine); }
    onChange(why);
  }

  function save(r) {
    for (const n of r.sources.values()) n.disconnect();
    r.ac.close().catch(() => {});
    if (!r.chunks.length) return;
    const ext = /mp4/.test(r.type) ? 'mp4' : 'webm';
    const blob = new Blob(r.chunks, { type: r.type || 'video/webm' });
    const d = new Date(r.started);
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}.${String(d.getMinutes()).padStart(2, '0')}`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Supreme Town call ${stamp}.${ext}`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }

  return { start, stop, active: () => !!rec, elapsed: elapsedText };
}
