// What to do when a microphone, camera, or call drops. Kept free of the browser
// so it can be tested, and so the town can warn someone instead of going quiet.

// A track the browser has given up on. A muted track is not lost: muting is a
// choice, and operating systems mute tracks for a moment without unplugging them.
export function lossFromTrack(track) {
  if (!track || track.readyState !== 'ended') return null;
  if (track.kind === 'audio') return 'mic';
  if (track.kind === 'video') return 'camera';
  return null;
}

// True when we should keep using this device. An empty id means the browser
// didn't name it (often before permission), and an empty list means we couldn't
// ask, so neither is treated as "it vanished".
export function deviceStillPresent(deviceId, devices) {
  if (!deviceId) return true;
  if (!Array.isArray(devices) || !devices.length) return true;
  return devices.some((d) => d && d.deviceId === deviceId);
}

// The line shown on the warning the person can click.
// cause 'disconnected' is a device that was working and then went away.
// cause 'unavailable' is a microphone we never managed to open.
export function deviceWarning({ micDown = false, camDown = false, cause = 'disconnected' } = {}) {
  const unavailable = cause === 'unavailable';
  if (micDown && camDown) {
    return unavailable
      ? 'Your microphone and camera are unavailable, click to reconnect.'
      : 'Your microphone and camera disconnected, click to reconnect.';
  }
  if (micDown) {
    return unavailable
      ? 'Your microphone is unavailable, click to reconnect.'
      : 'Your microphone disconnected, click to reconnect.';
  }
  if (camDown) {
    return unavailable
      ? 'Your camera is unavailable, click to reconnect.'
      : 'Your camera disconnected, click to reconnect.';
  }
  return '';
}

// What a failed or stuck call should do. Two restarts, then give up and let the
// usual "open a new call" path try again after a short pause.
export function iceAction(state, disconnectedForMs = 0, attempts = 0) {
  const stuck = state === 'failed' || (state === 'disconnected' && disconnectedForMs >= 4000);
  if (stuck) return (attempts || 0) >= 2 ? 'drop' : 'restart';
  if (state === 'disconnected') return 'wait';
  return 'none';
}
