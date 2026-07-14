import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain, screen } from "electron";
import { USER_DATA_PATH } from "./appPaths";
import { getHudOverlayWindowBounds, resizeHudOverlayFallbackBounds } from "./hudOverlayBounds";
import { getPhoneCameraOverlayHtml } from "./phone-camera/overlayContent";
import {
	movePhoneCameraOverlayBounds,
	normalizePhoneCameraOverlaySettings,
	resizePhoneCameraOverlayBounds,
} from "./phoneCameraOverlaySettings";
import { getPackagedRendererBaseUrl } from "./rendererServer";

const electronWindowsDir = path.dirname(fileURLToPath(import.meta.url));
const nodeRequire = createRequire(import.meta.url);

const APP_ROOT = path.join(electronWindowsDir, "..");
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
const RENDERER_DIST = path.join(APP_ROOT, "dist");
const WINDOW_ICON_FILENAME =
	process.platform === "darwin" ? "recordlymac-512.png" : "recordly-512.png";
const WINDOW_ICON_PATH = path.join(
	process.env.VITE_PUBLIC || RENDERER_DIST,
	"app-icons",
	WINDOW_ICON_FILENAME,
);

let hudOverlayWindow: BrowserWindow | null = null;
let hudOverlayHiddenFromCapture = true;
let hudOverlayCaptureProtectionLoaded = false;
let hudOverlayFallbackExpanded = false;
let hudOverlayIgnoringMouse = true;
let hudOverlaySourceSelectionActive = false;
let hudOverlayMouseReassertTimer: NodeJS.Timeout | null = null;
let hudOverlayRecordingActive = false;
let countdownWindow: BrowserWindow | null = null;
let updateToastWindow: BrowserWindow | null = null;
let phoneCameraPairingWindow: BrowserWindow | null = null;
let cameraOverlaySource: "phone" | "local" | null = null;

const HUD_OVERLAY_SETTINGS_FILE = path.join(USER_DATA_PATH, "hud-overlay-settings.json");
const PHONE_CAMERA_OVERLAY_SETTINGS_FILE = path.join(
	USER_DATA_PATH,
	"phone-camera-overlay-settings.json",
);
const PHONE_CAMERA_OVERLAY_SETTINGS_VERSION = 2;
const HUD_EDGE_MARGIN_DIP = 16;
const UPDATE_TOAST_WIDTH = 456;
const UPDATE_TOAST_HEIGHT = 252;
const UPDATE_TOAST_GAP_DIP = 18;

function getEditorWindowQuery(): Record<string, string> {
	const query: Record<string, string> = {
		windowType: "editor",
	};

	if (process.env.RECORDLY_DEV_OPEN_RECORDING_INPUT) {
		query.devOpenInput = process.env.RECORDLY_DEV_OPEN_RECORDING_INPUT;
	}
	if (process.env.RECORDLY_DEV_OPEN_RECORDING_WEBCAM) {
		query.devOpenWebcam = process.env.RECORDLY_DEV_OPEN_RECORDING_WEBCAM;
	}

	if (process.env.RECORDLY_SMOKE_EXPORT === "1") {
		query.smokeExport = "1";
		if (process.env.RECORDLY_SMOKE_EXPORT_INPUT) {
			query.smokeInput = process.env.RECORDLY_SMOKE_EXPORT_INPUT;
		}
		if (process.env.RECORDLY_SMOKE_EXPORT_OUTPUT) {
			query.smokeOutput = process.env.RECORDLY_SMOKE_EXPORT_OUTPUT;
		}
		if (process.env.RECORDLY_SMOKE_EXPORT_USE_NATIVE === "1") {
			query.smokeUseNativeExport = "1";
		}
		if (process.env.RECORDLY_SMOKE_EXPORT_ENCODING_MODE) {
			query.smokeEncodingMode = process.env.RECORDLY_SMOKE_EXPORT_ENCODING_MODE;
		}
		if (process.env.RECORDLY_SMOKE_EXPORT_SHADOW_INTENSITY) {
			query.smokeShadowIntensity = process.env.RECORDLY_SMOKE_EXPORT_SHADOW_INTENSITY;
		}
		if (process.env.RECORDLY_SMOKE_EXPORT_WEBCAM_INPUT) {
			query.smokeWebcamInput = process.env.RECORDLY_SMOKE_EXPORT_WEBCAM_INPUT;
		}
		if (process.env.RECORDLY_SMOKE_EXPORT_WEBCAM_SHADOW) {
			query.smokeWebcamShadow = process.env.RECORDLY_SMOKE_EXPORT_WEBCAM_SHADOW;
		}
		if (process.env.RECORDLY_SMOKE_EXPORT_WEBCAM_SIZE) {
			query.smokeWebcamSize = process.env.RECORDLY_SMOKE_EXPORT_WEBCAM_SIZE;
		}
		if (process.env.RECORDLY_SMOKE_EXPORT_PIPELINE) {
			query.smokePipelineModel = process.env.RECORDLY_SMOKE_EXPORT_PIPELINE;
		}
		if (process.env.RECORDLY_SMOKE_EXPORT_BACKEND) {
			query.smokeBackendPreference = process.env.RECORDLY_SMOKE_EXPORT_BACKEND;
		}
		if (process.env.RECORDLY_SMOKE_EXPORT_RENDER_BACKEND) {
			query.smokeRenderBackend = process.env.RECORDLY_SMOKE_EXPORT_RENDER_BACKEND;
		}
		if (process.env.RECORDLY_SMOKE_EXPORT_MAX_ENCODE_QUEUE) {
			query.smokeMaxEncodeQueue = process.env.RECORDLY_SMOKE_EXPORT_MAX_ENCODE_QUEUE;
		}
		if (process.env.RECORDLY_SMOKE_EXPORT_MAX_DECODE_QUEUE) {
			query.smokeMaxDecodeQueue = process.env.RECORDLY_SMOKE_EXPORT_MAX_DECODE_QUEUE;
		}
		if (process.env.RECORDLY_SMOKE_EXPORT_MAX_PENDING_FRAMES) {
			query.smokeMaxPendingFrames = process.env.RECORDLY_SMOKE_EXPORT_MAX_PENDING_FRAMES;
		}
		if (process.env.RECORDLY_SMOKE_EXPORT_PROJECT) {
			query.smokeProject = process.env.RECORDLY_SMOKE_EXPORT_PROJECT;
		}
		if (process.env.RECORDLY_SMOKE_EXPORT_QUALITY) {
			query.smokeQuality = process.env.RECORDLY_SMOKE_EXPORT_QUALITY;
		}
		if (process.env.RECORDLY_SMOKE_EXPORT_FPS) {
			query.smokeFps = process.env.RECORDLY_SMOKE_EXPORT_FPS;
		}
	}

	return query;
}

