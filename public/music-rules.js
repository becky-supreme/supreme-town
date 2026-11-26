// Who can hear shared music, and how the music stream is described.
// Same places as voice (see rtc.js): a shared room is everyone in it, and
// everywhere else it fades with distance. Kept here so the server can refuse a
// second player in that same spot, and so the browser can set the volume.
import { zoneOf, isShared, hearRadius } from './world.js';

// Shared rooms are one space each. Open floor and desks are not a room: two
// people only clash when somebody standing between them could hear both.
export function sharesMusicSpace(a, b) {
  if (!a || !b) return false;
  const za = zoneOf(a.x, a.y), zb = zoneOf(b.x, b.y);
  const ra = isShared(za) ? za : null;
  const rb = isShared(zb) ? zb : null;
  if (ra || rb) return ra !== null && ra === rb;
  return Math.hypot(a.x - b.x, a.y - b.y) <= hearRadius(za) + hearRadius(zb);
}

// The other person already playing music in this space, or null.
export function musicConflict(person, people) {
  if (!person) return null;
  for (const q of people) {
    if (!q?.music || q.id === person.id) continue;
    if (q.status && q.status !== 'available') continue;
    if (sharesMusicSpace(person, q)) return q;
  }
  return null;
}

// slack: extra squares, so a stream doesn't cut in and out at the edge.
export function inEarshot(a, b, slack = 0) {
  if (!a || !b) return false;
  const za = zoneOf(a.x, a.y), zb = zoneOf(b.x, b.y);
  if (isShared(za) || isShared(zb)) return za === zb;
  return Math.hypot(a.x - b.x, a.y - b.y) <= Math.min(hearRadius(za), hearRadius(zb)) + slack;
}

// How loud the music is from here, before the listener's own volume slider.
// 0 means out of earshot. Matches the fade used for voices.
export function musicVolume(me, other) {
  const za = zoneOf(me.x, me.y), zb = zoneOf(other.x, other.y);
  if (isShared(za) || isShared(zb)) return za === zb ? 1 : 0;
  const radius = Math.min(hearRadius(za), hearRadius(zb));
  const d = Math.hypot(me.x - other.x, me.y - other.y);
  if (d >= radius + 0.8) return 0;
  return Math.max(0.08, Math.min(1, 1 - (d - radius * 0.35) / (radius * 0.9)));
}

// Ask the opus codec for stereo and a music bitrate. Voice stays on its own
// connection, so this never changes how microphones are encoded.
export function tuneMusicSdp(sdp) {
  if (typeof sdp !== 'string' || !sdp) return sdp;
  const nl = sdp.includes('\r\n') ? '\r\n' : '\n';
  const lines = sdp.split(nl);
  const opus = new Set();
  for (const line of lines) {
    const m = /^a=rtpmap:(\d+)\s+opus\/48000/i.exec(line);
    if (m) opus.add(m[1]);
  }
  return lines.map((line) => {
    const m = /^a=fmtp:(\d+)\s+(.*)$/.exec(line);
    if (!m || !opus.has(m[1])) return line;
    const have = new Set(m[2].split(';').map((s) => s.trim().split('=')[0]).filter(Boolean));
    const add = [];
    if (!have.has('stereo')) add.push('stereo=1');
    if (!have.has('sprop-stereo')) add.push('sprop-stereo=1');
    if (!have.has('maxaveragebitrate')) add.push('maxaveragebitrate=510000');
    if (!have.has('maxplaybackrate')) add.push('maxplaybackrate=48000');
    if (!have.has('usedtx')) add.push('usedtx=0');
    if (!add.length) return line;
    return `a=fmtp:${m[1]} ${m[2]};${add.join(';')}`;
  }).join(nl);
}
