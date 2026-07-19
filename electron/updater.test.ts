import { beforeEach, describe, expect, it, vi } from "vitest";

const updaterMocks = vi.hoisted(() => {
	const handlers = new Map<string, (...args: unknown[]) => void>();
	return {
		handlers,
		autoUpdater: {
			autoDownload: true,
			autoInstallOnAppQuit: true,
			setFeedURL: vi.fn(),
			checkForUpdates: vi.fn(async () => undefined),
			downloadUpdate: vi.fn(async () => undefined),
			quitAndInstall: vi.fn(),
			on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
				handlers.set(event, handler);
			}),
		},
	};
});

vi.mock("electron", () => ({
	app: {
		getVersion: () => "1.4.6",
		isPackaged: true,
		on: vi.fn(),
	},
	BrowserWindow: class {},
	dialog: {
		showMessageBox: vi.fn(async () => ({ response: 1 })),
	},
}));

vi.mock("electron-updater", () => ({ autoUpdater: updaterMocks.autoUpdater }));
vi.mock("./appPaths", () => ({ USER_DATA_PATH: ".test-user-data" }));

import {
	downloadAvailableUpdate,
	getCurrentUpdateToastPayload,
	getUpdateStatusSummary,
	installDownloadedUpdateNow,
	setupAutoUpdates,
} from "./updater";

const autoUpdater = updaterMocks.autoUpdater;
const autoUpdaterHandlers = updaterMocks.handlers;
const sendToast = vi.fn(() => true);
const getWindow = () => null;

function emit(event: string, ...args: unknown[]) {
	const handler = autoUpdaterHandlers.get(event);
	if (!handler) throw new Error(`Missing updater handler: ${event}`);
	handler(...args);
}

describe("Windows auto update flow", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("shows a download action when a newer release is available", () => {
		setupAutoUpdates(getWindow, sendToast, { canInstallDownloadedUpdate: () => true });
		emit("update-available", { version: "1.4.7" });

		expect(getUpdateStatusSummary()).toMatchObject({
			status: "available",
			currentVersion: "1.4.6",
			availableVersion: "1.4.7",
		});
		expect(getCurrentUpdateToastPayload()).toMatchObject({
			phase: "available",
			primaryAction: "download",
		});
	});

	it("keeps the installed app usable when download fails and offers retry", async () => {
		autoUpdater.downloadUpdate.mockRejectedValueOnce(new Error("network unavailable"));
		emit("update-available", { version: "1.4.7" });

		await expect(downloadAvailableUpdate(sendToast)).resolves.toMatchObject({ success: false });
		expect(getUpdateStatusSummary()).toMatchObject({ status: "error", availableVersion: "1.4.7" });
		expect(getCurrentUpdateToastPayload()).toMatchObject({
			phase: "error",
			primaryAction: "retry-check",
		});
		expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
	});

	it("does not restart to install a downloaded update while recording", () => {
		emit("update-downloaded", { version: "1.4.7" });

		expect(
		installDownloadedUpdateNow(sendToast, {
			canInstall: false,
			blockedMessage: "当前正在录制，请先结束录制，再安装更新。",
		}),
	).toEqual({ success: false, message: "当前正在录制，请先结束录制，再安装更新。" });
		expect(getUpdateStatusSummary()).toMatchObject({ status: "ready", availableVersion: "1.4.7" });
		expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
	});

	it("installs only after a downloaded update is ready and the app is idle", () => {
		expect(installDownloadedUpdateNow(sendToast, { canInstall: true })).toEqual({ success: true });
		expect(autoUpdater.quitAndInstall).toHaveBeenCalledOnce();
	});
});