function isHudOverlayCaptureProtectionSupported(): boolean {
	return process.platform !== "linux";
}

function getWindowsBuildNumber(): number | null {
	if (process.platform !== "win32") {
		return null;
	}

	const build = Number.parseInt(os.release().split(".")[2] ?? "", 10);
	return Number.isFinite(build) ? build : null;
}

export function isHudOverlayMousePassthroughSupported(): boolean {
	if (process.platform === "linux") {
		return false;
	}

	const build = getWindowsBuildNumber();
	if (build !== null && build < 22000) {
		return false;
	}

	return true;
}

function loadHudOverlayCaptureProtectionSetting(): boolean {
	if (hudOverlayCaptureProtectionLoaded) {
		return hudOverlayHiddenFromCapture;
	}

	hudOverlayCaptureProtectionLoaded = true;

	try {
		if (!fs.existsSync(HUD_OVERLAY_SETTINGS_FILE)) {
			return hudOverlayHiddenFromCapture;
		}

		const raw = fs.readFileSync(HUD_OVERLAY_SETTINGS_FILE, "utf-8");
		const parsed = JSON.parse(raw) as { hiddenFromCapture?: unknown };
		if (typeof parsed.hiddenFromCapture === "boolean") {
			hudOverlayHiddenFromCapture = parsed.hiddenFromCapture;
		}
	} catch {
		// Ignore settings read failures and fall back to defaults.
	}

	return hudOverlayHiddenFromCapture;
}

function persistHudOverlayCaptureProtectionSetting(enabled: boolean): void {
	try {
		fs.writeFileSync(
			HUD_OVERLAY_SETTINGS_FILE,
			JSON.stringify({ hiddenFromCapture: enabled }, null, 2),
			"utf-8",
		);
	} catch {
		// Ignore settings write failures and keep runtime state working.
	}
}

function getScreen() {
	if (!app.isReady()) {
		throw new Error(
			"getScreen() called before app is ready. Ensure all screen access happens after app.whenReady().",
		);
	}
	return nodeRequire("electron").screen as typeof import("electron").screen;
}

function getHudOverlayDisplay() {
	const hudWindow = getHudOverlayWindow();
	if (hudWindow) {
		return getScreen().getDisplayMatching(hudWindow.getBounds());
	}
	return getScreen().getPrimaryDisplay();
}

function getHudOverlayBounds() {
	const { workArea } = getHudOverlayDisplay();
	return getHudOverlayWindowBounds(
		workArea,
		isHudOverlayMousePassthroughSupported() && !hudOverlayRecordingActive,
		hudOverlayFallbackExpanded,
	);
}

function applyHudOverlayBounds() {
	if (!hudOverlayWindow || hudOverlayWindow.isDestroyed()) {
		return;
	}
	hudOverlayWindow.setBounds(getHudOverlayBounds(), false);

	positionUpdateToastWindow();
	if (!hudOverlayWindow.isVisible()) {
		return;
	}
	hudOverlayWindow.moveTop();
}

function getUpdateToastBounds() {
	const hudWindow = getHudOverlayWindow();
	if (hudWindow) {
		const hudBounds = hudWindow.getBounds();
		const display = getScreen().getDisplayMatching(hudBounds);
		const x = Math.round(hudBounds.x + (hudBounds.width - UPDATE_TOAST_WIDTH) / 2);
		const y = Math.max(
			display.workArea.y + HUD_EDGE_MARGIN_DIP,
			hudBounds.y - UPDATE_TOAST_HEIGHT - UPDATE_TOAST_GAP_DIP,
		);

		return {
			x,
			y,
			width: UPDATE_TOAST_WIDTH,
			height: UPDATE_TOAST_HEIGHT,
		};
	}

	const primaryDisplay = getScreen().getPrimaryDisplay();
	const { workArea } = primaryDisplay;
	return {
		x: Math.round(workArea.x + (workArea.width - UPDATE_TOAST_WIDTH) / 2),
		y: workArea.y + HUD_EDGE_MARGIN_DIP,
		width: UPDATE_TOAST_WIDTH,
		height: UPDATE_TOAST_HEIGHT,
	};
}

function positionUpdateToastWindow() {
	if (!updateToastWindow || updateToastWindow.isDestroyed()) {
		return;
	}

	updateToastWindow.setBounds(getUpdateToastBounds(), false);
	updateToastWindow.moveTop();
}

function setHudOverlayFallbackExpanded(expanded: boolean) {
	if (hudOverlayRecordingActive) {
		hudOverlayFallbackExpanded = false;
		return;
	}

	hudOverlayFallbackExpanded = expanded;
	if (
		!hudOverlayWindow ||
		hudOverlayWindow.isDestroyed() ||
		isHudOverlayMousePassthroughSupported()
	) {
		return;
	}

	const { workArea } = getHudOverlayDisplay();
	const nextBounds = resizeHudOverlayFallbackBounds(
		workArea,
		hudOverlayWindow.getBounds(),
		expanded,
	);
	hudOverlayWindow.setBounds(nextBounds, false);
	positionUpdateToastWindow();
	if (hudOverlayWindow.isVisible()) {
		hudOverlayWindow.moveTop();
	}
}

