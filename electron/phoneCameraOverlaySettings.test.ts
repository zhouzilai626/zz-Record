import { describe, expect, it } from "vitest";

import {
	movePhoneCameraOverlayBounds,
	normalizePhoneCameraOverlaySettings,
	resizePhoneCameraOverlayBounds,
} from "./phoneCameraOverlaySettings";

describe("movePhoneCameraOverlayBounds", () => {
	it("changes only position and preserves the exact window size", () => {
		expect(
			movePhoneCameraOverlayBounds({ x: 100, y: 80, width: 182, height: 182 }, 37.4, -21.6),
		).toEqual({ x: 137, y: 58, width: 182, height: 182 });
	});
});

describe("resizePhoneCameraOverlayBounds", () => {
	const limits = { minSize: 160, maxSize: 640 };

	it("keeps the bottom-right controls under the pointer for button resizing", () => {
		expect(
			resizePhoneCameraOverlayBounds(
				{ x: 100, y: 80, width: 600, height: 600 },
				520,
				limits,
				"bottom-right",
			),
		).toEqual({ x: 180, y: 160, width: 520, height: 520 });
	});

	it("keeps the top-left corner fixed for drag resizing and clamps the size", () => {
		expect(
			resizePhoneCameraOverlayBounds(
				{ x: 100, y: 80, width: 240, height: 240 },
				100,
				limits,
				"top-left",
			),
		).toEqual({ x: 100, y: 80, width: 160, height: 160 });
	});
});

describe("normalizePhoneCameraOverlaySettings", () => {
	const workArea = { x: 0, y: 0, width: 1920, height: 1080 };

	it("keeps a saved preview position and size inside the active display", () => {
		expect(
			normalizePhoneCameraOverlaySettings({ x: 1720, y: 900, size: 320 }, workArea, {
				minSize: 180,
				maxSize: 640,
			}),
		).toEqual({ x: 1600, y: 760, size: 320 });
	});

	it("rejects incomplete or invalid saved settings", () => {
		expect(
			normalizePhoneCameraOverlaySettings({ x: "right", y: 0, size: 240 }, workArea, {
				minSize: 180,
				maxSize: 640,
			}),
		).toBeNull();
	});
});
