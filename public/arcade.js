// The arcade cabinets. One game so far: Lead Volley, a 1v1 paddle duel.
// Walk up to a cabinet and press E. The first person there plays the computer
// until a second person joins the same cabinet; then it's head to head.
// The first player's browser runs the game and sends the picture of play to
// the second, through the server.
//
// To add another game later: give it the same shape as `leadVolley` below
// (start, step, draw, input) and pick it by the cabinet's `game` name.

const FW = 480, FH = 300; // the playing field
const PAD_H = 62, PAD_W = 10, BALL = 7, WIN = 5;

const leadVolley = {
  name: 'Lead Volley',
  start: () => ({ ball: serve(1), pads: [FH / 2, FH / 2], score: [0, 0], over: null, pause: 1.2, rally: 0 }),
  // Runs on the host only. inputs: where each paddle wants to be (null = the computer plays it).
  step(s, dt, inputs) {
    for (const side of [0, 1]) {
      const want = inputs[side] ?? cpuTarget(s, side);
      const max = (inputs[side] === null ? 215 : 900) * dt; // the computer is beatable
      s.pads[side] += Math.max(-max, Math.min(max, want - s.pads[side]));
      s.pads[side] = Math.max(PAD_H / 2, Math.min(FH - PAD_H / 2, s.pads[side]));
    }
    if (s.over) { s.pause -= dt; if (s.pause <= 0) Object.assign(s, leadVolley.start()); return; }
    if (s.pause > 0) { s.pause -= dt; return; }
    const b = s.ball;
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.y < BALL) { b.y = BALL; b.vy = Math.abs(b.vy); }
    if (b.y > FH - BALL) { b.y = FH - BALL; b.vy = -Math.abs(b.vy); }
    for (const side of [0, 1]) {
      const px = side === 0 ? 22 : FW - 22;
      const towards = side === 0 ? b.vx < 0 : b.vx > 0;
      if (towards && Math.abs(b.x - px) < BALL + PAD_W / 2 && Math.abs(b.y - s.pads[side]) < PAD_H / 2 + BALL) {
        const speed = Math.min(640, Math.hypot(b.vx, b.vy) * 1.06);
        const angle = ((b.y - s.pads[side]) / (PAD_H / 2)) * 0.95; // hit near the edge for a sharper angle
        b.vx = Math.cos(angle) * speed * (side === 0 ? 1 : -1);
        b.vy = Math.sin(angle) * speed;
        b.x = px + (side === 0 ? 1 : -1) * (BALL + PAD_W / 2);
        s.rally++;
      }
    }
    const scorer = b.x < -20 ? 1 : b.x > FW + 20 ? 0 : -1;
    if (scorer >= 0) {
      s.score[scorer]++;
      s.rally = 0;
      if (s.score[scorer] >= WIN) { s.over = scorer; s.pause = 4.5; }
      else { s.ball = serve(scorer === 0 ? -1 : 1); s.pause = 0.9; }
    }
  },
  draw(g, s, names, mySide) {
    g.fillStyle = '#0f1020'; g.fillRect(0, 0, FW, FH);
    g.strokeStyle = 'rgba(255,255,255,0.14)'; g.lineWidth = 2; g.setLineDash([8, 10]);
    g.beginPath(); g.moveTo(FW / 2, 0); g.lineTo(FW / 2, FH); g.stroke(); g.setLineDash([]);
    g.font = '800 44px system-ui, sans-serif'; g.textAlign = 'center'; g.fillStyle = 'rgba(255,255,255,0.2)';
    g.fillText(s.score[0], FW / 2 - 60, 54); g.fillText(s.score[1], FW / 2 + 60, 54);
    g.font = '600 12px system-ui, sans-serif';
    [0, 1].forEach((side) => {
      const color = side === 0 ? '#ff3df2' : '#27e0ff';
      g.fillStyle = color; g.shadowColor = color; g.shadowBlur = 14;
      g.fillRect((side === 0 ? 22 : FW - 22) - PAD_W / 2, s.pads[side] - PAD_H / 2, PAD_W, PAD_H);
      g.shadowBlur = 0;
      g.fillText(names[side] + (side === mySide ? ' (you)' : ''), side === 0 ? FW * 0.25 : FW * 0.75, FH - 12);
    });
    if (!s.over) {
      g.fillStyle = '#ffd24a'; g.shadowColor = '#ffd24a'; g.shadowBlur = 16;
      g.beginPath(); g.arc(s.ball.x, s.ball.y, BALL, 0, Math.PI * 2); g.fill(); g.shadowBlur = 0;
    } else {
      g.fillStyle = '#ffd24a'; g.font = '800 30px system-ui, sans-serif';
      g.fillText(`${names[s.over]} wins!`, FW / 2, FH / 2 - 6);
      g.font = '600 13px system-ui, sans-serif'; g.fillStyle = '#d9d4f5';
      g.fillText('Next game starts in a moment', FW / 2, FH / 2 + 20);
    }
    g.textAlign = 'left';
  },
};
function serve(dir) {
  const angle = (Math.random() - 0.5) * 0.9;
  return { x: FW / 2, y: FH / 2, vx: Math.cos(angle) * 250 * dir, vy: Math.sin(angle) * 250 };
}
function cpuTarget(s, side) {
  const coming = side === 0 ? s.ball.vx < 0 : s.ball.vx > 0;
  return coming ? s.ball.y : FH / 2;
}