function setHudOverlayMousePassthrough(ignore: boolean) {
	hudOverlayIgnoringMouse =
		hudOverlaySourceSelectionActive && !hudOverlayRecordingActive
			? true
			: hudOverlayRecordingActive
				? false
				: ignore;

	if (hudOverlayMouseReassertTimer) {
		clearTimeout(hudOverlayMouseReassertTimer);
		hudOverlayMouseReassertTimer = null;
	}

	if (!hudOverlayWindow || hudOverlayWindow.isDestroyed()) {
		return;
	}

	if (hudOverlayRecordingActive) {
		hudOverlayFallbackExpanded = false;
		applyHudOverlayBounds();
		hudOverlayWindow.setIgnoreMouseEvents(false);
		return;
	}

	if (!isHudOverlayMousePassthroughSupported()) {
		if (process.platform !== "linux") {
			setHudOverlayFallbackExpanded(!ignore);
		}
		hudOverlayWindow.setIgnoreMouseEvents(false);
		return;
	}

	if (ignore) {
		hudOverlayWindow.setIgnoreMouseEvents(true, { forward: true });
		return;
	}

	hudOverlayWindow.setIgnoreMouseEvents(false);
}

ipcMain.on("hud-overlay-set-ignore-mouse", (_event, ignore: boolean) => {
	setHudOverlayMousePassthrough(Boolean(ignore));
});

ipcMain.on("hud-overlay-set-source-selection-active", (_event, active: boolean) => {
	hudOverlaySourceSelectionActive = Boolean(active);
	if (hudOverlaySourceSelectionActive) {
		hudOverlayFallbackExpanded = false;
		applyHudOverlayBounds();
		return;
	}

	setHudOverlayMousePassthrough(hudOverlayIgnoringMouse);
});

// Keep compatibility with existing drag IPC/state.
let hudUserPosition: { x: number; y: number } | null = null;
let hudDragOffset: { x: number; y: number } | null = null;
let hudDragLastCursor: { x: number; y: number } | null = null;
let hudDragFixedSize: { width: number; height: number } | null = null;

ipcMain.on("hud-overlay-drag", (_event, phase: string, screenX: number, screenY: number) => {
	if (!hudOverlayWindow || hudOverlayWindow.isDestroyed()) return;

	// On Linux the compositor (especially Wayland) refuses programmatic window
	// placement, so BrowserWindow.setBounds() with x/y is silently ignored and
	// the HUD appears "stuck".  The renderer marks the drag handle as
	// -webkit-app-region: drag on Linux, letting the OS move the window for us.
	// The resulting position is captured by the win.on("moved", ...) listener
	// below so `hudUserPosition` stays in sync.
	if (process.platform === "linux") {
		return;
	}

	if (phase === "start") {
		const bounds = hudOverlayWindow.getBounds();
		hudDragOffset = { x: screenX - bounds.x, y: screenY - bounds.y };
		hudDragLastCursor = { x: screenX, y: screenY };
		hudDragFixedSize = { width: bounds.width, height: bounds.height };
	} else if (phase === "move" && hudDragOffset) {
		if (
			hudDragLastCursor &&
			hudDragLastCursor.x === screenX &&
			hudDragLastCursor.y === screenY
		) {
			return;
		}

		hudDragLastCursor = { x: screenX, y: screenY };
		const targetX = Math.round(screenX - hudDragOffset.x);
		const targetY = Math.round(screenY - hudDragOffset.y);
		const fixedWidth = hudDragFixedSize?.width ?? hudOverlayWindow.getBounds().width;
		const fixedHeight = hudDragFixedSize?.height ?? hudOverlayWindow.getBounds().height;
		hudOverlayWindow.setBounds(
			{
				x: targetX,
				y: targetY,
				width: fixedWidth,
				height: fixedHeight,
			},
			false,
		);
	} else if (phase === "end") {
		const finalBounds = hudOverlayWindow.getBounds();
		hudUserPosition = { x: finalBounds.x, y: finalBounds.y };

		hudDragOffset = null;
		hudDragLastCursor = null;
		hudDragFixedSize = null;
	}
});

ipcMain.on("hud-overlay-hide", () => {
	if (hudOverlayWindow && !hudOverlayWindow.isDestroyed()) {
		hudOverlayWindow.minimize();
	}
	// The camera preview is a separate always-on-top window, so it must follow
	// the recording controls instead of remaining visible after the HUD is hidden.
	hidePhoneCameraOverlayWindow();
});

ipcMain.handle("get-hud-overlay-capture-protection", () => {
	const enabled = loadHudOverlayCaptureProtectionSetting();

	return {
		success: true,
		enabled,
	};
});

ipcMain.handle("get-hud-overlay-mouse-passthrough-supported", () => {
	return {
		success: true,
		supported: isHudOverlayMousePassthroughSupported(),
	};
});

ipcMain.handle("set-hud-overlay-capture-protection", (_event, enabled: boolean) => {
	loadHudOverlayCaptureProtectionSetting();
	hudOverlayHiddenFromCapture = Boolean(enabled);
	persistHudOverlayCaptureProtectionSetting(hudOverlayHiddenFromCapture);

	if (
		isHudOverlayCaptureProtectionSupported() &&
		hudOverlayWindow &&
		!hudOverlayWindow.isDestroyed()
	) {
		hudOverlayWindow.setContentProtection(hudOverlayHiddenFromCapture);
	}

	return {
		success: true,
		enabled: hudOverlayHiddenFromCapture,
	};
});

