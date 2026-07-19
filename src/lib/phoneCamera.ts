export const PHONE_CAMERA_DEVICE_ID = "recordly-phone-camera";
export const PHONE_CAMERA_DEVICE_LABEL = "手机摄像头（本机）";

export type PhoneCameraStatus =
  "inactive" | "pending" | "connected" | "error" | "stopped";

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
  /** High-entropy bearer credential kept in memory for the active pairing session. */
  pairingToken?: string;
  pairingExpiresAtMs?: number;
  /** SHA-256 fingerprint of the CA the phone is asked to trust. */
  caFingerprint?: string;
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
