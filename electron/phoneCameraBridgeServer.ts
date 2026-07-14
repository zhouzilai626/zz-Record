import fs from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import os from "node:os";
import path from "node:path";
import forge from "node-forge";
import { USER_DATA_PATH } from "./appPaths";
import { choosePreferredLanAddress } from "./phoneCameraLanAddress";
import { RequestBodyTooLargeError, readJsonBody } from "./phoneCameraRequestLimits";

let bridgeBaseUrl: string | null = null;
let bridgeSetupBaseUrl: string | null = null;
let bridgeStartPromise: Promise<string> | null = null;
let currentSessionResolver:
	| (() => {
			sessionId?: string;
			pairingCode?: string;
			pairingUrl?: string;
	  })
	| null = null;
let connectCallback:
	| ((payload: {
			sessionId: string;
			pairingCode: string;
			remoteAddress?: string | null;
	  }) => boolean)
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

const PHONE_CAMERA_HTTPS_PORT = 17885;
const PHONE_CAMERA_SETUP_PORT = 17886;
const PHONE_CAMERA_CONNECT_BODY_MAX_BYTES = 16 * 1024;
const PHONE_CAMERA_FRAME_BODY_MAX_BYTES = 2 * 1024 * 1024;
const PHONE_CAMERA_FRAME_DATA_URL_MAX_LENGTH = PHONE_CAMERA_FRAME_BODY_MAX_BYTES - 16 * 1024;
const PHONE_CAMERA_FRAME_MAX_DIMENSION = 1_920;
const PHONE_CAMERA_FRAME_MAX_PIXELS = 1_920 * 1_080;

function getPreferredLanAddress(): string {
	return choosePreferredLanAddress(os.networkInterfaces());
}

const PHONE_CAMERA_CERT_DIR = path.join(USER_DATA_PATH, "phone-camera-certificates");
const PHONE_CAMERA_CA_CERT_PATH = path.join(PHONE_CAMERA_CERT_DIR, "zz-record-local-ca.cer");
const PHONE_CAMERA_CA_KEY_PATH = path.join(PHONE_CAMERA_CERT_DIR, "zz-record-local-ca-key.pem");
const PHONE_CAMERA_CA_PEM_PATH = path.join(PHONE_CAMERA_CERT_DIR, "zz-record-local-ca.pem");
const PHONE_CAMERA_SERVER_CERT_PATH = path.join(PHONE_CAMERA_CERT_DIR, "phone-camera-server.pem");
const PHONE_CAMERA_SERVER_KEY_PATH = path.join(
	PHONE_CAMERA_CERT_DIR,
	"phone-camera-server-key.pem",
);
const PHONE_CAMERA_SERVER_METADATA_PATH = path.join(
	PHONE_CAMERA_CERT_DIR,
	"phone-camera-server.json",
);

type CertificateAuthority = {
	certificate: forge.pki.Certificate;
	privateKey: forge.pki.rsa.PrivateKey;
};

function createCertificateSerialNumber(): string {
	return forge.util.bytesToHex(forge.random.getBytesSync(16));
}

function setCertificateValidity(certificate: forge.pki.Certificate, years: number): void {
	const now = new Date();
	certificate.validity.notBefore = new Date(now.getTime() - 60_000);
	certificate.validity.notAfter = new Date(now);
	certificate.validity.notAfter.setFullYear(now.getFullYear() + years);
}

function loadOrCreatePhoneCameraCertificateAuthority(): CertificateAuthority {
	fs.mkdirSync(PHONE_CAMERA_CERT_DIR, { recursive: true });

	try {
		if (fs.existsSync(PHONE_CAMERA_CA_PEM_PATH) && fs.existsSync(PHONE_CAMERA_CA_KEY_PATH)) {
			return {
				certificate: forge.pki.certificateFromPem(
					fs.readFileSync(PHONE_CAMERA_CA_PEM_PATH, "utf8"),
				),
				privateKey: forge.pki.privateKeyFromPem(
					fs.readFileSync(PHONE_CAMERA_CA_KEY_PATH, "utf8"),
				),
			};
		}
	} catch {
		// Regenerate a locally scoped CA if its persisted material is unreadable.
	}

	const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
	const certificate = forge.pki.createCertificate();
	certificate.publicKey = keys.publicKey;
	certificate.serialNumber = createCertificateSerialNumber();
	setCertificateValidity(certificate, 10);
	const subject = [
		{ name: "commonName", value: "ZZ Record Local Camera CA" },
		{ name: "organizationName", value: "ZZ Record" },
	];
	certificate.setSubject(subject);
	certificate.setIssuer(subject);
	certificate.setExtensions([
		{ name: "basicConstraints", critical: true, cA: true },
		{
			name: "keyUsage",
			critical: true,
			keyCertSign: true,
			cRLSign: true,
			digitalSignature: true,
		},
	]);
	certificate.sign(keys.privateKey, forge.md.sha256.create());

	fs.writeFileSync(PHONE_CAMERA_CA_KEY_PATH, forge.pki.privateKeyToPem(keys.privateKey), "utf8");
	fs.writeFileSync(PHONE_CAMERA_CA_PEM_PATH, forge.pki.certificateToPem(certificate), "utf8");
	fs.writeFileSync(
		PHONE_CAMERA_CA_CERT_PATH,
		Buffer.from(
			forge.asn1.toDer(forge.pki.certificateToAsn1(certificate)).getBytes(),
			"binary",
		),
	);

	return { certificate, privateKey: keys.privateKey };
}