export function createHudOverlayWindow(): BrowserWindow {
	loadHudOverlayCaptureProtectionSetting();
	hudOverlayFallbackExpanded = false;
	const initialBounds = getHudOverlayBounds();
	let hasShownHudWindow = false;

	const win = new BrowserWindow({
		width: initialBounds.width,
		height: initialBounds.height,
		x: initialBounds.x,
		y: initialBounds.y,
		frame: false,
		transparent: true,
		backgroundColor: "#00000000",
		resizable: false,
		alwaysOnTop: true,
		skipTaskbar: true,
		hasShadow: false,
		show: false,
		focusable: false,
		webPreferences: {
			preload: path.join(electronWindowsDir, "preload.mjs"),
			nodeIntegration: false,
			contextIsolation: true,
			webSecurity: true,
			backgroundThrottling: false,
		},
	});

	const showHudWindow = () => {
		if (hasShownHudWindow || win.isDestroyed()) {
			return;
		}
		hasShownHudWindow = true;
		win.show();
		win.moveTop();
		if (process.platform === "win32" && isHudOverlayMousePassthroughSupported()) {
			win.setIgnoreMouseEvents(false);
			setTimeout(() => {
				if (!win.isDestroyed()) {
					setHudOverlayMousePassthrough(hudOverlayIgnoringMouse);
				}
			}, 50);
		}
	};

	if (isHudOverlayCaptureProtectionSupported()) {
		win.setContentProtection(hudOverlayHiddenFromCapture);
	}

	if (isHudOverlayMousePassthroughSupported()) {
		if (hudOverlayRecordingActive) {
			hudOverlayIgnoringMouse = false;
			win.setIgnoreMouseEvents(false);
		} else {
			hudOverlayIgnoringMouse = true;
			win.setIgnoreMouseEvents(true, { forward: true });
		}
	}

	// On Windows 11+, focus changes (e.g. showing a native notification) can break
	// setIgnoreMouseEvents forwarding on a transparent always-on-top window, making
	// it permanently click-through without hover detection.  Re-initialise the
	// pass-through-with-forwarding state whenever the window gains focus by toggling
	// the flag off then back on so the native WS_EX_TRANSPARENT flag is fully reset.
	// On Windows 10 (build < 22000) passthrough is disabled entirely, so skip this.
	if (process.platform === "win32" && isHudOverlayMousePassthroughSupported()) {
		win.on("focus", () => {
			if (!win.isDestroyed()) {
				win.setIgnoreMouseEvents(false);
				setTimeout(() => {
					if (!win.isDestroyed()) {
						setHudOverlayMousePassthrough(hudOverlayIgnoringMouse);
					}
				}, 50);
			}
		});
	}

	win.webContents.on("did-finish-load", () => {
		win?.webContents.send("main-process-message", new Date().toLocaleString());
		// Safety fallback if renderer-ready signal never arrives.
		setTimeout(() => {
			showHudWindow();
		}, 1800);
	});

	// Safety net: on Linux the renderer may fail to fire did-finish-load
	// (for example due to GPU/VAAPI startup issues). Show the window after
	// ready-to-show as a fallback so the HUD still appears.
	win.once("ready-to-show", () => {
		setTimeout(() => {
			if (!win.isDestroyed() && !win.isVisible()) {
				showHudWindow();
			}
		}, 500);
	});

	const handleHudRendererReady = () => {
		if (!win.isDestroyed()) {
			showHudWindow();
		}
	};
	ipcMain.on("hud-overlay-renderer-ready", handleHudRendererReady);

	hudOverlayWindow = win;

	// On Linux the HUD is dragged by the OS via -webkit-app-region (Wayland
	// forbids client-side positioning). Mirror moved bounds into drag state.
	if (process.platform === "linux") {
		win.on("moved", () => {
			if (win.isDestroyed()) return;
			const { x, y } = win.getBounds();
			hudUserPosition = { x, y };
		});
	}

	// Reset the user's saved HUD position when displays change so the bar
	// doesn't end up stranded off-screen after a monitor is disconnected.
	const screen = getScreen();
	const handleDisplayRemoved = () => {
		hudUserPosition = null;
	};
	const handleDisplayMetricsChanged = () => {
		if (hudUserPosition) {
			const displays = screen.getAllDisplays();
			const onScreen = displays.some(
				(d) =>
					hudUserPosition!.x >= d.workArea.x &&
					hudUserPosition!.x < d.workArea.x + d.workArea.width &&
					hudUserPosition!.y >= d.workArea.y &&
					hudUserPosition!.y < d.workArea.y + d.workArea.height,
			);
			if (!onScreen) {
				hudUserPosition = null;
			}
		}
		applyHudOverlayBounds();
	};
	screen.on("display-removed", handleDisplayRemoved);
	screen.on("display-metrics-changed", handleDisplayMetricsChanged);

	win.on("closed", () => {
		ipcMain.removeListener("hud-overlay-renderer-ready", handleHudRendererReady);
		screen.removeListener("display-removed", handleDisplayRemoved);
		screen.removeListener("display-metrics-changed", handleDisplayMetricsChanged);
		if (hudOverlayWindow === win) {
			hudOverlayWindow = null;
		}
	});

	if (VITE_DEV_SERVER_URL) {
		win.loadURL(VITE_DEV_SERVER_URL + "?windowType=hud-overlay");
	} else {
		win.loadFile(path.join(RENDERER_DIST, "index.html"), {
			query: { windowType: "hud-overlay" },
		});
	}

	return win;
}

export function getHudOverlayWindow(): BrowserWindow | null {
	return hudOverlayWindow && !hudOverlayWindow.isDestroyed() ? hudOverlayWindow : null;
}

/**
 * Re-initialise the HUD overlay's mouse passthrough state.
 *
 * On Windows 11+, any new BrowserWindow appearing (even focusable:false ones
 * like the source highlight overlay) can silently corrupt the
 * WS_EX_TRANSPARENT flag that backs setIgnoreMouseEvents forwarding.  Call
 * this after any operation that creates or destroys a sibling window so that
 * hover detection on the HUD is immediately restored without requiring the
 * user to move their mouse over the bar.
 */
export function reassertHudOverlayMousePassthrough(): void {
	if (process.platform !== "win32" || !isHudOverlayMousePassthroughSupported()) {
		return;
	}

	const hud = getHudOverlayWindow();
	if (!hud) {
		return;
	}

	if (hudOverlayRecordingActive) {
		hud.setIgnoreMouseEvents(false);
		return;
	}

	// Toggle off then back on so the native WS_EX_TRANSPARENT flag is fully
	// re-initialised rather than merely re-asserted in a potentially broken state.
	hud.setIgnoreMouseEvents(false);
	if (hudOverlayMouseReassertTimer) {
		clearTimeout(hudOverlayMouseReassertTimer);
	}
	hudOverlayMouseReassertTimer = setTimeout(() => {
		hudOverlayMouseReassertTimer = null;
		if (!hud.isDestroyed()) {
			setHudOverlayMousePassthrough(hudOverlayIgnoringMouse);
		}
	}, 50);
}

export function setHudOverlayRecordingActive(recording: boolean): void {
	hudOverlayRecordingActive = Boolean(recording);
	hudOverlayFallbackExpanded = false;
	applyHudOverlayBounds();
	setHudOverlayMousePassthrough(!hudOverlayRecordingActive);
}

