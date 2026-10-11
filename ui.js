// UI on top of call.js: video grid, status bar, mic/cam toggles, share link.
window.onerror = window.onunhandledrejection = e => { document.getElementById('status').textContent = 'error: ' + (e.reason || e.message || e); };
import {joinCall} from './call.js';

// Tunable parameters
const P = {
  "copiedFeedbackMs": 1500
};
const $ = id => document.getElementById(id);

const videos = new Map(); // peerId -> <video>
let call;
// Peer count plus what each remote is actually sending (a = audio, v = video)
const status = () => call && ($('status').textContent = `peers ${call.peerCount()} ` +
  [...videos].filter(([id]) => id !== 'me').map(([, v]) => v.srcObject.getTracks().map(t => t.kind[0]).join('')).join(' '));

function addVideo(id, s, muted) {
  const v = videos.get(id) ?? document.createElement('video');
  v.autoplay = v.playsInline = true;
  v.muted = muted;
  v.srcObject = s;
  if (!videos.has(id)) { videos.set(id, v); $('grid').append(v); }
  s.onaddtrack = status;
  // If the browser blocks audible autoplay, the next click starts it
  v.play().catch(() => { $('status').textContent = 'click to hear'; addEventListener('pointerdown', () => v.play(), {once: true}); });
  return v;
}

// Join only after a click: the gesture unlocks camera prompt and remote audio autoplay
$('start').onclick = async () => {
  call = await joinCall({
    onPeerJoin: status,
    onReconnect: () => { for (const [id, v] of videos) if (id !== 'me') { v.remove(); videos.delete(id); } $('status').textContent = 'reconnecting...'; },
    onPeerLeave: peer => { videos.get(peer)?.remove(); videos.delete(peer); status(); },
    onStream: (s, peer) => { addVideo(peer, s, false); status(); }
  });
  $('lobby').remove();
  if (call.has('video')) addVideo('me', call.stream, true).id = 'me';
  $('mic').classList.toggle('off', !call.has('audio'));
  $('cam').classList.toggle('off', !call.has('video'));
  status();
};

$('mic').onclick = () => call && $('mic').classList.toggle('off', !call.toggle('audio'));
$('cam').onclick = () => call && $('cam').classList.toggle('off', !call.toggle('video'));

// Native share sheet on mobile, clipboard elsewhere
async function share(btn) {
  if (navigator.share) return navigator.share({url: location.href}).catch(() => {});
  await navigator.clipboard.writeText(location.href);
  const label = btn.textContent;
  btn.textContent = 'copied';
  setTimeout(() => btn.textContent = label, P.copiedFeedbackMs);
}
$('copy').onclick = () => share($('copy'));
$('share').onclick = () => share($('share'));
