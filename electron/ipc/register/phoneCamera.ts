import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { BrowserWindow, ipcMain } from "electron";
import {
	PHONE_CAMERA_DEVICE_ID,
	type PhoneCameraFramePayload,
	type PhoneCameraState,
} from "../../../src/lib/phoneCamera";
import { USER_DATA_PATH } from "../../appPaths";
import {
	configurePhoneCameraBridgeSession,
	ensurePhoneCameraBridgeServer,
} from "../../phoneCameraBridgeServer";
import {
	createInactivePhoneCameraState,
	shouldShowPhoneCameraPairing,
} from "../../phoneCameraSessionState";
import {
	closePhoneCameraPairingWindow,
	destroyPhoneCameraOverlayWindow,
	getPhoneCameraOverlayWindow,
	hidePhoneCameraOverlayWindow,
	showPhoneCameraOverlayWindow,
	showPhoneCameraPairingWindow,
} from "../../windows";

const PHONE_CAMERA_STATE_CHANGED_CHANNEL = "recordly-phone-camera:state-changed";
const PHONE_CAMERA_SESSION_PATH = path.join(USER_DATA_PATH, "phone-camera-session.json");
const PHONE_CAMERA_FRAME_TIMEOUT_MS = 5_000;

type PersistedPhoneCameraSession = {
	sessionId: string;
	pairingCode: string;
};

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
let frameLivenessTimer: NodeJS.Timeout | null = null;
let phoneCameraPreviewEnabled = true;

function readPersistedPhoneCameraSession(): PersistedPhoneCameraSession | null {
	try {
		const value = JSON.parse(
			fs.readFileSync(PHONE_CAMERA_SESSION_PATH, "utf8"),
		) as Partial<PersistedPhoneCameraSession>;
		if (
			typeof value.sessionId === "string" &&
			/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value.sessionId) &&
			typeof value.pairingCode === "string" &&
			/^[A-F0-9]{6}$/i.test(value.pairingCode)
		) {
			return { sessionId: value.sessionId, pairingCode: value.pairingCode.toUpperCase() };
		}
	} catch {
		// No prior pairing has been completed on this computer yet.
	}

	return null;
}

function persistPhoneCameraSession(session: PersistedPhoneCameraSession): void {
	try {
		fs.mkdirSync(path.dirname(PHONE_CAMERA_SESSION_PATH), { recursive: true });
		fs.writeFileSync(PHONE_CAMERA_SESSION_PATH, JSON.stringify(session), "utf8");
	} catch (error) {
		console.warn("[phone-camera] Failed to persist pairing session:", error);
	}
}

function clearPersistedPhoneCameraSession(): void {
	try {
		fs.rmSync(PHONE_CAMERA_SESSION_PATH, { force: true });
	} catch (error) {
		console.warn("[phone-camera] Failed to clear saved pairing session:", error);
	}
}

function clearFrameLivenessTimer(): void {
	if (frameLivenessTimer) {
		clearTimeout(frameLivenessTimer);
		frameLivenessTimer = null;
	}
}