export function createUpdateToastWindow(): BrowserWindow {
	const initialBounds = getUpdateToastBounds();
	const parentWindow =
		process.platform === "darwin" && hudOverlayWindow && !hudOverlayWindow.isDestroyed()
			? hudOverlayWindow
			: undefined;
	const useTransparentToastWindow = process.platform !== "win32";

	const win = new BrowserWindow({
		width: initialBounds.width,
		height: initialBounds.height,
		x: initialBounds.x,
		y: initialBounds.y,
		frame: false,
		transparent: useTransparentToastWindow,
		resizable: false,
		alwaysOnTop: true,
		skipTaskbar: true,
		hasShadow: false,
		show: false,
		focusable: true,
		...(parentWindow ? { parent: parentWindow } : {}),
		backgroundColor: useTransparentToastWindow ? "#00000000" : "#101418",
		webPreferences: {
			preload: path.join(electronWindowsDir, "preload.mjs"),
			nodeIntegration: false,
			contextIsolation: true,
			backgroundThrottling: false,
		},
	});

	if (process.platform === "darwin") {
		win.setAlwaysOnTop(true, "status");
	}

	win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
	updateToastWindow = win;

	win.on("closed", () => {
		if (updateToastWindow === win) {
			updateToastWindow = null;
		}
	});

	if (VITE_DEV_SERVER_URL) {
		win.loadURL(VITE_DEV_SERVER_URL + "?windowType=update-toast");
	} else {
		win.loadFile(path.join(RENDERER_DIST, "index.html"), {
			query: { windowType: "update-toast" },
		});
	}

	return win;
}

export function getUpdateToastWindow(): BrowserWindow | null {
	return updateToastWindow && !updateToastWindow.isDestroyed() ? updateToastWindow : null;
}

export function showUpdateToastWindow(): BrowserWindow {
	const win = getUpdateToastWindow() ?? createUpdateToastWindow();
	positionUpdateToastWindow();
	if (!win.isVisible()) {
		if (process.platform === "win32") {
			win.show();
			win.moveTop();
		} else {
			win.showInactive();
		}
	} else {
		win.moveTop();
	}

	return win;
}

export function hideUpdateToastWindow(): void {
	if (!updateToastWindow || updateToastWindow.isDestroyed()) {
		return;
	}

	updateToastWindow.hide();
}

function loadPackagedEditorWindow(win: BrowserWindow) {
	const query = getEditorWindowQuery();
	const queryString = new URLSearchParams(query).toString();
	const indexHtmlPath = path.join(RENDERER_DIST, "index.html");
	const packagedRendererBaseUrl = getPackagedRendererBaseUrl();
	const webContents = win.webContents;

	const loadFromFile = () => {
		if (win.isDestroyed()) {
			return;
		}

		console.log("[editor-window] load-file", indexHtmlPath);
		void win.loadFile(indexHtmlPath, { query });
	};

	if (!packagedRendererBaseUrl) {
		loadFromFile();
		return;
	}

	const targetUrl = `${packagedRendererBaseUrl}/?${queryString}`;
	let settled = false;
	let timeoutId: NodeJS.Timeout | null = setTimeout(() => {
		fallbackToFile("load-timeout");
	}, 5000);

	const clearTimeoutIfNeeded = () => {
		if (timeoutId) {
			clearTimeout(timeoutId);
			timeoutId = null;
		}
	};

	const detachLoadListeners = () => {
		clearTimeoutIfNeeded();
		if (webContents.isDestroyed()) {
			return;
		}

		webContents.removeListener("did-fail-load", handleDidFailLoad);
		webContents.removeListener("did-finish-load", handleDidFinishLoad);
	};

	const fallbackToFile = (reason: string, details?: Record<string, unknown>) => {
		if (settled || win.isDestroyed()) {
			return;
		}

		settled = true;
		detachLoadListeners();
		console.warn("[editor-window] packaged renderer URL failed, falling back to file", {
			reason,
			targetUrl,
			...details,
		});
		loadFromFile();
	};

	const handleDidFailLoad = (
		_event: Electron.Event,
		errorCode: number,
		errorDescription: string,
		validatedURL: string,
		isMainFrame: boolean,
	) => {
		if (!isMainFrame || validatedURL !== targetUrl) {
			return;
		}

		fallbackToFile("did-fail-load", {
			errorCode,
			errorDescription,
			validatedURL,
		});
	};

	const handleDidFinishLoad = () => {
		if (webContents.getURL() !== targetUrl) {
			return;
		}

		settled = true;
		detachLoadListeners();
	};

	webContents.on("did-fail-load", handleDidFailLoad);
	webContents.on("did-finish-load", handleDidFinishLoad);
	win.once("closed", clearTimeoutIfNeeded);

	console.log("[editor-window] load-url", targetUrl);
	void win.loadURL(targetUrl).catch((error) => {
		fallbackToFile("load-url-rejected", {
			error: error instanceof Error ? error.message : String(error),
		});
	});
}

export function createEditorWindow(): BrowserWindow {
	const perfStart = Date.now();
	console.log("[PERF:MAIN] createEditorWindow: STARTED");
	const isMac = process.platform === "darwin";
	const { workArea, workAreaSize } = getScreen().getPrimaryDisplay();
	const initialWidth = isMac ? Math.round(workAreaSize.width * 0.85) : workArea.width;
	const initialHeight = isMac ? Math.round(workAreaSize.height * 0.85) : workArea.height;

	const win = new BrowserWindow({
		width: initialWidth,
		height: initialHeight,
		...(!isMac && {
			x: workArea.x,
			y: workArea.y,
		}),
		minWidth: 800,
		minHeight: 600,
		...(process.platform !== "darwin" && {
			icon: WINDOW_ICON_PATH,
		}),
		...(isMac && {
			titleBarStyle: "hiddenInset",
			trafficLightPosition: { x: 12, y: 12 },
		}),
		autoHideMenuBar: !isMac,
		transparent: false,
		resizable: true,
		alwaysOnTop: false,
		skipTaskbar: false,
		title: "ZZ Record",
		show: false,
		backgroundColor: "#000000",
		webPreferences: {
			preload: path.join(electronWindowsDir, "preload.mjs"),
			nodeIntegration: false,
			contextIsolation: true,
			webSecurity: true,
			backgroundThrottling: false,
		},
	});

	win.once("ready-to-show", () => {
		console.log(`[PERF:MAIN] Editor Window: ready-to-show in ${Date.now() - perfStart}ms`);
		win.show();
	});

	win.webContents.on("did-finish-load", () => {
		console.log(`[PERF:MAIN] Editor Window: did-finish-load in ${Date.now() - perfStart}ms`);
		win?.webContents.send("main-process-message", new Date().toLocaleString());
		// Fallback for Linux/Wayland where `ready-to-show` may not fire reliably.
		if (!win.isDestroyed() && !win.isVisible()) {
			console.log("[editor-window] forcing show after did-finish-load");
			win.show();
		}
	});

	win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
		console.error("[editor-window] did-fail-load", {
			errorCode,
			errorDescription,
			validatedURL,
		});
	});

	win.webContents.on("render-process-gone", (_event, details) => {
		console.error("[editor-window] render-process-gone", details);
	});

	win.on("show", () => {
		console.log("[editor-window] show");
	});

	win.on("focus", () => {
		console.log("[editor-window] focus");
	});

	if (VITE_DEV_SERVER_URL) {
		const query = new URLSearchParams(getEditorWindowQuery());
		win.loadURL(`${VITE_DEV_SERVER_URL}?${query.toString()}`);
	} else {
		loadPackagedEditorWindow(win);
	}

	return win;
}

