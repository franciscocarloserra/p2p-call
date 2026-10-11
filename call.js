// Core: session from the URL hash, local media, and a trystero room that exchanges streams. No DOM.
import {joinRoom} from './trystero-nostr.mjs';

// Tunable parameters
const P = {
  "appId": "p2p-call-poc-4b8e1d",
  "randomBytes": 16,
  "videoWidth": 640,
  "videoHeight": 480,
  "videoFps": 24,
  "aloneRetryMs": 15000,
  "linkGraceMs": 1500,
  "retryMinMs": 2000,
  "retryMaxMs": 60000,
  "watchdogMs": 3000,
  "relayUrls": ["wss://nos.lol", "wss://relay.primal.net", "wss://nostr.mom"]
};

// Same session scheme as p2p-board: room and password live in the URL hash (#room:password)
const rand = () => [...crypto.getRandomValues(new Uint8Array(P.randomBytes))]
  .map(b => b.toString(16).padStart(2, '0')).join('');
if (!/^#[^:]+:.+/.test(location.hash)) location.hash = rand() + ':' + rand();
const [room, ...pw] = decodeURIComponent(location.hash.slice(1)).split(':');
const password = pw.join(':');

// Track relay sockets so a network change can force fresh ones: after switching wifi/4G the old
// TCP connection can look open for minutes while going nowhere. Trystero reconnects on close.
const sockets = new Set();
window.WebSocket = class extends WebSocket {
  constructor(...a) { super(...a); sockets.add(this); this.addEventListener('close', () => sockets.delete(this)); }
};
const resetSockets = () => sockets.forEach(s => s.close());

// Missing devices are fine: fall back to audio only, video only, or watch only
async function getMedia() {
  const audio = {echoCancellation: true, noiseSuppression: true};
  const video = {width: P.videoWidth, height: P.videoHeight, frameRate: P.videoFps};
  for (const c of [{audio, video}, {audio}, {video}]) {
    try { return await navigator.mediaDevices.getUserMedia(c); } catch (e) { console.warn('getUserMedia', c, e.name); }
  }
  return new MediaStream();
}

// Callbacks: onPeerJoin(peer), onPeerLeave(peer), onStream(stream, peer), onReconnect(), onScreenEnd()
export async function joinCall({onPeerJoin, onPeerLeave, onStream, onReconnect, onScreenEnd} = {}) {
  const stream = await getMedia();
  const cfg = {appId: P.appId, password};
  if (P.relayUrls.length) cfg.relayConfig = {urls: P.relayUrls};
  let r, screen, aloneSince = Date.now(), lastRejoin = 0, retryMs = P.retryMinMs;
  const peerCount = () => Object.keys(r.getPeers()).length;
  const anyLinkUp = () => Object.values(r.getPeers()).some(pc => pc.connectionState === 'connected');

  function connect() {
    r = joinRoom(cfg, room);
    r.addStream(stream); // to peers already connected
    if (screen) r.addStream(screen);
    r.onPeerJoin = peer => {
      retryMs = P.retryMinMs; // healthy again: reset backoff
      r.addStream(stream, {target: peer});
      if (screen) r.addStream(screen, {target: peer});
      watchLink(r.getPeers()[peer]);
      onPeerJoin?.(peer);
    };
    r.onPeerLeave = peer => { if (!peerCount()) aloneSince = Date.now(); onPeerLeave?.(peer); };
    r.onPeerStream = (s, peer) => onStream?.(s, peer);
  }

  // A network switch kills every link at once. Trystero would wait ~5 s per link and then ~10+ s to
  // rediscover; instead rejoin as soon as all links stay down for a short grace (jitter shouldn't trigger it).
  function watchLink(pc) {
    let grace;
    pc?.addEventListener('connectionstatechange', () => {
      clearTimeout(grace);
      if (pc.connectionState === 'failed') rejoin();
      else if (pc.connectionState === 'disconnected') grace = setTimeout(() => { if (!anyLinkUp()) rejoin(); }, P.linkGraceMs);
    });
  }

  // Leave and join again over fresh relay sockets. Rate-limited with exponential backoff
  // (reset on the next successful join) so a flaky network doesn't spam the Nostr relays.
  async function rejoin() {
    if (anyLinkUp() || Date.now() - lastRejoin < retryMs) return;
    lastRejoin = aloneSince = Date.now();
    retryMs = Math.min(retryMs * 2, P.retryMaxMs);
    onReconnect?.();
    try { await r.leave(); } catch {}
    resetSockets();
    connect();
  }

  connect();
  const watchdog = setInterval(() => { if (!peerCount() && Date.now() - aloneSince > P.aloneRetryMs) rejoin(); }, P.watchdogMs);
  // Network change signals: connection API (Android Chrome), online event, back from background
  addEventListener('online', rejoin);
  navigator.connection?.addEventListener('change', rejoin);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) rejoin(); });

  return {
    stream,
    peerCount,
    has: kind => stream.getTracks().some(t => t.kind === kind),
    // kind: 'audio' | 'video'. Returns whether it's on after toggling.
    toggle: kind => {
      const tracks = stream.getTracks().filter(t => t.kind === kind);
      tracks.forEach(t => t.enabled = !t.enabled);
      return !!tracks[0]?.enabled;
    },
    // Screen share as a second stream; stopping from the browser's own bar also ends it. Returns whether it's on.
    toggleScreen: async () => {
      if (screen) { screen.getTracks().forEach(t => t.stop()); r.removeStream(screen); screen = null; return false; }
      const s = await navigator.mediaDevices.getDisplayMedia({video: true, audio: true});
      s.getVideoTracks()[0].onended = () => { if (screen === s) { r.removeStream(s); screen = null; onScreenEnd?.(); } };
      r.addStream(screen = s);
      return true;
    },
    leave: () => { clearInterval(watchdog); removeEventListener('online', rejoin); navigator.connection?.removeEventListener('change', rejoin); [stream, screen].forEach(s => s?.getTracks().forEach(t => t.stop())); return r.leave(); }
  };
}