function loadOrCreatePhoneCameraServerCertificate(
	lanAddress: string,
	certificateAuthority: CertificateAuthority,
): { cert: string; key: string } {
	try {
		const metadata = JSON.parse(fs.readFileSync(PHONE_CAMERA_SERVER_METADATA_PATH, "utf8")) as {
			lanAddress?: unknown;
		};
		if (
			metadata.lanAddress === lanAddress &&
			fs.existsSync(PHONE_CAMERA_SERVER_CERT_PATH) &&
			fs.existsSync(PHONE_CAMERA_SERVER_KEY_PATH)
		) {
			return {
				cert: fs.readFileSync(PHONE_CAMERA_SERVER_CERT_PATH, "utf8"),
				key: fs.readFileSync(PHONE_CAMERA_SERVER_KEY_PATH, "utf8"),
			};
		}
	} catch {
		// The current network address needs a new leaf certificate.
	}

	const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
	const certificate = forge.pki.createCertificate();
	certificate.publicKey = keys.publicKey;
	certificate.serialNumber = createCertificateSerialNumber();
	setCertificateValidity(certificate, 2);
	certificate.setSubject([{ name: "commonName", value: lanAddress }]);
	certificate.setIssuer(certificateAuthority.certificate.subject.attributes);
	certificate.setExtensions([
		{ name: "basicConstraints", critical: true, cA: false },
		{ name: "keyUsage", critical: true, digitalSignature: true, keyEncipherment: true },
		{ name: "extKeyUsage", serverAuth: true },
		{ name: "subjectAltName", altNames: [{ type: 7, ip: lanAddress }] },
	]);
	certificate.sign(certificateAuthority.privateKey, forge.md.sha256.create());

	const credentials = {
		cert: forge.pki.certificateToPem(certificate),
		key: forge.pki.privateKeyToPem(keys.privateKey),
	};
	fs.writeFileSync(PHONE_CAMERA_SERVER_CERT_PATH, credentials.cert, "utf8");
	fs.writeFileSync(PHONE_CAMERA_SERVER_KEY_PATH, credentials.key, "utf8");
	fs.writeFileSync(
		PHONE_CAMERA_SERVER_METADATA_PATH,
		JSON.stringify({ lanAddress }, null, 2),
		"utf8",
	);
	return credentials;
}