export function createSourceSelectorWindow(): BrowserWindow {
	const { width, height } = getScreen().getPrimaryDisplay().workAreaSize;

	const win = new BrowserWindow({
		width: 620,
		height: 420,
		minHeight: 350,
		maxHeight: 500,
		x: Math.round((width - 620) / 2),
		y: Math.round((height - 420) / 2),
		frame: false,
		resizable: false,
		alwaysOnTop: true,
		transparent: true,
		show: false,
		...(process.platform !== "darwin" && {
			icon: WINDOW_ICON_PATH,
		}),
		backgroundColor: "#00000000",
		webPreferences: {
			preload: path.join(electronWindowsDir, "preload.mjs"),
			nodeIntegration: false,
			contextIsolation: true,
		},
	});

	win.webContents.on("did-finish-load", () => {
		setTimeout(() => {
			if (!win.isDestroyed()) {
				win.show();
			}
		}, 100);
	});

	if (VITE_DEV_SERVER_URL) {
		win.loadURL(VITE_DEV_SERVER_URL + "?windowType=source-selector");
	} else {
		win.loadFile(path.join(RENDERER_DIST, "index.html"), {
			query: { windowType: "source-selector" },
		});
	}

	return win;
}

export function createCountdownWindow(): BrowserWindow {
	const primaryDisplay = getScreen().getPrimaryDisplay();
	const { width, height } = primaryDisplay.workAreaSize;

	const windowSize = 200;
	const x = Math.floor((width - windowSize) / 2);
	const y = Math.floor((height - windowSize) / 2);

	const win = new BrowserWindow({
		width: windowSize,
		height: windowSize,
		x: x,
		y: y,
		frame: false,
		transparent: true,
		resizable: false,
		alwaysOnTop: true,
		skipTaskbar: true,
		hasShadow: false,
		focusable: true,
		show: false,
		webPreferences: {
			preload: path.join(electronWindowsDir, "preload.mjs"),
			nodeIntegration: false,
			contextIsolation: true,
		},
	});

	countdownWindow = win;

	win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

	win.webContents.on("did-finish-load", () => {
		if (!win.isDestroyed()) {
			if (process.platform === "win32") {
				win.showInactive();
				win.moveTop();
			} else {
				win.show();
			}
		}
	});

	win.on("closed", () => {
		if (countdownWindow === win) {
			countdownWindow = null;
		}
	});

	if (VITE_DEV_SERVER_URL) {
		win.loadURL(VITE_DEV_SERVER_URL + "?windowType=countdown");
	} else {
		win.loadFile(path.join(RENDERER_DIST, "index.html"), {
			query: { windowType: "countdown" },
		});
	}

	return win;
}

export function getCountdownWindow(): BrowserWindow | null {
	return countdownWindow;
}

export function closeCountdownWindow(): void {
	if (countdownWindow && !countdownWindow.isDestroyed()) {
		countdownWindow.close();
		countdownWindow = null;
	}
}

export function createPhoneCameraPairingWindow(): BrowserWindow {
	const primaryDisplay = getScreen().getPrimaryDisplay();
	const { x: workAreaX, y: workAreaY, width, height } = primaryDisplay.workArea;
	const windowWidth = 540;
	const windowHeight = 590;
	const x = Math.round(workAreaX + (width - windowWidth) / 2);
	const y = Math.round(workAreaY + (height - windowHeight) / 2);

	const win = new BrowserWindow({
		width: windowWidth,
		height: windowHeight,
		x,
		y,
		resizable: false,
		autoHideMenuBar: true,
		show: false,
		backgroundColor: "#07111f",
		...(process.platform !== "darwin" && {
			icon: WINDOW_ICON_PATH,
		}),
		webPreferences: {
			preload: path.join(electronWindowsDir, "preload.mjs"),
			nodeIntegration: false,
			contextIsolation: true,
			backgroundThrottling: false,
		},
	});

	phoneCameraPairingWindow = win;

	win.once("ready-to-show", () => {
		if (process.platform === "win32") {
			win.show();
			win.moveTop();
		} else {
			win.show();
			win.focus();
		}
	});

	win.on("closed", () => {
		if (phoneCameraPairingWindow === win) {
			phoneCameraPairingWindow = null;
		}
	});

	if (VITE_DEV_SERVER_URL) {
		void win.loadURL(VITE_DEV_SERVER_URL + "?windowType=phone-camera-pairing");
	} else {
		void win.loadFile(path.join(RENDERER_DIST, "index.html"), {
			query: { windowType: "phone-camera-pairing" },
		});
	}

	return win;
}

export function getPhoneCameraPairingWindow(): BrowserWindow | null {
	return phoneCameraPairingWindow && !phoneCameraPairingWindow.isDestroyed()
		? phoneCameraPairingWindow
		: null;
}

export function showPhoneCameraPairingWindow(): BrowserWindow {
	const win = getPhoneCameraPairingWindow() ?? createPhoneCameraPairingWindow();
	if (!win.isVisible() && !win.webContents.isLoadingMainFrame()) {
		if (process.platform === "win32") {
			win.show();
			win.moveTop();
		} else {
			win.show();
			win.focus();
		}
	} else if (win.isVisible()) {
		win.moveTop();
		win.focus();
	}
	return win;
}

