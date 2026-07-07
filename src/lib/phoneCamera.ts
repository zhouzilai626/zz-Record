export const PHONE_CAMERA_DEVICE_ID = "recordly-phone-camera";
export const PHONE_CAMERA_DEVICE_LABEL = "Phone Camera (Local)";

export type PhoneCameraStatus = "inactive" | "pending" | "connected" | "error" | "stopped";

export type PhoneCameraState = {
	active: boolean;
	connected: boolean;
	status: PhoneCameraStatus;
	deviceId: string;
	startedAtMs: number | null;
	lastFrameAtMs: number | null;
	message?: string;
	error?: string;
	sessionId?: string;
	pairingCode?: string;
	pairingUrl?: string;
};

export type PhoneCameraFramePayload = {
	frameDataUrl: string;
	width?: number;
	height?: number;
	capturedAtMs?: number;
};

export function isPhoneCameraDeviceId(deviceId?: string | null): boolean {
	return deviceId === PHONE_CAMERA_DEVICE_ID;
}
