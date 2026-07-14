import { describe, expect, it } from "vitest";

import { shouldUseExternalPhoneCameraRecordingPreview } from "./phoneCameraRecordingPreview";

describe("shouldUseExternalPhoneCameraRecordingPreview", () => {
	it("keeps the phone preview in its independent window when HUD mouse passthrough is unavailable", () => {
		expect(shouldUseExternalPhoneCameraRecordingPreview(false)).toBe(true);
		expect(shouldUseExternalPhoneCameraRecordingPreview(true)).toBe(false);
	});
});
