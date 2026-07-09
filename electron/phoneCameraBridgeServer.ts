import os from "node:os";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { BrowserWindow, ipcMain } from "electron";

let bridgeBaseUrl: string | null = null;
let bridgeStartPromise: Promise<string> | null = null;
let currentSessionResolver: (() => {
	sessionId?: string;
	pairingCode?: string;
	pairingUrl?: string;
}) | null = null;
let connectCallback:
	| ((payload: { sessionId: string; pairingCode: string; remoteAddress?: string | null }) => boolean)
	| null = null;
let frameCallback:
	| ((payload: {
			sessionId: string;
			pairingCode: string;
			frameDataUrl: string;
			width?: number;
			height?: number;
			capturedAtMs?: number;
			remoteAddress?: string | null;
	  }) => boolean)
	| null = null;

// WebRTC signaling state
let webrtcOffer: string | null = null;
let webrtcAnswer: string | null = null;
let webrtcIceFromOverlay: unknown[] = [];
let webrtcIceFromPhone: unknown[] = [];
let answerPollTimer: NodeJS.Timeout | undefined;
let answerReadyResolver: (() => void) | null = null;

const PHONE_CAMERA_WEBRTC_SIGNAL_CHANNEL = "recordly-phone-camera:webrtc-signal";

function broadcastWebrtcSignal(signal: unknown): void {
	for (const win of BrowserWindow.getAllWindows()) {
		if (!win.isDestroyed()) {
			win.webContents.send(PHONE_CAMERA_WEBRTC_SIGNAL_CHANNEL, signal);
		}
	}
}

function getPreferredLanAddress(): string {
	const interfaces = os.networkInterfaces();
	for (const entries of Object.values(interfaces)) {
		for (const entry of entries ?? []) {
			if (entry.family === "IPv4" && !entry.internal) {
				return entry.address;
			}
		}
	}

	return "127.0.0.1";
}

function renderBridgePage(params: {
	sessionId: string;
	pairingCode: string;
	status: "ready" | "connected" | "invalid";
	message: string;
}) {
	const { sessionId, pairingCode } = params;
	return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no,viewport-fit=cover" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<title>Recordly Phone Camera</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
html, body { width: 100%; height: 100%; overflow: hidden; background: #000; touch-action: none; }
video#preview {
  position: fixed; top: 0; left: 0;
  width: 100%; height: 100%;
  object-fit: cover; display: block;
  transform: scaleX(-1);
}
#ui-overlay {
  position: fixed; top: 0; left: 0; right: 0; bottom: 0;
  z-index: 10; opacity: 0; transition: opacity 0.3s;
  pointer-events: none;
}
#ui-overlay.visible { opacity: 1; pointer-events: auto; }
#status-bar {
  position: absolute; top: 0; left: 0; right: 0;
  padding: 16px 20px 32px; display: flex; align-items: center; justify-content: center; gap: 8px;
  background: linear-gradient(180deg, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0) 100%);
  font-size: 13px; font-weight: 500; color: rgba(255,255,255,0.8);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
#status-dot { width: 7px; height: 7px; border-radius: 50%; background: #22c55e; }
#actions {
  position: absolute; bottom: 48px; left: 0; right: 0;
  display: flex; justify-content: center; gap: 24px;
}
.action-btn {
  width: 56px; height: 56px; border-radius: 50%;
  border: 2px solid rgba(255,255,255,0.3);
  background: rgba(0,0,0,0.5);
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  color: #fff; font-size: 13px;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 2px;
  cursor: pointer; transition: all 0.2s;
  -webkit-tap-highlight-color: transparent; user-select: none;
}
.action-btn:active { transform: scale(0.9); background: rgba(255,255,255,0.2); }
.action-btn svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 2; }
.action-btn-label { font-size: 9px; opacity: 0.8; }
#disconnect-btn { color: #fca5a5; border-color: rgba(239,68,68,0.4); }
#error-msg {
  position: fixed; bottom: 120px; left: 20px; right: 20px;
  padding: 12px 16px; border-radius: 12px;
  background: rgba(239,68,68,0.2);
  border: 1px solid rgba(239,68,68,0.3);
  color: #fca5a5; font-size: 14px; text-align: center;
  display: none; z-index: 20;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
