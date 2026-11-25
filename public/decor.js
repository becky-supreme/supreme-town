// The pictures on the walls of Supreme Town: marketing and life sciences decor.
// Each one is drawn with code, so edit the words and colours here.
// They are decoration: no real client names and no real figures.

export const POSTERS = ['growth', 'search', 'channels', 'funnel']; // one per team along the back wall

const BG = '#0f1020';
function base(g, w, h, accent) {
  const grad = g.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, '#171a36'); grad.addColorStop(1, BG);
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  g.strokeStyle = accent; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6);
}
function title(g, text, x, y, size, color) {
  g.font = `800 ${size}px system-ui, sans-serif`;
  g.fillStyle = color; g.shadowColor = color; g.shadowBlur = 16;
  g.fillText(text, x, y);
  g.shadowBlur = 0;
}

const DRAW = {
  // a chart going up and to the right
  growth(g, w, h) {
    base(g, w, h, '#39ff9c');
    title(g, 'UP AND TO THE RIGHT', 28, 56, 34, '#39ff9c');
    g.strokeStyle = 'rgba(255,255,255,0.1)'; g.lineWidth = 1;
    for (let k = 1; k < 6; k++) { g.beginPath(); g.moveTo(28, 80 + k * (h - 120) / 6); g.lineTo(w - 28, 80 + k * (h - 120) / 6); g.stroke(); }
    const pts = [0.08, 0.14, 0.11, 0.22, 0.3, 0.27, 0.42, 0.55, 0.6, 0.78, 0.92];
    g.beginPath();
    pts.forEach((p, n) => { const x = 40 + n * (w - 80) / (pts.length - 1), y = h - 40 - p * (h - 130); n ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.strokeStyle = '#39ff9c'; g.lineWidth = 7; g.shadowColor = '#39ff9c'; g.shadowBlur = 18; g.stroke(); g.shadowBlur = 0;
    for (let n = 0; n < 9; n++) { g.fillStyle = `rgba(139,92,246,${0.25 + n * 0.07})`; const bh = (0.1 + n * 0.08) * (h - 130); g.fillRect(52 + n * (w - 110) / 9, h - 40 - bh, 30, bh); }
  },
  // a search box with us at the top
  search(g, w, h) {
    base(g, w, h, '#27e0ff');
    g.fillStyle = '#ffffff'; g.beginPath(); g.roundRect(36, 40, w - 72, 62, 31); g.fill();
    g.fillStyle = '#333'; g.font = '500 28px system-ui, sans-serif'; g.fillText('life sciences marketing agency', 70, 81);
    title(g, '#1', 40, 190, 78, '#ffd24a');
    title(g, 'Supreme', 170, 172, 50, '#ffffff');
    g.fillStyle = '#8fa4e8'; g.font = '500 24px system-ui, sans-serif'; g.fillText('The answer everyone was searching for', 172, 208);
    for (let k = 0; k < 2; k++) { g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(40, 250 + k * 46, w - 160 - k * 90, 14); g.fillRect(40, 272 + k * 46, w - 260 - k * 60, 10); }
  },
  // what we do
  channels(g, w, h) {
    base(g, w, h, '#ff3df2');
    const words = [['SEO', '#39ff9c'], ['PAID MEDIA', '#27e0ff'], ['CONTENT', '#ff7a59'], ['DESIGN', '#ff6fb5'], ['STRATEGY', '#4f8cff'], ['DATA', '#ffd24a']];
    words.forEach(([t, c], n) => title(g, t, 36 + (n % 2) * (w / 2 - 10), 86 + Math.floor(n / 2) * ((h - 80) / 3), 44, c));
  },
  // the meeting room board
  whiteboard(g, w, h) {
    g.fillStyle = '#f7f8fb'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#9aa3b2'; g.lineWidth = 8; g.strokeRect(4, 4, w - 8, h - 8);
    g.font = '700 34px system-ui, sans-serif'; g.fillStyle = '#22252f'; g.fillText('This quarter', 36, 62);
    [['#ef4d5a', 'Win'], ['#4f8cff', 'Grow'], ['#1f9d63', 'Celebrate']].forEach(([c, t], n) => {
      g.strokeStyle = c; g.lineWidth = 6; g.beginPath(); g.arc(60, 120 + n * 62, 16, 0, Math.PI * 2); g.stroke();
      g.fillStyle = c; g.font = '600 30px system-ui, sans-serif'; g.fillText(t, 96, 131 + n * 62);
    });
    g.strokeStyle = '#8b5cf6'; g.lineWidth = 5; g.beginPath(); g.moveTo(330, h - 50); g.bezierCurveTo(400, h - 60, 460, 150, 590, 70); g.stroke();
  },
  // dots for land, pins for where we're going next
  world(g, w, h) {
    base(g, w, h, '#ffd24a');
    title(g, 'TAKING OVER THE WORLD', 30, 52, 34, '#ffd24a');
    const lands = [[0.2, 0.42, 0.11, 0.17], [0.27, 0.72, 0.06, 0.16], [0.5, 0.4, 0.07, 0.12], [0.53, 0.64, 0.07, 0.16], [0.7, 0.42, 0.15, 0.15], [0.85, 0.76, 0.06, 0.07]];
    g.fillStyle = 'rgba(143,164,232,0.55)';
    for (let x = 0; x < w; x += 11) for (let y = 70; y < h - 12; y += 11) {
      if (lands.some(([cx, cy, rx, ry]) => ((x / w - cx) / rx) ** 2 + ((y / h - cy) / ry) ** 2 < 1)) { g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fill(); }
    }
    const pins = [[0.22, 0.4], [0.5, 0.36], [0.72, 0.42], [0.28, 0.7], [0.55, 0.62], [0.86, 0.76], [0.64, 0.38]];
    g.strokeStyle = 'rgba(255,61,242,0.7)'; g.lineWidth = 2.5;
    for (let n = 1; n < pins.length; n++) { const [ax, ay] = pins[0], [bx, by] = pins[n]; g.beginPath(); g.moveTo(ax * w, ay * h); g.quadraticCurveTo((ax + bx) / 2 * w, Math.min(ay, by) * h - 60, bx * w, by * h); g.stroke(); }
    for (const [px, py] of pins) { g.fillStyle = '#ff3df2'; g.shadowColor = '#ff3df2'; g.shadowBlur = 18; g.beginPath(); g.arc(px * w, py * h, 8, 0, Math.PI * 2); g.fill(); g.shadowBlur = 0; }
  },
  // a double helix
  lifesci(g, w, h) {
    base(g, w, h, '#39ff9c');
    title(g, 'HEALTHCARE &', 30, 56, 36, '#39ff9c');
    title(g, 'LIFE SCIENCES', 30, 98, 36, '#ffffff');
    const y0 = h * 0.66, amp = h * 0.17;
    for (let x = 30; x < w - 30; x += 22) {
      const a = x / 46;
      g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 3; g.beginPath(); g.moveTo(x, y0 + Math.sin(a) * amp); g.lineTo(x, y0 - Math.sin(a) * amp); g.stroke();
      for (const [s, c] of [[1, '#ff3df2'], [-1, '#27e0ff']]) { g.fillStyle = c; g.shadowColor = c; g.shadowBlur = 12; g.beginPath(); g.arc(x, y0 + s * Math.sin(a) * amp, 7, 0, Math.PI * 2); g.fill(); }
      g.shadowBlur = 0;
    }
  },
  funnel(g, w, h) {
    base(g, w, h, '#ff7a59');
    title(g, 'FROM CLICK', 26, 52, 32, '#ff7a59');
    title(g, 'TO CLIENT', 26, 90, 32, '#ffffff');
    const rows = [['AWARENESS', '#8b5cf6'], ['INTEREST', '#4f8cff'], ['PIPELINE', '#27e0ff'], ['WON', '#39ff9c']];
    rows.forEach(([t, c], n) => {
      const top = 120 + n * (h - 150) / 4, bh = (h - 150) / 4 - 10, inset = 26 + n * (w - 52) / 9;
      g.fillStyle = c; g.beginPath(); g.moveTo(inset, top); g.lineTo(w - inset, top); g.lineTo(w - inset - (w - 52) / 9, top + bh); g.lineTo(inset + (w - 52) / 9, top + bh); g.closePath(); g.fill();
      g.fillStyle = '#0f1020'; g.font = '800 24px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText(t, w / 2, top + bh / 2 + 9); g.textAlign = 'left';
    });
  },
  // hexagon rings, like a molecule diagram
  molecule(g, w, h) {
    base(g, w, h, '#27e0ff');
    const hex = (cx, cy, r, c) => { g.beginPath(); for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + k * Math.PI / 3; k ? g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r) : g.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); } g.closePath(); g.strokeStyle = c; g.lineWidth = 7; g.shadowColor = c; g.shadowBlur = 16; g.stroke(); g.shadowBlur = 0; };
    const r = w * 0.13, cx = w / 2, cy = h * 0.42, dx = r * Math.sqrt(3);
    hex(cx, cy, r, '#27e0ff'); hex(cx - dx, cy, r, '#ff3df2'); hex(cx + dx, cy, r, '#39ff9c'); hex(cx - dx / 2, cy + r * 1.5, r, '#ffd24a'); hex(cx + dx / 2, cy + r * 1.5, r, '#b79bff');
    g.textAlign = 'center';
    title(g, 'PHARMA  ·  BIOTECH', cx, h - 84, 30, '#ffffff');
    title(g, 'MEDTECH  ·  DIAGNOSTICS', cx, h - 42, 30, '#27e0ff');
    g.textAlign = 'left';
  },
};

export function drawPoster(name, canvas) {
  const g = canvas.getContext('2d');
  (DRAW[name] || DRAW.growth)(g, canvas.width, canvas.height);
}
