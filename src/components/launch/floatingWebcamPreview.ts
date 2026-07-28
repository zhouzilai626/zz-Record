export function canShowFloatingWebcamPreview(requested: boolean): boolean {
	return requested;
}

/**
 * A selected local camera is an explicit user choice, not a popover-only option.
 * Keep its native preview alive while the launcher is idle and while it records.
 */
export function shouldShowExternalLocalWebcamPreview(
	webcamEnabled: boolean,
	isPhoneCameraPreview: boolean,
): boolean {
	return webcamEnabled && !isPhoneCameraPreview;
}

export function canToggleFloatingWebcamPreview(
	hudOverlayMousePassthroughSupported: boolean | null,
): boolean {
	return hudOverlayMousePassthroughSupported !== false;
}
