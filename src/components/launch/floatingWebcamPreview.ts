export function canShowFloatingWebcamPreview(requested: boolean): boolean {
	return requested;
}

export function shouldShowExternalLocalWebcamPreview(
	recording: boolean,
	webcamEnabled: boolean,
	isPhoneCameraPreview: boolean,
): boolean {
	return recording && webcamEnabled && !isPhoneCameraPreview;
}

export function shouldHideExternalLocalWebcamPreview(
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
