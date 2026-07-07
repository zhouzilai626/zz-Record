import os from "node:os";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

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

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
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
	const { sessionId, pairingCode, status, message } = params;
	const safeSessionId = escapeHtml(sessionId);
	const safePairingCode = escapeHtml(pairingCode);
	const safeMessage = escapeHtml(message);
	const tone = status === "connected" ? "#2f9e44" : status === "invalid" ? "#d9480f" : "#1c7ed6";
	const actionDisabled = status === "invalid" ? "disabled" : "";
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Recordly Phone Camera Pairing</title>
<style>
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  min-height: 100vh;
  background: radial-gradient(circle at top, rgba(45,110,255,.24), transparent 34%), linear-gradient(160deg, #07111f 0%, #0d1b2a 48%, #081019 100%);
  color: #f8fafc;
}
main {
  max-width: 760px;
  margin: 0 auto;
  padding: 24px;
}
.card {
  border: 1px solid rgba(255,255,255,.1);
  background: rgba(255,255,255,.05);
  border-radius: 28px;
  padding: 24px;
  backdrop-filter: blur(18px);
  box-shadow: 0 20px 60px rgba(0,0,0,.35);
}
.badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 1px solid color-mix(in srgb, ${tone} 45%, transparent);
  color: ${tone};
  background: color-mix(in srgb, ${tone} 12%, transparent);
  border-radius: 999px;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 600;
}
.code {
  margin-top: 16px;
  padding: 18px 20px;
  border-radius: 22px;
  background: rgba(0,0,0,.22);
  border: 1px solid rgba(255,255,255,.08);
  font: 700 38px/1.1 Consolas, monospace;
  letter-spacing: .18em;
}
.meta {
  margin-top: 18px;
  padding: 14px 16px;
  border-radius: 18px;
  background: rgba(255,255,255,.04);
  color: rgba(255,255,255,.75);
  font: 500 13px/1.6 Consolas, monospace;
  word-break: break-all;
}
button {
  margin-top: 22px;
  width: 100%;
  border: 0;
  border-radius: 999px;
  padding: 14px 18px;
  font-size: 15px;
  font-weight: 700;
  background: white;
  color: #0c1624;
}
button[disabled] {
  opacity: .5;
}
video {
  margin-top: 18px;
  width: 100%;
  border-radius: 22px;
  border: 1px solid rgba(255,255,255,.08);
  background: rgba(0,0,0,.28);
  aspect-ratio: 3 / 4;
  object-fit: cover;
}
p, li { line-height: 1.7; color: rgba(255,255,255,.76); }
small { color: rgba(255,255,255,.52); }
</style>
</head>
<body>
<main>
  <section class="card">
    <div class="badge">${status === "connected" ? "Desktop acknowledged" : status === "invalid" ? "Invalid session" : "Ready to connect"}</div>
    <h1>Recordly Phone Camera Bridge</h1>
    <p>${safeMessage}</p>
    <div class="code">${safePairingCode.replace(/(.{3})/g, "$1 ").trim()}</div>
    <div class="meta">Session: ${safeSessionId}</div>
    <button id="connect" ${actionDisabled}>Notify desktop</button>
    <button id="startCamera" ${actionDisabled}>Enable camera preview</button>
    <video id="preview" autoplay playsinline muted></video>
    <p><small>This page can now notify the desktop app and upload preview frames from the phone camera over the local network.</small></p>
  </section>
</main>
<script>
const button = document.getElementById('connect');
const startCameraButton = document.getElementById('startCamera');
const preview = document.getElementById('preview');
const sessionId = ${JSON.stringify(sessionId)};
const pairingCode = ${JSON.stringify(pairingCode)};
let desktopConnected = ${JSON.stringify(status === "connected")};
let captureInterval = null;
let currentStream = null;

async function notifyDesktop() {
  if (!button) return false;
  button.disabled = true;
  button.textContent = 'Sending...';
  try {
    const response = await fetch('/phone-camera/connect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, pairingCode })
    });
    const result = await response.json();
    if (result.success) {
      desktopConnected = true;
      button.textContent = 'Desktop notified';
      return true;
    }
    button.disabled = false;
    button.textContent = 'Notify desktop';
    alert(result.error || 'Failed to notify desktop app.');
    return false;
  } catch (error) {
    button.disabled = false;
    button.textContent = 'Notify desktop';
    alert('Failed to notify desktop app.');
    return false;
  }
}

async function uploadFrame(canvas) {
  const frameDataUrl = canvas.toDataURL('image/jpeg', 0.72);
  const response = await fetch('/phone-camera/frame', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      pairingCode,
      frameDataUrl,
      width: canvas.width,
      height: canvas.height,
      capturedAtMs: Date.now()
    })
  });
  const result = await response.json();
  if (!result.success) {
    throw new Error(result.error || 'Failed to upload frame.');
  }
}

async function startCameraPreview() {
  if (!startCameraButton || !preview) return;
  startCameraButton.disabled = true;
  startCameraButton.textContent = 'Starting camera...';
  try {
    if (!desktopConnected) {
      const success = await notifyDesktop();
      if (!success) {
        startCameraButton.disabled = false;
        startCameraButton.textContent = 'Enable camera preview';
        return;
      }
    }

    currentStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    });
    preview.srcObject = currentStream;

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    const sendFrame = async () => {
      if (!context || !preview.videoWidth || !preview.videoHeight) {
        return;
      }

      const targetWidth = Math.min(960, preview.videoWidth);
      const scale = targetWidth / preview.videoWidth;
      canvas.width = targetWidth;
      canvas.height = Math.max(1, Math.round(preview.videoHeight * scale));
      context.drawImage(preview, 0, 0, canvas.width, canvas.height);
      await uploadFrame(canvas);
    };

    await new Promise((resolve) => {
      if (preview.readyState >= 2) {
        resolve();
        return;
      }
      preview.onloadedmetadata = () => resolve();
    });

    await sendFrame();
    captureInterval = window.setInterval(() => {
      void sendFrame().catch((error) => {
        console.error('[phone-camera-bridge] Frame upload failed:', error);
      });
    }, 800);
    startCameraButton.textContent = 'Camera streaming';
  } catch (error) {
    startCameraButton.disabled = false;
    startCameraButton.textContent = 'Enable camera preview';
    alert(error instanceof Error ? error.message : 'Failed to start phone camera.');
  }
}

if (button) {
  button.addEventListener('click', async () => {
    void notifyDesktop();
  });
}

if (startCameraButton) {
  startCameraButton.addEventListener('click', () => {
    void startCameraPreview();
  });
}

window.addEventListener('beforeunload', () => {
  if (captureInterval) {
    window.clearInterval(captureInterval);
  }
  if (currentStream) {
    currentStream.getTracks().forEach((track) => track.stop());
  }
});
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
