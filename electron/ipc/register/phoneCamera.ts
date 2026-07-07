import { randomUUID } from "node:crypto";
import { BrowserWindow, ipcMain } from "electron";
import {
	PHONE_CAMERA_DEVICE_ID,
	type PhoneCameraFramePayload,
	type PhoneCameraState,
} from "../../../src/lib/phoneCamera";
import { configurePhoneCameraBridgeSession, ensurePhoneCameraBridgeServer } from "../../phoneCameraBridgeServer";
import { closePhoneCameraPairingWindow, showPhoneCameraPairingWindow } from "../../windows";

const PHONE_CAMERA_STATE_CHANGED_CHANNEL = "recordly-phone-camera:state-changed";

const phoneCameraState: PhoneCameraState = {
	active: false,
	connected: false,
	status: "inactive",
	startedAtMs: null,
	lastFrameAtMs: null,
	deviceId: PHONE_CAMERA_DEVICE_ID,
	message: "Phone camera is idle.",
	sessionId: undefined,
	pairingCode: undefined,
	pairingUrl: undefined,
};
let latestPhoneCameraFrame: PhoneCameraFramePayload | null = null;

function getPhoneCameraState(): PhoneCameraState {
	return { ...phoneCameraState };
}

function broadcastPhoneCameraState(): void {
	const snapshot = getPhoneCameraState();
	for (const window of BrowserWindow.getAllWindows()) {
		if (!window.isDestroyed()) {
			window.webContents.send(PHONE_CAMERA_STATE_CHANGED_CHANNEL, snapshot);
		}
	}
}

function setPhoneCameraState(patch: Partial<PhoneCameraState>): PhoneCameraState {
	Object.assign(phoneCameraState, patch);
	broadcastPhoneCameraState();
	return getPhoneCameraState();
}

configurePhoneCameraBridgeSession({
	getSession: () => ({
		sessionId: phoneCameraState.sessionId,
		pairingCode: phoneCameraState.pairingCode,
		pairingUrl: phoneCameraState.pairingUrl,
	}),
	onConnect: ({ sessionId, pairingCode, remoteAddress }) => {
		if (phoneCameraState.sessionId !== sessionId || phoneCameraState.pairingCode !== pairingCode) {
			return false;
		}

		setPhoneCameraState({
			connected: true,
			status: "connected",
			message: remoteAddress
				? `Phone reached the pairing page from ${remoteAddress}.`
				: "Phone reached the pairing page.",
			error: undefined,
			lastFrameAtMs: Date.now(),
		});
		return true;
	},
	onFrame: ({ sessionId, pairingCode, frameDataUrl, width, height, capturedAtMs, remoteAddress }) => {
		if (phoneCameraState.sessionId !== sessionId || phoneCameraState.pairingCode !== pairingCode) {
			return false;
		}
		if (!/^data:image\/(jpeg|jpg|png);base64,[A-Za-z0-9+/=]+$/i.test(frameDataUrl)) {
			return false;
		}

		latestPhoneCameraFrame = {
			frameDataUrl,
			width,
			height,
			capturedAtMs: typeof capturedAtMs === "number" ? capturedAtMs : Date.now(),
		};
		setPhoneCameraState({
			active: true,
			connected: true,
			status: "connected",
			lastFrameAtMs: Date.now(),
			message: remoteAddress
				? `Receiving phone camera frames from ${remoteAddress}.`
				: "Receiving phone camera frames.",
			error: undefined,
		});
		return true;
	},
});

function buildPairingCode(): string {
	return randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
}

function buildPairingUrl(baseUrl: string, sessionId: string, pairingCode: string): string {
	return `${baseUrl}/phone-camera?session=${encodeURIComponent(sessionId)}&code=${encodeURIComponent(pairingCode)}`;
}

export function registerPhoneCameraHandlers() {
	ipcMain.handle("recordly-phone-camera:get-state", async () => {
		return getPhoneCameraState();
	});

	ipcMain.handle("recordly-phone-camera:start", async (_event, options?: { reason?: string }) => {
		const bridgeBaseUrl = await ensurePhoneCameraBridgeServer();
		const reasonLabel =
			typeof options?.reason === "string" && options.reason.trim().length > 0
				? options.reason.trim()
				: "selection";
		const sessionId = randomUUID();
		const pairingCode = buildPairingCode();
		const pairingUrl = buildPairingUrl(bridgeBaseUrl, sessionId, pairingCode);
		const state = setPhoneCameraState({
			active: true,
			connected: false,
			status: "pending",
			startedAtMs: Date.now(),
			lastFrameAtMs: null,
			message: `Waiting for phone camera connection (${reasonLabel}).`,
			error: undefined,
			sessionId,
			pairingCode,
			pairingUrl,
		});
		latestPhoneCameraFrame = null;
		showPhoneCameraPairingWindow();
		return {
			success: true,
			...state,
		};
	});

	ipcMain.handle("recordly-phone-camera:get-frame", async () => {
		const state = getPhoneCameraState();
		if (latestPhoneCameraFrame) {
			return {
				success: true,
				connected: state.connected,
				status: state.status,
				message: state.message,
				...latestPhoneCameraFrame,
			};
		}
		return {
			success: false,
			connected: state.connected,
			status: state.status,
			message: state.message,
			error: state.active
				? "Phone camera is connected, but no frame has been uploaded yet."
				: "Phone camera session is inactive.",
		};
	});

	ipcMain.handle("recordly-phone-camera:stop", async () => {
		latestPhoneCameraFrame = null;
		const state = setPhoneCameraState({
			active: false,
			connected: false,
			status: "stopped",
			startedAtMs: null,
			lastFrameAtMs: null,
			message: "Phone camera session stopped.",
			error: undefined,
			sessionId: undefined,
			pairingCode: undefined,
			pairingUrl: undefined,
		});
		closePhoneCameraPairingWindow();
		return { success: true, ...state };
	});
}
