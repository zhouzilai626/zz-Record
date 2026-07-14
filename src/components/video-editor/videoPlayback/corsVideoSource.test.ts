import { describe, expect, it } from "vitest";
import { loadCorsVideoSource } from "./corsVideoSource";

describe("loadCorsVideoSource", () => {
	it("sets anonymous CORS before starting the media request", () => {
		const operations: string[] = [];
		const target = {
			set crossOrigin(value: string | null) {
				operations.push(`cors:${value}`);
			},
			get crossOrigin() {
				return null;
			},
			set src(value: string) {
				operations.push(`src:${value}`);
			},
			get src() {
				return "";
			},
			load() {
				operations.push("load");
			},
		};

		loadCorsVideoSource(target, "http://127.0.0.1:43123/video?path=recording.mp4");

		expect(operations).toEqual([
			"cors:anonymous",
			"src:http://127.0.0.1:43123/video?path=recording.mp4",
			"load",
		]);
	});
});
