import { afterEach, describe, expect, it, vi } from "vitest";

import { normalizeProjectEditor, resolveVideoUrl } from "./projectPersistence";
import { ADVANCED_VERTICAL_PADDING_MAX } from "./types";

describe("normalizeProjectEditor", () => {
	it("preserves the extended advanced vertical padding range", () => {
		const editor = normalizeProjectEditor({
			padding: {
				top: 240,
				bottom: ADVANCED_VERTICAL_PADDING_MAX,
				left: 22,
				right: 22,
				linked: false,
			},
		});

		expect(editor.padding).toMatchObject({
			top: 240,
			bottom: ADVANCED_VERTICAL_PADDING_MAX,
			left: 22,
			right: 22,
			linked: false,
		});
	});

	it("keeps linked padding clamped to the original range", () => {
		const editor = normalizeProjectEditor({
			padding: {
				top: ADVANCED_VERTICAL_PADDING_MAX,
				bottom: ADVANCED_VERTICAL_PADDING_MAX,
				left: ADVANCED_VERTICAL_PADDING_MAX,
				right: ADVANCED_VERTICAL_PADDING_MAX,
				linked: true,
			},
		});

		expect(editor.padding).toMatchObject({
			top: 100,
			bottom: 100,
			left: 100,
			right: 100,
			linked: true,
		});
	});
});

describe("resolveVideoUrl", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("uses the secure local media URL returned by Electron", async () => {
		vi.stubGlobal("window", {
			electronAPI: {
				getLocalMediaUrl: vi.fn(async () => ({
					success: true as const,
					url: "http://127.0.0.1:43123/video?path=approved.mp4",
				})),
			},
		});

		await expect(resolveVideoUrl("C:\\recordings\\approved.mp4")).resolves.toBe(
			"http://127.0.0.1:43123/video?path=approved.mp4",
		);
	});

	it("does not fall back to file URLs when the secure media service fails", async () => {
		vi.stubGlobal("window", {
			electronAPI: {
				getLocalMediaUrl: vi.fn(async () => ({ success: false as const })),
			},
		});

		await expect(resolveVideoUrl("C:\\recordings\\approved.mp4")).rejects.toThrow(
			"secure media service",
		);
	});
});