function scheduleFrameLivenessCheck(): void {
	clearFrameLivenessTimer();
	frameLivenessTimer = setTimeout(() => {
		frameLivenessTimer = null;
		if (!phoneCameraState.active || !phoneCameraState.connected) {
			return;
		}

		latestPhoneCameraFrame = null;
		setPhoneCameraState({
			connected: false,
			status: "pending",
			message: "Phone camera stopped sending frames. Waiting for it to reconnect.",
			error: undefined,
		});
	}, PHONE_CAMERA_FRAME_TIMEOUT_MS);
}

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
		if (
			phoneCameraState.sessionId !== sessionId ||
			phoneCameraState.pairingCode !== pairingCode
		) {
			return false;
		}

		closePhoneCameraPairingWindow();
		if (phoneCameraPreviewEnabled) {
			showPhoneCameraOverlayWindow();
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
		scheduleFrameLivenessCheck();
		return true;
	},
	onFrame: ({
		sessionId,
		pairingCode,
		frameDataUrl,
		width,
		height,
		capturedAtMs,
		remoteAddress,
	}) => {
		if (
			phoneCameraState.sessionId !== sessionId ||
			phoneCameraState.pairingCode !== pairingCode
		) {
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
		scheduleFrameLivenessCheck();
		const overlayWindow = getPhoneCameraOverlayWindow();
		if (phoneCameraPreviewEnabled && overlayWindow) {
			overlayWindow.webContents.send("recordly-phone-camera:frame", latestPhoneCameraFrame);
		}
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

export function restorePhoneCameraPreviewIfConnected(): void {
	if (phoneCameraPreviewEnabled && phoneCameraState.active && phoneCameraState.connected) {
		showPhoneCameraOverlayWindow();
	}
}

export function registerPhoneCameraHandlers() {
	ipcMain.handle("recordly-phone-camera:get-state", async () => {
		return getPhoneCameraState();
	});

	ipcMain.handle("recordly-phone-camera:start", async (_event, options?: { reason?: string }) => {
		phoneCameraPreviewEnabled = true;
		if (phoneCameraState.active && phoneCameraState.sessionId && phoneCameraState.pairingCode) {
			if (phoneCameraPreviewEnabled) {
				showPhoneCameraOverlayWindow();
			}
			if (shouldShowPhoneCameraPairing(options?.reason, phoneCameraState.connected)) {
				showPhoneCameraPairingWindow();
			}
			return {
				success: true,
				...getPhoneCameraState(),
			};
		}

		const reasonLabel =
			typeof options?.reason === "string" && options.reason.trim().length > 0
				? options.reason.trim()
				: "selection";
		const persistedSession = readPersistedPhoneCameraSession();
		const sessionId = persistedSession?.sessionId ?? randomUUID();
		const pairingCode = persistedSession?.pairingCode ?? buildPairingCode();
		persistPhoneCameraSession({ sessionId, pairingCode });
		setPhoneCameraState({
			active: true,
			connected: false,
			status: "pending",
			startedAtMs: Date.now(),
			lastFrameAtMs: null,
			message: `Waiting for phone camera connection (${reasonLabel}).`,
			error: undefined,
			sessionId,
			pairingCode,
			pairingUrl: undefined,
		});
		latestPhoneCameraFrame = null;
		if (phoneCameraPreviewEnabled) {
			showPhoneCameraOverlayWindow();
		}
		if (shouldShowPhoneCameraPairing(options?.reason, false)) {
			showPhoneCameraPairingWindow();
		}

		try {
			const bridgeBaseUrl = await ensurePhoneCameraBridgeServer();
			const state = setPhoneCameraState({
				pairingUrl: buildPairingUrl(bridgeBaseUrl, sessionId, pairingCode),
			});
			return { success: true, ...state };
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Unable to start phone camera pairing.";
			const state = setPhoneCameraState({
				active: false,
				status: "error",
				message,
				error: message,
			});
			return { success: false, ...state };
		}
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
		// Recording completion must not invalidate a phone that is still open and ready
		// to reconnect. Disable the desktop preview as well, otherwise restoring the
		// editor window can make it reappear over the editor after recording stops.
		// The next recording explicitly enables the preview again in phoneCameraStart.
		phoneCameraPreviewEnabled = false;
		hidePhoneCameraOverlayWindow();
		return { success: true, ...getPhoneCameraState() };
	});

	ipcMain.handle("recordly-phone-camera:suspend-preview", async () => {
		phoneCameraPreviewEnabled = false;
		hidePhoneCameraOverlayWindow();
		return { success: true, ...getPhoneCameraState() };
	});
	ipcMain.handle("recordly-phone-camera:prepare-recording-preview", async () => {
		showPhoneCameraOverlayWindow({ excludeFromCapture: true });
		return { success: true, ...getPhoneCameraState() };
	});

	ipcMain.handle("recordly-phone-camera:forget", async () => {
		clearFrameLivenessTimer();
		clearPersistedPhoneCameraSession();
		latestPhoneCameraFrame = null;
		closePhoneCameraPairingWindow();
		destroyPhoneCameraOverlayWindow();
		const state = setPhoneCameraState(createInactivePhoneCameraState(phoneCameraState));
		return { success: true, ...state };
	});

	// Start the local HTTPS bridge while the app is idle. Opening the pairing window then
	// only has to render the QR code instead of waiting on certificates and TCP listeners.
	void ensurePhoneCameraBridgeServer().catch((error) => {
		console.warn("[phone-camera] Failed to prewarm local bridge:", error);
	});
}