export function closePhoneCameraPairingWindow(): void {
	if (!phoneCameraPairingWindow || phoneCameraPairingWindow.isDestroyed()) {
		return;
	}
	phoneCameraPairingWindow.close();
	phoneCameraPairingWindow = null;
}

// ---- Phone Camera Overlay ----
let phoneCameraOverlayWindow: BrowserWindow | null = null;

// Keep the live phone view compact enough for everyday recording without hiding the content behind it.
const PHONE_CAMERA_OVERLAY_SIZE = 200;
const PHONE_CAMERA_OVERLAY_MARGIN = 24;
const PHONE_CAMERA_OVERLAY_SHADOW_PADDING = 30;
const PHONE_CAMERA_OVERLAY_WINDOW_SIZE =
	PHONE_CAMERA_OVERLAY_SIZE + PHONE_CAMERA_OVERLAY_SHADOW_PADDING * 2;
const PHONE_CAMERA_OVERLAY_MIN_WINDOW_SIZE = 160;
const PHONE_CAMERA_OVERLAY_MAX_WINDOW_SIZE = 640;

type PhoneCameraOverlayInteraction = {
	kind: "move" | "resize";
	startScreenX: number;
	startScreenY: number;
	bounds: Electron.Rectangle;
};

let phoneCameraOverlayInteraction: PhoneCameraOverlayInteraction | null = null;

function readPhoneCameraOverlaySettings(): unknown {
	try {
		const value = JSON.parse(fs.readFileSync(PHONE_CAMERA_OVERLAY_SETTINGS_FILE, "utf8")) as {
			version?: unknown;
		};
		return value.version === PHONE_CAMERA_OVERLAY_SETTINGS_VERSION ? value : null;
	} catch {
		return null;
	}
}

function persistPhoneCameraOverlaySettings(win: BrowserWindow): void {
	if (win.isDestroyed()) {
		return;
	}

	try {
		const bounds = win.getBounds();
		fs.mkdirSync(path.dirname(PHONE_CAMERA_OVERLAY_SETTINGS_FILE), { recursive: true });
		fs.writeFileSync(
			PHONE_CAMERA_OVERLAY_SETTINGS_FILE,
			JSON.stringify({
				version: PHONE_CAMERA_OVERLAY_SETTINGS_VERSION,
				x: bounds.x,
				y: bounds.y,
				size: bounds.width,
			}),
			"utf8",
		);
	} catch (error) {
		console.warn("[phone-camera] Failed to save preview position:", error);
	}
}

function setPhoneCameraOverlayWindowSize(
	size: number,
	anchor: "top-left" | "bottom-right" = "top-left",
): void {
	const win = getPhoneCameraOverlayWindow();
	if (!win) {
		return;
	}

	const limits = {
		minSize: PHONE_CAMERA_OVERLAY_MIN_WINDOW_SIZE,
		maxSize: PHONE_CAMERA_OVERLAY_MAX_WINDOW_SIZE,
	};
	const requestedBounds = resizePhoneCameraOverlayBounds(win.getBounds(), size, limits, anchor);
	const workArea = screen.getDisplayMatching(requestedBounds).workArea;
	const nextBounds = normalizePhoneCameraOverlaySettings(
		{ x: requestedBounds.x, y: requestedBounds.y, size: requestedBounds.width },
		workArea,
		limits,
	);
	if (!nextBounds) {
		return;
	}
	win.setBounds({
		x: nextBounds.x,
		y: nextBounds.y,
		width: nextBounds.size,
		height: nextBounds.size,
	});
	persistPhoneCameraOverlaySettings(win);
}

function positionPhoneCameraOverlayWindow(win: BrowserWindow): void {
	const workArea = screen.getPrimaryDisplay().workArea;
	const saved = normalizePhoneCameraOverlaySettings(readPhoneCameraOverlaySettings(), workArea, {
		minSize: PHONE_CAMERA_OVERLAY_MIN_WINDOW_SIZE,
		maxSize: PHONE_CAMERA_OVERLAY_MAX_WINDOW_SIZE,
	});
	if (saved) {
		win.setBounds({ x: saved.x, y: saved.y, width: saved.size, height: saved.size });
		return;
	}
	win.setPosition(
		workArea.x +
			workArea.width -
			PHONE_CAMERA_OVERLAY_MARGIN -
			PHONE_CAMERA_OVERLAY_SIZE -
			PHONE_CAMERA_OVERLAY_SHADOW_PADDING,
		workArea.y +
			workArea.height -
			PHONE_CAMERA_OVERLAY_MARGIN -
			PHONE_CAMERA_OVERLAY_SIZE -
			PHONE_CAMERA_OVERLAY_SHADOW_PADDING,
	);
}

function updatePhoneCameraOverlayInteraction(
	kind: PhoneCameraOverlayInteraction["kind"],
	phase: "start" | "move" | "end",
	screenX: number,
	screenY: number,
): void {
	const win = getPhoneCameraOverlayWindow();
	if (!win || !Number.isFinite(screenX) || !Number.isFinite(screenY)) {
		return;
	}

	if (phase === "start") {
		phoneCameraOverlayInteraction = {
			kind,
			startScreenX: screenX,
			startScreenY: screenY,
			bounds: win.getBounds(),
		};
		return;
	}

	const interaction = phoneCameraOverlayInteraction;
	if (!interaction || interaction.kind !== kind) {
		return;
	}

	if (phase === "end") {
		if (kind === "move") {
			const currentBounds = win.getBounds();
			win.setBounds({
				x: currentBounds.x,
				y: currentBounds.y,
				width: interaction.bounds.width,
				height: interaction.bounds.height,
			});
		}
		phoneCameraOverlayInteraction = null;
		persistPhoneCameraOverlaySettings(win);
		return;
	}

	const deltaX = Math.round(screenX - interaction.startScreenX);
	const deltaY = Math.round(screenY - interaction.startScreenY);
	if (kind === "move") {
		win.setBounds(movePhoneCameraOverlayBounds(interaction.bounds, deltaX, deltaY));
		return;
	}

	// Down/right grows; up/left shrinks. Averaging prevents diagonal wobble.
	const sizeDelta = Math.round((deltaX + deltaY) / 2);
	setPhoneCameraOverlayWindowSize(interaction.bounds.width + sizeDelta);
}

