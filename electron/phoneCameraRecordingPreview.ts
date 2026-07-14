export function shouldUseExternalPhoneCameraRecordingPreview(
	hudOverlayMousePassthroughSupported: boolean,
): boolean {
	return !hudOverlayMousePassthroughSupported;
}
