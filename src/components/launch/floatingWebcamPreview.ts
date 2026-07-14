export function canShowFloatingWebcamPreview(requested: boolean): boolean {
	return requested;
}

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