</style>
</head>
<body>
<video id="preview" autoplay playsinline muted></video>
<div id="ui-overlay">
  <div id="status-bar">
    <span id="status-dot"></span>
    <span id="status-text">已连接 - Recordly</span>
  </div>
  <div id="actions">
    <button class="action-btn" id="switch-btn" title="切换摄像头">
      <svg viewBox="0 0 24 24"><path d="M4 7h16M4 7l3-3M4 7l3 3M20 17H4M20 17l-3-3M20 17l-3 3"/><rect x="2" y="11" width="20" height="2"/></svg>
      <span class="action-btn-label">切换</span>
    </button>
    <button class="action-btn" id="disconnect-btn" title="断开连接">
      <svg viewBox="0 0 24 24"><path d="M18.36 6.64a9 9 0 1 1-12.73 0M12 2v10"/><path d="M5.64 18.36l2.83-2.83M18.36 18.36l-2.83-2.83"/></svg>
      <span class="action-btn-label">断开</span>
    </button>
  </div>
</div>
<div id="error-msg"></div>
<script>
const preview = document.getElementById('preview');
const uiOverlay = document.getElementById('ui-overlay');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const errorMsg = document.getElementById('error-msg');
const switchBtn = document.getElementById('switch-btn');
const disconnectBtn = document.getElementById('disconnect-btn');
const sessionId = ${JSON.stringify(sessionId)};
const pairingCode = ${JSON.stringify(pairingCode)};
let pc = null;
let cameraStream = null;
let wakeLock = null;
let facingMode = 'environment';
let overlayTimer = null;

function showOverlay() {
  uiOverlay.classList.add('visible');
  if (overlayTimer) clearTimeout(overlayTimer);
  overlayTimer = setTimeout(() => { uiOverlay.classList.remove('visible'); }, 3000);
}
document.addEventListener('click', showOverlay);
document.addEventListener('touchstart', showOverlay);

function setStatus(text, state) {
  statusText.textContent = text;
  statusDot.style.background = state === 'connected' ? '#22c55e' : state === 'error' ? '#ef4444' : '#eab308';
}
function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.style.display = 'block';
  showOverlay();
}

async function startCamera(facing) {
  try {
    if (cameraStream) {
      cameraStream.getTracks().forEach(t => t.stop());
    }
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30, max: 30 } },
      audio: false
    });
    preview.srcObject = cameraStream;
    setStatus('已连接 - Recordly', 'connected');
    return cameraStream;
  } catch (err) {
    console.error('Camera error:', err);
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      showError('需要摄像头权限，请在浏览器设置中允许访问');
    } else if (err.name === 'NotFoundError') {
      showError('未检测到摄像头');
    } else {
      showError('摄像头启动失败: ' + err.message);
    }
    setStatus('摄像头错误', 'error');
    throw err;
  }
}

async function switchCamera() {
  facingMode = facingMode === 'environment' ? 'user' : 'environment';
  setStatus('切换摄像头...', 'connecting');
  try {
    const newStream = await startCamera(facingMode);
    if (pc) {
      const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender) {
        const newTrack = newStream.getVideoTracks()[0];
        sender.replaceTrack(newTrack);
      }
    }
    setStatus('已连接 - Recordly', 'connected');
  } catch(e) {
    facingMode = facingMode === 'environment' ? 'user' : 'environment';
    showError('切换摄像头失败');
  }
}