function renderCertificateSetupPage(secureUrl: string, healthUrl: string): string {
	return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>ZZ Record 手机摄像头</title>
<style>body{margin:0;background:#07111f;color:#f8fafc;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.page{max-width:560px;margin:0 auto;padding:40px 24px}h1{font-size:28px;line-height:1.25}p,li{color:#cbd5e1}.card{margin:24px 0;padding:20px;border:1px solid #28415f;border-radius:14px;background:#0d1b2a}a{display:block;margin-top:14px;padding:13px 16px;border-radius:10px;background:#2563eb;color:#fff;text-align:center;text-decoration:none;font-weight:700}.secondary{background:#1e293b}.note{font-size:14px;color:#94a3b8}.setup-card{display:none}body.needs-setup .setup-card{display:block}body.needs-setup #connecting{display:none}</style>
</head><body><main class="page"><div id="connecting"><h1>正在打开手机摄像头</h1><p>正在验证本机安全连接...</p></div><section class="card setup-card"><h1>信任本机证书</h1><p>手机浏览器只允许在 HTTPS 页面使用摄像头。此证书仅用于当前电脑的局域网摄像头连接，视频不会上传到互联网。</p><strong>首次使用</strong><ol><li>下载并安装证书。</li><li>iPhone: 在“设置 - 已下载描述文件”安装后，到“通用 - 关于本机 - 证书信任设置”启用完全信任。</li><li>Android: 下载后按系统提示安装为 CA 证书。</li><li>返回这里，打开安全摄像头页并允许摄像头权限。</li></ol><a href="/phone-camera-ca.cer">下载本机证书</a><a class="secondary" href=${JSON.stringify(secureUrl)}>我已安装证书，打开安全摄像头页</a></section><p class="note setup-card">证书只需在这台手机上安装一次。更换电脑或清除 ZZ Record 数据后需要重新安装。</p></main><script>const secureUrl=${JSON.stringify(secureUrl)};const healthUrl=${JSON.stringify(healthUrl)};let settled=false;const showSetup=()=>{if(settled)return;settled=true;document.body.classList.add('needs-setup')};const timeout=window.setTimeout(showSetup,1500);fetch(healthUrl,{cache:'no-store',mode:'cors'}).then((response)=>{if(!response.ok)throw new Error('HTTPS health check failed');settled=true;window.clearTimeout(timeout);window.location.replace(secureUrl)}).catch(()=>{window.clearTimeout(timeout);showSetup()});</script></body></html>`;
}

function renderBridgePage(params: { sessionId: string; pairingCode: string }) {
	const { sessionId, pairingCode } = params;
	return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no,viewport-fit=cover" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<title>ZZ Record 手机摄像头</title>
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
    <span id="status-text">已连接 - ZZ Record</span>
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
let cameraStream = null;
let wakeLock = null;
let facingMode = 'environment';
let overlayTimer = null;
let frameUploadTimer = null;
let frameUploadInFlight = false;
const frameCanvas = document.createElement('canvas');
const frameContext = frameCanvas.getContext('2d', { alpha: false });

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
    setStatus('已连接 - ZZ Record', 'connected');
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
    await startCamera(facingMode);
    setStatus('已连接 - ZZ Record', 'connected');
  } catch(e) {
    facingMode = facingMode === 'environment' ? 'user' : 'environment';
    showError('切换摄像头失败');
  }
}

let reconnectTimer = null;
let reconnectInFlight = false;
let shouldReconnect = true;

function stopFrameUpload() {
  if (frameUploadTimer) clearInterval(frameUploadTimer);
  frameUploadTimer = null;
}

function scheduleReconnect() {
  if (!shouldReconnect || reconnectTimer) return;
  stopFrameUpload();
  setStatus('等待电脑重新打开...', 'connecting');
  errorMsg.style.display = 'none';
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connectAndStartFrameUpload();
  }, 2000);
}

async function connectAndStartFrameUpload() {
  if (!shouldReconnect || reconnectInFlight) return;
  reconnectInFlight = true;
  try {
    const response = await fetch('/phone-camera/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, pairingCode })
    });
    if (response.status === 410) {
      const error = new Error('此配对已被电脑端取消，请重新扫码连接。');
      error.permanent = true;
      throw error;
    }
    if (!response.ok) throw new Error('电脑暂时不可用。');

    startFrameUpload();
    errorMsg.style.display = 'none';
    setStatus('已连接 - ZZ Record', 'connected');
  } catch (error) {
    if (error && error.permanent) {
      shouldReconnect = false;
      disconnect();
      setStatus('需要重新配对', 'error');
      showError(error.message);
    } else {
      scheduleReconnect();
    }
  } finally {
    reconnectInFlight = false;
  }
}

function startFrameUpload() {
  stopFrameUpload();
  void uploadFrame();
  frameUploadTimer = setInterval(() => { void uploadFrame(); }, 125);
}

async function uploadFrame() {
  if (frameUploadInFlight || !cameraStream || !frameContext || preview.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

  const sourceWidth = preview.videoWidth;
  const sourceHeight = preview.videoHeight;
  if (!sourceWidth || !sourceHeight) return;

  const width = Math.min(sourceWidth, 960);
  const height = Math.max(1, Math.round(sourceHeight * width / sourceWidth));
  frameCanvas.width = width;
  frameCanvas.height = height;
  frameContext.drawImage(preview, 0, 0, width, height);

  frameUploadInFlight = true;
  try {
    const response = await fetch('/phone-camera/frame', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        pairingCode,
        frameDataUrl: frameCanvas.toDataURL('image/jpeg', 0.72),
        width,
        height,
        capturedAtMs: Date.now()
      })
    });
    if (!response.ok) throw new Error('电脑端未接受画面。');
  } catch (_error) {
    scheduleReconnect();
  } finally {
    frameUploadInFlight = false;
  }
}

function disconnect() {
  shouldReconnect = false;
  stopFrameUpload();
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  if (cameraStream) cameraStream.getTracks().forEach(t => t.stop());
  if (wakeLock) { wakeLock.release(); wakeLock = null; }
  cameraStream = null;
  preview.srcObject = null;
}
switchBtn.addEventListener('click', (e) => { e.stopPropagation(); switchCamera(); });
disconnectBtn.addEventListener('click', (e) => { e.stopPropagation(); disconnect(); });
startCamera(facingMode).then(() => { void connectAndStartFrameUpload(); }).catch((error) => {
  shouldReconnect = false;
  setStatus('连接失败', 'error');
  showError(error.message || '无法连接到电脑。');
});
window.addEventListener('beforeunload', () => { disconnect(); });
</script>
</body>
</html>`;
}

function renderInvalidBridgePage(): string {
	return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width,initial-scale=1.0" /><title>ZZ Record 手机摄像头</title></head>
<body><main><h1>配对链接已失效</h1><p>请在电脑端重新选择手机摄像头并扫码连接。</p></main></body>
</html>`;
}

function hasValidPhoneCameraFrameDimensions(width: unknown, height: unknown): boolean {
	return (
		typeof width === "number" &&
		typeof height === "number" &&
		Number.isInteger(width) &&
		Number.isInteger(height) &&
		width > 0 &&
		height > 0 &&
		width <= PHONE_CAMERA_FRAME_MAX_DIMENSION &&
		height <= PHONE_CAMERA_FRAME_MAX_DIMENSION &&
		width * height <= PHONE_CAMERA_FRAME_MAX_PIXELS
	);
}

function handlePhoneCameraSetupRequest(request: IncomingMessage, response: ServerResponse): void {
	const base = bridgeSetupBaseUrl ?? "http://127.0.0.1";
	const url = new URL(request.url ?? "/", base);

	if (url.pathname === "/phone-camera-ca.cer" && request.method === "GET") {
		response.writeHead(200, {
			"Content-Type": "application/x-x509-ca-cert",
			"Content-Disposition": "attachment; filename=zz-record-local-camera-ca.cer",
		});
		response.end(fs.readFileSync(PHONE_CAMERA_CA_CERT_PATH));
		return;
	}

	if (url.pathname === "/phone-camera-setup" && request.method === "GET") {
		const secureBaseUrl = bridgeBaseUrl ?? "https://127.0.0.1";
		const secureUrl = new URL("/phone-camera", secureBaseUrl);
		secureUrl.search = url.search;
		const healthUrl = new URL("/phone-camera-health", secureBaseUrl);
		response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
		response.end(renderCertificateSetupPage(secureUrl.toString(), healthUrl.toString()));
		return;
	}

	response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
	response.end("Not Found");
}

export async function handlePhoneCameraBridgeRequest(
	request: IncomingMessage,
	response: ServerResponse,
): Promise<void> {
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

		if (url.pathname === "/phone-camera-health" && request.method === "GET") {
			response.writeHead(204, {
				"Access-Control-Allow-Origin": "*",
				"Cache-Control": "no-store",
			});
			response.end();
			return;
		}

		if (url.pathname === "/phone-camera" && request.method === "GET") {
			const state = currentSessionResolver?.() ?? {};
			const sessionId = url.searchParams.get("session") ?? "";
			const pairingCode = (url.searchParams.get("code") ?? "").toUpperCase();
			const valid = Boolean(
				state.sessionId &&
					state.pairingCode &&
					state.sessionId === sessionId &&
					state.pairingCode === pairingCode,
			);
			const html = valid
				? renderBridgePage({ sessionId, pairingCode })
				: renderInvalidBridgePage();
			response.writeHead(valid ? 200 : 410, { "Content-Type": "text/html; charset=utf-8" });
			response.end(html);
			return;
		}

		if (url.pathname === "/phone-camera/connect" && request.method === "POST") {
			const body = (await readJsonBody(request, PHONE_CAMERA_CONNECT_BODY_MAX_BYTES)) as {
				sessionId?: string;
				pairingCode?: string;
			} | null;
			const sessionId = body?.sessionId;
			const pairingCode = body?.pairingCode?.toUpperCase();
			const success =
				typeof sessionId === "string" &&
				typeof pairingCode === "string" &&
				Boolean(
					connectCallback?.({
						sessionId,
						pairingCode,
						remoteAddress: request.socket.remoteAddress ?? null,
					}),
				);
			response.writeHead(success ? 200 : 410, {
				"Content-Type": "application/json; charset=utf-8",
				"Access-Control-Allow-Origin": "*",
			});
			response.end(
				JSON.stringify(
					success
						? { success: true }
						: { success: false, error: "Session expired or invalid." },
				),
			);
			return;
		}

		if (url.pathname === "/phone-camera/frame" && request.method === "POST") {
			const body = (await readJsonBody(request, PHONE_CAMERA_FRAME_BODY_MAX_BYTES)) as {
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
				frameDataUrl.length <= PHONE_CAMERA_FRAME_DATA_URL_MAX_LENGTH &&
				hasValidPhoneCameraFrameDimensions(body?.width, body?.height) &&
				Boolean(
					frameCallback?.({
						sessionId,
						pairingCode,
						frameDataUrl,
						width: typeof body?.width === "number" ? body.width : undefined,
						height: typeof body?.height === "number" ? body.height : undefined,
						capturedAtMs:
							typeof body?.capturedAtMs === "number" ? body.capturedAtMs : undefined,
						remoteAddress: request.socket.remoteAddress ?? null,
					}),
				);
			response.writeHead(success ? 200 : 410, {
				"Content-Type": "application/json; charset=utf-8",
				"Access-Control-Allow-Origin": "*",
			});
			response.end(
				JSON.stringify(
					success ? { success: true } : { success: false, error: "Frame rejected." },
				),
			);
			return;
		}

		response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
		response.end("Not Found");
	} catch (error) {
		if (error instanceof RequestBodyTooLargeError) {
			response.writeHead(413, {
				"Content-Type": "application/json; charset=utf-8",
				"Access-Control-Allow-Origin": "*",
			});
			response.end(JSON.stringify({ error: "Request body is too large." }));
			return;
		}
		console.error("[phone-camera-bridge] Error handling request:", error);
		response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
		response.end("Internal Server Error");
	}
}

export function configurePhoneCameraBridgeSession(options: {
	getSession: () => { sessionId?: string; pairingCode?: string; pairingUrl?: string };
	onConnect: (payload: {
		sessionId: string;
		pairingCode: string;
		remoteAddress?: string | null;
	}) => boolean;
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
	bridgeStartPromise = (async () => {
		const lanAddress = getPreferredLanAddress();
		if (lanAddress === "127.0.0.1") {
			throw new Error("No local IPv4 network address is available for phone camera pairing.");
		}

		const certificateAuthority = loadOrCreatePhoneCameraCertificateAuthority();
		const credentials = loadOrCreatePhoneCameraServerCertificate(
			lanAddress,
			certificateAuthority,
		);
		const secureServer = createHttpsServer(credentials, (request, response) => {
			void handlePhoneCameraBridgeRequest(request, response);
		});
		const setupServer = createServer((request, response) => {
			handlePhoneCameraSetupRequest(request, response);
		});

		try {
			const securePort = await new Promise<number>((resolve, reject) => {
				secureServer.once("error", reject);
				secureServer.listen(PHONE_CAMERA_HTTPS_PORT, "0.0.0.0", () => {
					const address = secureServer.address();
					if (!address || typeof address === "string") {
						reject(
							new Error("Phone camera HTTPS server did not expose a TCP address."),
						);
						return;
					}
					resolve(address.port);
				});
			});
			const setupPort = await new Promise<number>((resolve, reject) => {
				setupServer.once("error", reject);
				setupServer.listen(PHONE_CAMERA_SETUP_PORT, "0.0.0.0", () => {
					const address = setupServer.address();
					if (!address || typeof address === "string") {
						reject(
							new Error("Phone camera setup server did not expose a TCP address."),
						);
						return;
					}
					resolve(address.port);
				});
			});

			bridgeBaseUrl = `https://${lanAddress}:${securePort}`;
			bridgeSetupBaseUrl = `http://${lanAddress}:${setupPort}`;
			console.log(
				`[phone-camera-bridge] HTTPS at ${bridgeBaseUrl}; certificate setup at ${bridgeSetupBaseUrl}`,
			);
			return bridgeBaseUrl;
		} catch (error) {
			secureServer.close();
			setupServer.close();
			throw error;
		}
	})();

	try {
		return await bridgeStartPromise;
	} catch (error) {
		bridgeStartPromise = null;
		throw error;
	}
}
