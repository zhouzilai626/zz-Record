import { PHONE_CAMERA_DEVICE_ID, type PhoneCameraState } from "../src/lib/phoneCamera";

export function createInactivePhoneCameraState(
	current: Pick<PhoneCameraState, "deviceId">,
): PhoneCameraState {
	return {
		active: false,
		connected: false,
		status: "inactive",
		deviceId: current.deviceId || PHONE_CAMERA_DEVICE_ID,
		startedAtMs: null,
		lastFrameAtMs: null,
		message: "Phone pairing was forgotten. Select Phone Camera to pair again.",
		error: undefined,
		sessionId: undefined,
		pairingCode: undefined,
		pairingUrl: undefined,
	};
}
