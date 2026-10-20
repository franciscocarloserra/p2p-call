# p2p-call

Browser-to-browser audio/video call. No server: peers find each other through public Nostr relays (Trystero) and media goes over WebRTC directly.

Live: https://franciscocarloserra.github.io/p2p-call/ — or open `index.html`, click "join call", share the full URL (with `#...`) so the other side joins the same room.

<img width="1214" height="1194" alt="Screenshot_20261020_113435" src="https://github.com/user-attachments/assets/6e9b0797-8c0a-4d49-9db3-6401be6d2815" />


"screen" shares a screen, window or tab as an extra video (desktop browsers only).

Camera/mic need HTTPS or `localhost`. Peers behind strict NATs may fail to connect (no TURN server).

`call.js` is the core (session from the URL hash, media, trystero room, auto-rejoin) with no DOM; `ui.js` + `index.html` are the UI on top of it.
