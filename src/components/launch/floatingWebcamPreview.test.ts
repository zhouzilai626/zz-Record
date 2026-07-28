import { describe, expect, it } from "vitest";

import {
	canShowFloatingWebcamPreview,
	canToggleFloatingWebcamPreview,
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
	it("keeps a selected local camera preview alive after the picker closes and during recording", () => {
		expect(shouldShowExternalLocalWebcamPreview(true, false)).toBe(true);
	});

	it("does not run a local preview for disabled or phone cameras", () => {
		expect(shouldShowExternalLocalWebcamPreview(false, false)).toBe(false);
		expect(shouldShowExternalLocalWebcamPreview(true, true)).toBe(false);
	});
});
