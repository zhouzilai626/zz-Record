import { describe, expect, it } from "vitest";

import { getVideoDeviceDisplayLabel } from "./useVideoDevices";

describe("getVideoDeviceDisplayLabel", () => {
	it("uses Chinese labels for common built-in and virtual cameras", () => {
		expect(getVideoDeviceDisplayLabel("HD User Facing (04f2:b64f)", 0)).toBe("内置摄像头");
		expect(getVideoDeviceDisplayLabel("OBS Virtual Camera", 1)).toBe("OBS 虚拟摄像头");
	});

	it("uses a Chinese fallback when the system has not exposed a device label", () => {
		expect(getVideoDeviceDisplayLabel("", 1)).toBe("摄像头 2");
	});
});