export function createArcade({ send, myId }) {
  const game = leadVolley;
  let cab = null; // the cabinet we are at
  let seats = []; // [{ id, name }], host first
  let state = game.start();
  let remoteInput = null; // the guest's paddle, as last heard by the host
  let myTarget = FH / 2;
  let lastSend = 0;
  const keys = new Set();

  // ---- the screen ----
  const style = document.createElement('style');
  style.textContent = `
    #arcade { position: fixed; inset: 0; z-index: 15; display: none; align-items: center; justify-content: center; background: rgba(12,10,24,.72); padding: 12px; }
    #arcade.open { display: flex; }
    #arcade .cab { background: #221d3d; border: 2px solid #8b5cf6; border-radius: 18px; padding: 16px; width: min(560px, 100%); box-shadow: 0 0 60px rgba(139,92,246,.5); }
    #arcade h2 { margin: 0 0 4px; font-size: 20px; display: flex; justify-content: space-between; align-items: center; }
    #arcade h2 button { background: none; border: 0; color: #a59fc7; font-size: 24px; cursor: pointer; }
    #arcade p { margin: 0 0 10px; color: #a59fc7; min-height: 1.4em; }
    #arcade canvas { position: static; width: 100%; height: auto; display: block; border-radius: 10px; cursor: none; touch-action: none; }`;
  document.head.append(style);
  const root = document.createElement('div');
  root.id = 'arcade';
  root.innerHTML = '<div class="cab"><h2><span></span><button aria-label="Leave the game">×</button></h2><p></p><canvas></canvas><p style="margin:10px 0 0;font-size:12px">Move with your mouse, or the up and down arrow keys. First to 5 wins. Press Esc to leave.</p></div>';
  document.body.append(root);
  const canvas = root.querySelector('canvas');
  canvas.width = FW * 2; canvas.height = FH * 2;
  const g = canvas.getContext('2d');
  root.querySelector('h2 span').textContent = game.name;
  const status = root.querySelector('p');
  root.querySelector('button').onclick = () => close();
  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    myTarget = ((e.clientY - r.top) / r.height) * FH;
  });
  addEventListener('keydown', (e) => { if (cab) keys.add(e.key.toLowerCase()); });
  addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

  const mySide = () => Math.max(0, seats.findIndex((s) => s.id === myId()));
  const hosting = () => mySide() === 0;

  function open(cabinetId) {
    if (cab) return;
    cab = cabinetId;
    seats = [{ id: myId(), name: 'You' }];
    state = game.start();
    remoteInput = null;
    status.textContent = 'Getting the cabinet ready…';
    root.classList.add('open');
    send({ t: 'arcade', op: 'join', cab });
  }
  function close() {
    if (!cab) return;
    send({ t: 'arcade', op: 'leave', cab });
    cab = null;
    keys.clear();
    root.classList.remove('open');
  }
  // Messages from the server about our cabinet.
  function handle(m) {
    if (!cab || m.cab !== cab) return;
    if (m.op === 'full') { status.textContent = 'Two people are already playing on this one. Try again in a bit.'; seats = []; return; }
    if (m.op === 'seats') {
      const wasHost = hosting(), before = seats.length;
      seats = m.seats;
      if (!seats.some((s) => s.id === myId())) return close();
      if (hosting() && (!wasHost || seats.length !== before)) { state = game.start(); remoteInput = null; } // a fresh game when the line-up changes
    } else if (m.op === 'input' && hosting()) remoteInput = m.y;
    else if (m.op === 'state' && !hosting()) state = m.s;
  }

  let last = performance.now();
  function tick(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (cab && seats.length) {
      if (keys.has('arrowup') || keys.has('w')) myTarget -= 420 * dt;
      if (keys.has('arrowdown') || keys.has('s')) myTarget += 420 * dt;
      myTarget = Math.max(0, Math.min(FH, myTarget));
      const versus = seats.length === 2;
      if (hosting()) {
        game.step(state, dt, [myTarget, versus ? remoteInput ?? FH / 2 : null]);
        if (versus && now - lastSend > 33) { send({ t: 'arcade', op: 'state', cab, s: state }); lastSend = now; }
      } else if (now - lastSend > 33) { send({ t: 'arcade', op: 'input', cab, y: myTarget }); lastSend = now; }
      const names = [seats[0]?.name || 'Player 1', versus ? seats[1].name : 'Computer'];
      status.textContent = versus ? `${names[0]} vs ${names[1]}` : 'Playing the computer. Anyone who walks up to this cabinet joins in.';
      g.setTransform(2, 0, 0, 2, 0, 0);
      game.draw(g, state, names, mySide());
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  return { open, close, handle, isOpen: () => !!cab };
}