async function startSignaling() {
  try {
    const videoTrack = cameraStream.getVideoTracks()[0];
    if (!videoTrack) throw new Error('No video track');
    pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    });
    pc.addTrack(videoTrack, cameraStream);
    pc.onicecandidate = async (event) => {
      if (event.candidate) {
        try {
          await fetch('/api/webrtc-ice', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(event.candidate)
          });
        } catch(e) {}
      }
    };
    pc.onconnectionstatechange = () => {
      console.log('[phone] PC state:', pc.connectionState);
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        setStatus('连接中断', 'error');
      }
    };
    const offer = await pc.createOffer({ offerToReceiveVideo: false, offerToReceiveAudio: false });
    await pc.setLocalDescription(offer);
    const offerResp = await fetch('/api/webrtc-offer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'offer', sdp: pc.localDescription })
    });
    let answerData = null;
    while (!answerData) {
      const resp = await fetch('/api/webrtc-answer', { method: 'GET', headers: { 'Content-Type': 'application/json' } });
      const data = await resp.json();
      if (data.type === 'answer' && data.sdp) { answerData = data; break; }
      await new Promise(r => setTimeout(r, 300));
    }
    if (answerData) {
      await pc.setRemoteDescription(new RTCSessionDescription(answerData.sdp));
      console.log('[phone] Remote description set');
    }
    setStatus('已连接 - Recordly', 'connected');
    async function pollIce() {
      while (pc && pc.connectionState !== 'failed') {
        try {
          const resp = await fetch('/api/webrtc-ice', { method: 'GET', headers: { 'Content-Type': 'application/json' } });
          const candidates = await resp.json();
          if (Array.isArray(candidates)) {
            for (const c of candidates) {
              try { if (c && c.candidate) await pc.addIceCandidate(new RTCIceCandidate(c)); } catch(e) {}
            }
          }
        } catch(e) {}
        await new Promise(r => setTimeout(r, 500));
      }
    }
    pollIce();
  } catch (err) {
    console.error('[phone] Failed to start:', err);
    setStatus('连接失败', 'error');
  }
}

