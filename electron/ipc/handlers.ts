import { BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { registerAssetHandlers } from "./register/assets";
import {
	isTrustedIpcSenderForWindowTypes,
	type RendererSecurityContext,
} from "../windowSecurity";
import { registerCaptionHandlers } from "./register/captions";
import { registerExportHandlers } from "./register/export";
import { registerPermissionHandlers } from "./register/permissions";
import { registerPhoneCameraHandlers } from "./register/phoneCamera";
import { registerProjectHandlers } from "./register/project";
import { registerRecordingHandlers } from "./register/recording";
import { registerSettingsHandlers } from "./register/settings";
import { registerSourceHandlers } from "./register/sources";
import {
	selectedSource,
	setNativeScreenRecordingActive,
	setWindowsCapturePaused,
	setWindowsCaptureProcess,
	setWindowsCaptureStopRequested,
	setWindowsCaptureTargetPath,
	setWindowsMicAudioPath,
	setWindowsNativeCaptureActive,
	setWindowsOrphanedMicAudioPath,
	setWindowsPendingVideoPath,
	setWindowsSystemAudioPath,
	windowsCaptureProcess,
} from "./state";

export { cleanupAllExportStreams } from "./export/exportStream";
export { cleanupNativeVideoExportSessions } from "./export/native-video";

/** Returns the currently selected source ID for setDisplayMediaRequestHandler */
export function getSelectedSourceId(): string | null {
	return (selectedSource?.id as string | null) ?? null;
}

export function killWindowsCaptureProcess() {
	if (windowsCaptureProcess) {
		try {
			windowsCaptureProcess.kill();
		} catch {
			/* ignore */
		}
		setWindowsCaptureProcess(null);
		setWindowsCaptureTargetPath(null);
		setWindowsNativeCaptureActive(false);
		setNativeScreenRecordingActive(false);
		setWindowsCaptureStopRequested(false);
		setWindowsCapturePaused(false);
		setWindowsSystemAudioPath(null);
		setWindowsMicAudioPath(null);
		setWindowsOrphanedMicAudioPath(null);
		setWindowsPendingVideoPath(null);
	}
}

export type IpcCallerPolicy = {
	allows: (
		event: IpcMainInvokeEvent,
		allowedWindowTypes: readonly string[],
	) => boolean;
};

export function createIpcCallerPolicy(
	context: RendererSecurityContext,
): IpcCallerPolicy {
	return {
		allows: (event, allowedWindowTypes) =>
			isTrustedIpcSenderForWindowTypes(
				event.sender.getURL(),
				context,
				allowedWindowTypes,
			),
	};
}

export function registerIpcHandlers(
	createEditorWindow: () => void,
	createSourceSelectorWindow: () => BrowserWindow,
	_getMainWindow: () => BrowserWindow | null,
	getSourceSelectorWindow: () => BrowserWindow | null,
	onRecordingStateChange?: (recording: boolean, sourceName: string) => void,
	callerPolicy?: IpcCallerPolicy,
) {
	registerSourceHandlers({
		createEditorWindow,
		createSourceSelectorWindow,
		getSourceSelectorWindow,
	});
	registerRecordingHandlers(onRecordingStateChange);
	registerPermissionHandlers();
	registerAssetHandlers(callerPolicy);
	registerExportHandlers();
	registerCaptionHandlers();
	registerProjectHandlers();
	registerSettingsHandlers();
	registerPhoneCameraHandlers();
}
