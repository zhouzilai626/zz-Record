import { describe, expect, it } from "vitest";

import { getPhoneCameraOverlayHtml } from "./overlayContent";

describe("phone camera overlay controls", () => {
	it("keeps resize controls available while the pointer remains over the preview", () => {
		const html = getPhoneCameraOverlayHtml();

		expect(html).toContain("frame.addEventListener('pointerleave', scheduleControlsHide);");
		expect(html).toContain("shrinkButton.addEventListener('pointerdown', keepControlClick);");
		expect(html).toContain("recoveryButton.addEventListener('click', resetPreviewSize);");
		expect(html).toContain("phoneCameraOverlayResizeBy(-80)");
		expect(html).toContain("phoneCameraOverlayResizeBy(80)");
		expect(html).not.toContain("frame.addEventListener('dblclick'");
		expect(html).toContain("event.stopPropagation();");
	});
});