ipcMain.on(
	"phone-camera-overlay:interact",
	(
		_event,
		kind: PhoneCameraOverlayInteraction["kind"],
		phase,
		screenX: number,
		screenY: number,
	) => {
		if (
			(kind !== "move" && kind !== "resize") ||
			(phase !== "start" && phase !== "move" && phase !== "end")
		) {
			return;
		}
		updatePhoneCameraOverlayInteraction(kind, phase, screenX, screenY);
	},
);

ipcMain.on("phone-camera-overlay:resize-by", (_event, delta: number) => {
	if (!Number.isFinite(delta) || Math.abs(delta) > PHONE_CAMERA_OVERLAY_MAX_WINDOW_SIZE) {
		return;
	}

	const win = getPhoneCameraOverlayWindow();
	if (win) {
		setPhoneCameraOverlayWindowSize(win.getBounds().width + delta, "bottom-right");
	}
});

ipcMain.on("phone-camera-overlay:reset-size", () => {
	setPhoneCameraOverlayWindowSize(PHONE_CAMERA_OVERLAY_WINDOW_SIZE, "bottom-right");
});

export function createPhoneCameraOverlayWindow(): BrowserWindow {
	if (phoneCameraOverlayWindow && !phoneCameraOverlayWindow.isDestroyed()) {
		return phoneCameraOverlayWindow;
	}

	const win = new BrowserWindow({
		width: PHONE_CAMERA_OVERLAY_WINDOW_SIZE,
		height: PHONE_CAMERA_OVERLAY_WINDOW_SIZE,
		frame: false,
		transparent: true,
		backgroundColor: "#00000000",
		resizable: false,
		minWidth: PHONE_CAMERA_OVERLAY_MIN_WINDOW_SIZE,
		minHeight: PHONE_CAMERA_OVERLAY_MIN_WINDOW_SIZE,
		alwaysOnTop: true,
		skipTaskbar: true,
		hasShadow: false,
		show: false,
		focusable: true,
		title: "Recordly Phone Camera",
		webPreferences: {
			preload: path.join(electronWindowsDir, "preload.mjs"),
			nodeIntegration: false,
			contextIsolation: true,
			backgroundThrottling: false,
		},
	});

	phoneCameraOverlayWindow = win;

	win.once("ready-to-show", () => {
		positionPhoneCameraOverlayWindow(win);
		win.show();
		win.moveTop();
	});

	win.on("closed", () => {
		if (phoneCameraOverlayWindow === win) {
			phoneCameraOverlayWindow = null;
		}
	});

	const html = getPhoneCameraOverlayHtml();
	win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

	return win;
}

export function showPhoneCameraOverlayWindow(options?: {
	excludeFromCapture?: boolean;
}): BrowserWindow | null {
	cameraOverlaySource = "phone";
	const win = getPhoneCameraOverlayWindow() ?? createPhoneCameraOverlayWindow();
	if (isHudOverlayCaptureProtectionSupported()) {
		win.setContentProtection(Boolean(options?.excludeFromCapture));
	}
	if (!win.isVisible()) {
		win.show();
		win.moveTop();
	}
	return win;
}

export function showLocalCameraOverlayWindow(options?: {
	excludeFromCapture?: boolean;
}): BrowserWindow | null {
	cameraOverlaySource = "local";
	const win = getPhoneCameraOverlayWindow() ?? createPhoneCameraOverlayWindow();
	if (isHudOverlayCaptureProtectionSupported()) {
		win.setContentProtection(Boolean(options?.excludeFromCapture));
	}
	if (!win.isVisible()) {
		win.show();
		win.moveTop();
	}
	return win;
}

export function hideLocalCameraOverlayWindow(): void {
	if (cameraOverlaySource !== "local") {
		return;
	}
	hidePhoneCameraOverlayWindow();
}

export function sendLocalCameraOverlayFrame(payload: {
	frameDataUrl: string;
	width?: number;
	height?: number;
}): void {
	if (
		cameraOverlaySource !== "local" ||
		!/^data:image\/(jpeg|jpg|png);base64,[A-Za-z0-9+/=]+$/i.test(payload.frameDataUrl) ||
		payload.frameDataUrl.length > 2 * 1024 * 1024
	) {
		return;
	}

	const win = getPhoneCameraOverlayWindow();
	if (!win) {
		return;
	}
	win.webContents.send("recordly-phone-camera:frame", payload);
}

ipcMain.handle(
	"recordly-camera-overlay:show-local",
	(_event, options?: { excludeFromCapture?: boolean }) => {
		showLocalCameraOverlayWindow(options);
		return { success: true };
	},
);

ipcMain.handle("recordly-camera-overlay:hide-local", () => {
	hideLocalCameraOverlayWindow();
	return { success: true };
});

ipcMain.on("recordly-camera-overlay:local-frame", (_event, payload: unknown) => {
	if (!payload || typeof payload !== "object") {
		return;
	}
	const frame = payload as { frameDataUrl?: unknown; width?: unknown; height?: unknown };
	if (typeof frame.frameDataUrl !== "string") {
		return;
	}
	sendLocalCameraOverlayFrame({
		frameDataUrl: frame.frameDataUrl,
		width: typeof frame.width === "number" ? frame.width : undefined,
		height: typeof frame.height === "number" ? frame.height : undefined,
	});
});
export function hidePhoneCameraOverlayWindow(): void {
	cameraOverlaySource = null;
	if (phoneCameraOverlayWindow && !phoneCameraOverlayWindow.isDestroyed()) {
		if (isHudOverlayCaptureProtectionSupported()) {
			phoneCameraOverlayWindow.setContentProtection(false);
		}
		phoneCameraOverlayWindow.hide();
	}
}

export function destroyPhoneCameraOverlayWindow(): void {
	if (phoneCameraOverlayWindow && !phoneCameraOverlayWindow.isDestroyed()) {
		phoneCameraOverlayWindow.destroy();
	}
	phoneCameraOverlayWindow = null;
}

export function getPhoneCameraOverlayWindow(): BrowserWindow | null {
	return phoneCameraOverlayWindow && !phoneCameraOverlayWindow.isDestroyed()
		? phoneCameraOverlayWindow
		: null;
}
