import { describe, expect, it } from "vitest";

import {
	createInactivePhoneCameraState,
	shouldShowPhoneCameraPairing,
} from "./phoneCameraSessionState";

describe("shouldShowPhoneCameraPairing", () => {
	it("only opens pairing after an explicit phone camera selection", () => {
		expect(shouldShowPhoneCameraPairing("selection", false)).toBe(true);
		expect(shouldShowPhoneCameraPairing("selection", true)).toBe(false);
		expect(shouldShowPhoneCameraPairing("reconnect", false)).toBe(false);
		expect(shouldShowPhoneCameraPairing(undefined, false)).toBe(false);
	});
});

describe("createInactivePhoneCameraState", () => {
	it("clears the active pairing fields so the next phone selection starts a new pairing", () => {
		expect(
			createInactivePhoneCameraState({
				active: true,
				connected: true,
				status: "connected",
				deviceId: "recordly-phone-camera",
				startedAtMs: 1,
				lastFrameAtMs: 2,
				sessionId: "old-session",
				pairingCode: "ABC123",
				pairingUrl: "https://example.test/phone-camera",
			}),
		).toEqual({
			active: false,
			connected: false,
			status: "inactive",
			deviceId: "recordly-phone-camera",
			startedAtMs: null,
			lastFrameAtMs: null,
			message: "Phone pairing was forgotten. Select Phone Camera to pair again.",
			error: undefined,
			sessionId: undefined,
			pairingCode: undefined,
			pairingUrl: undefined,
		});
	});
});
