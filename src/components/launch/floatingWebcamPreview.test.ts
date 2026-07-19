import { describe, expect, it } from "vitest";

import {
	canShowFloatingWebcamPreview,
	canToggleFloatingWebcamPreview,
	shouldHideExternalLocalWebcamPreview,
	shouldShowExternalLocalWebcamPreview,
} from "./floatingWebcamPreview";

describe("canShowFloatingWebcamPreview", () => {
	it("keeps the floating preview visible during recording unless the user hides it", () => {
		expect(canShowFloatingWebcamPreview(true)).toBe(true);
		expect(canShowFloatingWebcamPreview(false)).toBe(false);
	});
});

describe("canToggleFloatingWebcamPreview", () => {
	it("keeps the toggle visible while support is unknown or available", () => {
		expect(canToggleFloatingWebcamPreview(null)).toBe(true);
		expect(canToggleFloatingWebcamPreview(true)).toBe(true);
	});

	it("hides the toggle when the platform cannot support the floating preview", () => {
		expect(canToggleFloatingWebcamPreview(false)).toBe(false);
	});
});
describe("shouldShowExternalLocalWebcamPreview", () => {
	it("only keeps a local camera preview in the protected floating window while recording", () => {
		expect(shouldShowExternalLocalWebcamPreview(true, true, false)).toBe(true);
		expect(shouldShowExternalLocalWebcamPreview(false, true, false)).toBe(false);
		expect(shouldShowExternalLocalWebcamPreview(true, false, false)).toBe(false);
		expect(shouldShowExternalLocalWebcamPreview(true, true, true)).toBe(false);
	});
});

describe("shouldHideExternalLocalWebcamPreview", () => {
	it("hides a local camera preview as soon as recording ends, while leaving phone previews alone", () => {
		expect(shouldHideExternalLocalWebcamPreview(true, false)).toBe(true);
		expect(shouldHideExternalLocalWebcamPreview(false, false)).toBe(false);
		expect(shouldHideExternalLocalWebcamPreview(true, true)).toBe(false);
	});
});
