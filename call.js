// Core: session from the URL hash, local media, and a trystero room that exchanges streams. No DOM.
import {joinRoom} from './trystero-nostr.mjs';

// Tunable parameters
const P = {
  "appId": "p2p-call-poc-4b8e1d",
  "randomBytes": 16,
  "videoWidth": 640,
  "videoHeight": 480,
  "videoFps": 24,
  "relayUrls": ["wss://nos.lol", "wss://relay.primal.net", "wss://nostr.mom"]
};

// Same session scheme as p2p-board: room and password live in the URL hash (#room:password)
const rand = () => [...crypto.getRandomValues(new Uint8Array(P.randomBytes))]
  .map(b => b.toString(16).padStart(2, '0')).join('');
if (!/^#[^:]+:.+/.test(location.hash)) location.hash = rand() + ':' + rand();
const [room, ...pw] = decodeURIComponent(location.hash.slice(1)).split(':');
const password = pw.join(':');

// Missing devices are fine: fall back to audio only, video only, or watch only
async function getMedia() {
  const audio = {echoCancellation: true, noiseSuppression: true};
  const video = {width: P.videoWidth, height: P.videoHeight, frameRate: P.videoFps};
  for (const c of [{audio, video}, {audio}, {video}]) {
    try { return await navigator.mediaDevices.getUserMedia(c); } catch (e) { console.warn('getUserMedia', c, e.name); }
  }
  return new MediaStream();
}

// Callbacks: onPeerJoin(peer), onPeerLeave(peer), onStream(stream, peer)
export async function joinCall({onPeerJoin, onPeerLeave, onStream} = {}) {
  const stream = await getMedia();
  const cfg = {appId: P.appId, password};
  if (P.relayUrls.length) cfg.relayConfig = {urls: P.relayUrls};
  const r = joinRoom(cfg, room);
  r.addStream(stream); // to peers already connected
  r.onPeerJoin = peer => { r.addStream(stream, {target: peer}); onPeerJoin?.(peer); };
  r.onPeerLeave = peer => onPeerLeave?.(peer);
  r.onPeerStream = (s, peer) => onStream?.(s, peer);
  return {
    stream,
    peerCount: () => Object.keys(r.getPeers()).length,
    has: kind => stream.getTracks().some(t => t.kind === kind),
    // kind: 'audio' | 'video'. Returns whether it's on after toggling.
    toggle: kind => {
      const tracks = stream.getTracks().filter(t => t.kind === kind);
      tracks.forEach(t => t.enabled = !t.enabled);
      return !!tracks[0]?.enabled;
    },
    leave: () => { stream.getTracks().forEach(t => t.stop()); return r.leave(); }
  };
}
