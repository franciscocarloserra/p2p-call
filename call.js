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
  "dropRejoinMs": 4000,
  "socketResetCooldownMs": 10000,
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
let lastReset = 0;
function resetSockets() {
  if (Date.now() - lastReset < P.socketResetCooldownMs) return;
  lastReset = Date.now();
  sockets.forEach(s => s.close());
}

// Missing devices are fine: fall back to audio only, video only, or watch only
async function getMedia() {
  const audio = {echoCancellation: true, noiseSuppression: true};
  const video = {width: P.videoWidth, height: P.videoHeight, frameRate: P.videoFps};
  for (const c of [{audio, video}, {audio}, {video}]) {
    try { return await navigator.mediaDevices.getUserMedia(c); } catch (e) { console.warn('getUserMedia', c, e.name); }
  }
  return new MediaStream();
}

// Callbacks: onPeerJoin(peer), onPeerLeave(peer), onStream(stream, peer), onReconnect()
export async function joinCall({onPeerJoin, onPeerLeave, onStream, onReconnect} = {}) {
  const stream = await getMedia();
  const cfg = {appId: P.appId, password};
  if (P.relayUrls.length) cfg.relayConfig = {urls: P.relayUrls};
  let r, aloneSince = Date.now(), hadPeers = false;
  const peerCount = () => Object.keys(r.getPeers()).length;

  function connect() {
    r = joinRoom(cfg, room);
    r.addStream(stream); // to peers already connected
    r.onPeerJoin = peer => { hadPeers = true; r.addStream(stream, {target: peer}); onPeerJoin?.(peer); };
    r.onPeerLeave = peer => { if (!peerCount()) aloneSince = Date.now(); onPeerLeave?.(peer); };
    r.onPeerStream = (s, peer) => onStream?.(s, peer);
  }
  // Trystero restarts ICE and retries relays on its own, but relays can give up for good
  // after repeated drops. If we stay alone too long (or the network comes back), rejoin from scratch.
  async function rejoin() {
    if (peerCount()) return;
    aloneSince = Date.now();
    hadPeers = false;
    onReconnect?.();
    try { await r.leave(); } catch {}
    connect();
  }
  connect();
  // Network change: fresh relay sockets, and rejoin if that left us alone.
  // Detected via the connection API (Android Chrome), the online event, or a peer link going down (everywhere else).
  const onNetworkChange = () => { resetSockets(); rejoin(); };
  const watchdog = setInterval(() => {
    const links = Object.values(r.getPeers()).map(pc => pc.connectionState);
    if (links.some(st => st === 'disconnected' || st === 'failed')) resetSockets();
    const wait = hadPeers ? P.dropRejoinMs : P.aloneRetryMs; // lost everyone: come back fast
    if (!peerCount() && Date.now() - aloneSince > wait) rejoin();
  }, P.watchdogMs);
  addEventListener('online', onNetworkChange);
  navigator.connection?.addEventListener('change', onNetworkChange);
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
    leave: () => { clearInterval(watchdog); removeEventListener('online', onNetworkChange); navigator.connection?.removeEventListener('change', onNetworkChange); stream.getTracks().forEach(t => t.stop()); return r.leave(); }
  };
}