function disconnect() {
  if (pc) pc.close();
  if (cameraStream) cameraStream.getTracks().forEach(t => t.stop());
  if (wakeLock) { wakeLock.release(); wakeLock = null; }
  pc = null; cameraStream = null;
  preview.srcObject = null;
}
switchBtn.addEventListener('click', (e) => { e.stopPropagation(); switchCamera(); });
disconnectBtn.addEventListener('click', (e) => { e.stopPropagation(); disconnect(); });
startCamera(facingMode).then(() => startSignaling());
window.addEventListener('beforeunload', () => { disconnect(); });
</script>
</body>
</html>`;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
	const chunks: Buffer[] = [];
	for await (const chunk of request) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	if (chunks.length === 0) {
		return null;
	}
	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function handleBridgeRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
	try {
		const base = bridgeBaseUrl ?? "http://127.0.0.1";
		const url = new URL(request.url ?? "/", base);
		if (request.method === "OPTIONS") {
			response.writeHead(204, {
				"Access-Control-Allow-Origin": "*",
				"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
				"Access-Control-Allow-Headers": "Content-Type",
			});
			response.end();
			return;
		}

		if (url.pathname === "/phone-camera" && request.method === "GET") {
			const state = currentSessionResolver?.() ?? {};
			const sessionId = url.searchParams.get("session") ?? "";
			const pairingCode = (url.searchParams.get("code") ?? "").toUpperCase();
			const valid = Boolean(state.sessionId && state.pairingCode && state.sessionId === sessionId && state.pairingCode === pairingCode);
			const html = renderBridgePage({
				sessionId,
				pairingCode,
				status: valid ? "ready" : "invalid",
				message: valid
					? "This phone is now in the Recordly pairing flow. Tap the button below to notify the desktop app."
					: "This pairing link is no longer active or does not match the current desktop session.",
			});
			response.writeHead(valid ? 200 : 410, { "Content-Type": "text/html; charset=utf-8" });
			response.end(html);
			return;
		}

		if (url.pathname === "/phone-camera/connect" && request.method === "POST") {
			const body = (await readJsonBody(request)) as { sessionId?: string; pairingCode?: string } | null;
			const sessionId = body?.sessionId;
			const pairingCode = body?.pairingCode?.toUpperCase();
			const success =
				typeof sessionId === "string" &&
				typeof pairingCode === "string" &&
				Boolean(connectCallback?.({
					sessionId,
					pairingCode,
					remoteAddress: request.socket.remoteAddress ?? null,
				}));
			response.writeHead(success ? 200 : 410, {
				"Content-Type": "application/json; charset=utf-8",
				"Access-Control-Allow-Origin": "*",
			});
			response.end(JSON.stringify(success ? { success: true } : { success: false, error: "Session expired or invalid." }));
			return;
		}

		if (url.pathname === "/phone-camera/frame" && request.method === "POST") {
			const body = (await readJsonBody(request)) as {
				sessionId?: string;
				pairingCode?: string;
				frameDataUrl?: string;
				width?: number;
				height?: number;
				capturedAtMs?: number;
			} | null;
			const sessionId = body?.sessionId;
			const pairingCode = body?.pairingCode?.toUpperCase();
			const frameDataUrl = body?.frameDataUrl;
			const success =
				typeof sessionId === "string" &&
				typeof pairingCode === "string" &&
				typeof frameDataUrl === "string" &&
				Boolean(
					frameCallback?.({
						sessionId,
						pairingCode,
						frameDataUrl,
						width: typeof body?.width === "number" ? body.width : undefined,
						height: typeof body?.height === "number" ? body.height : undefined,
						capturedAtMs: typeof body?.capturedAtMs === "number" ? body.capturedAtMs : undefined,
						remoteAddress: request.socket.remoteAddress ?? null,
					}),
				);
			response.writeHead(success ? 200 : 410, {
				"Content-Type": "application/json; charset=utf-8",
				"Access-Control-Allow-Origin": "*",
			});
			response.end(JSON.stringify(success ? { success: true } : { success: false, error: "Frame rejected." }));
			return;
		}

		// WebRTC signaling routes
		if (url.pathname === "/api/webrtc-offer" && request.method === "POST") {
			const body = (await readJsonBody(request)) as { sdp?: string } | null;
			const sdp = typeof body?.sdp === "string" ? body.sdp : null;
			if (!sdp) {
				response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
				response.end(JSON.stringify({ error: "Missing SDP offer." }));
				return;
			}
			webrtcOffer = sdp;
			webrtcAnswer = null;
			webrtcIceFromOverlay = [];
			webrtcIceFromPhone = [];
			broadcastWebrtcSignal({ type: "offer", sdp: webrtcOffer });
			if (answerReadyResolver) {
				try { answerReadyResolver(); } catch (e) { /* ignore */ }
				answerReadyResolver = null;
			}
			answerPollTimer = setInterval(() => {
				if (webrtcAnswer) {
					clearInterval(answerPollTimer);
					answerPollTimer = undefined;
					if (answerReadyResolver) {
						try { answerReadyResolver(); } catch (e) { /* ignore */ }
						answerReadyResolver = null;
					}
				}
			}, 100);
			setTimeout(() => {
				if (answerPollTimer) {
					clearInterval(answerPollTimer);
					answerPollTimer = undefined;
					webrtcOffer = null;
					if (!response.headersSent) {
						response.writeHead(408);
						response.end();
					}
				}
			}, 30000);
			return;
		}

		if (url.pathname === "/api/webrtc-answer" && request.method === "POST") {
			const body = (await readJsonBody(request)) as { sdp?: string } | null;
			const sdp = typeof body?.sdp === "string" ? body.sdp : null;
			if (!sdp) {
				response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
				response.end(JSON.stringify({ error: "Missing SDP answer." }));
				return;
			}
			webrtcAnswer = sdp;
			broadcastWebrtcSignal({ type: "answer", sdp: webrtcAnswer });
			response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" });
			response.end(JSON.stringify({ ok: true }));
			return;
		}

		if (url.pathname === "/api/webrtc-answer" && request.method === "GET") {
			const payload = webrtcAnswer ? { type: "answer", sdp: webrtcAnswer } : { type: "pending" };
			response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" });
			response.end(JSON.stringify(payload));
			return;
		}

		if (url.pathname === "/api/webrtc-ice" && request.method === "POST") {
			const body = (await readJsonBody(request)) as unknown;
			webrtcIceFromPhone.push(body);
			broadcastWebrtcSignal({ type: "ice-candidate", candidate: body });
			response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" });
			response.end(JSON.stringify({ ok: true }));
			return;
		}

		if (url.pathname === "/api/webrtc-ice" && request.method === "GET") {
			const candidates = webrtcIceFromOverlay.slice();
			webrtcIceFromOverlay = [];
			response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" });
			response.end(JSON.stringify(candidates));
			return;
		}

		response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
		response.end("Not Found");
	} catch (error) {
		console.error("[phone-camera-bridge] Error handling request:", error);
		response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
		response.end("Internal Server Error");
	}
}

export function configurePhoneCameraBridgeSession(options: {
	getSession: () => { sessionId?: string; pairingCode?: string; pairingUrl?: string };
	onConnect: (payload: { sessionId: string; pairingCode: string; remoteAddress?: string | null }) => boolean;
	onFrame: (payload: {
		sessionId: string;
		pairingCode: string;
		frameDataUrl: string;
		width?: number;
		height?: number;
		capturedAtMs?: number;
		remoteAddress?: string | null;
	}) => boolean;
}): void {
	currentSessionResolver = options.getSession;
	connectCallback = options.onConnect;
	frameCallback = options.onFrame;

	ipcMain.on(PHONE_CAMERA_WEBRTC_SIGNAL_CHANNEL, (_event, signal: unknown) => {
		if (signal && typeof signal === "object") {
			const msg = signal as { type?: string; sdp?: string; candidate?: unknown };
			if (msg.type === "answer" && typeof msg.sdp === "string") {
				webrtcAnswer = msg.sdp;
				if (answerReadyResolver) {
					try { answerReadyResolver(); } catch (e) { /* ignore */ }
					answerReadyResolver = null;
				}
			} else if (msg.type === "ice-candidate") {
				webrtcIceFromOverlay.push(msg.candidate ?? msg);
			}
		}
	});
}

export function waitForWebrtcAnswer(): Promise<void> {
	if (webrtcAnswer) {
		return Promise.resolve();
	}
	return new Promise((resolve) => {
		answerReadyResolver = resolve;
	});
}

export function getPhoneCameraWebrtcSignalingChannel(): string {
	return PHONE_CAMERA_WEBRTC_SIGNAL_CHANNEL;
}

export function getPhoneCameraBridgeBaseUrl(): string | null {
	return bridgeBaseUrl;
}

export async function ensurePhoneCameraBridgeServer(): Promise<string> {
	if (bridgeBaseUrl) {
		return bridgeBaseUrl;
	}
	if (bridgeStartPromise) {
		return bridgeStartPromise;
	}
	bridgeStartPromise = new Promise((resolve, reject) => {
		const server = createServer((request, response) => {
			void handleBridgeRequest(request, response);
		});
		server.once("error", (error) => reject(error));
		server.listen(0, "0.0.0.0", () => {
			const address = server.address();
			if (!address || typeof address === "string") {
				server.close();
				reject(new Error("Phone camera bridge server did not expose a TCP address"));
				return;
			}
			bridgeBaseUrl = `http://${getPreferredLanAddress()}:${address.port}`;
			console.log(`[phone-camera-bridge] Listening at ${bridgeBaseUrl}`);
			resolve(bridgeBaseUrl);
		});
	});
	return bridgeStartPromise;
}

export function closePhoneCameraBridgeSession(): void {
	if (answerPollTimer) {
		clearInterval(answerPollTimer);
		answerPollTimer = undefined;
	}
	webrtcOffer = null;
	webrtcAnswer = null;
	webrtcIceFromOverlay = [];
	webrtcIceFromPhone = [];
	answerReadyResolver = null;
}
