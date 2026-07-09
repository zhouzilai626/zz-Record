import { getPhoneCameraWebrtcSignalingChannel } from "../phoneCameraBridgeServer";

export function getPhoneCameraOverlayHtml(): string {
	const channel = getPhoneCameraWebrtcSignalingChannel();
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1.0" />
<title>Recordly Phone Camera</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 100%; height: 100%; overflow: hidden; background: #000; }
body { display: flex; align-items: center; justify-content: center; }
video { width: 100%; height: 100%; object-fit: cover; display: block; }
#status {
  position: fixed; top: 8px; left: 50%; transform: translateX(-50%);
  padding: 4px 12px; border-radius: 999px; font: 500 11px/1.4 system-ui, sans-serif;
  color: rgba(255,255,255,0.8); background: rgba(0,0,0,0.5); pointer-events: none;
}
</style>
</head>
<body>
<video id="video" autoplay playsinline muted></video>
<div id="status">Waiting for phone camera...</div>
<script>
const video = document.getElementById('video');
const status = document.getElementById('status');
const { ipcRenderer } = require('electron');
const SIGNAL_CHANNEL = ${JSON.stringify(channel)};

let pc = null;

function setStatus(text) {
  status.textContent = text;
}

async function startWebRtc() {
  setStatus('Waiting for phone offer...');

  pc = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  });

  pc.ontrack = (event) => {
    setStatus('Receiving video...');
    if (event.streams && event.streams[0]) {
      video.srcObject = event.streams[0];
    }
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      ipcRenderer.send(SIGNAL_CHANNEL, {
        type: 'ice-candidate',
        candidate: event.candidate
      });
    }
  };

  pc.onconnectionstatechange = () => {
    console.log('[overlay] PC state:', pc.connectionState);
    if (pc.connectionState === 'connected') {
      setStatus('Connected');
    } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
      setStatus('Connection lost');
    }
  };

  ipcRenderer.on(SIGNAL_CHANNEL, (_event, signal) => {
    if (!signal || !signal.type) return;
    if (signal.type === 'offer' && signal.sdp) {
      setStatus('Processing offer...');
      pc.setRemoteDescription(new RTCSessionDescription(signal.sdp)).then(() => {
        return pc.createAnswer();
      }).then((answer) => {
        return pc.setLocalDescription(answer);
      }).then(() => {
        const answerSdp = pc.localDescription;
        ipcRenderer.send(SIGNAL_CHANNEL, {
          type: 'answer',
          sdp: answerSdp
        });
        setStatus('Answer sent, waiting for ICE...');
      }).catch((err) => {
        console.error('[overlay] Answer error:', err);
        setStatus('Error: ' + err.message);
      });
    } else if (signal.type === 'ice-candidate' && signal.candidate) {
      try {
        pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
      } catch (e) {
        console.error('[overlay] ICE error:', e);
      }
    }
  });
}

startWebRtc();
</script>
</body>
</html>`;
}
