import path from "node:path";
import { describe, expect, it } from "vitest";
import { isRecordingVideoPath, resolveRecordingOutputPath } from "./outputPaths";

const recordingsDir = path.join("C:", "Recordly", "recordings");

describe("recording output paths", () => {
	it("accepts a generated recording filename inside the recordings directory", () => {
		expect(resolveRecordingOutputPath(recordingsDir, "recording-1720000000000.webm")).toBe(
			path.join(recordingsDir, "recording-1720000000000.webm"),
		);
		expect(
			resolveRecordingOutputPath(recordingsDir, "recording-1720000000000-webcam.webm"),
		).toBe(path.join(recordingsDir, "recording-1720000000000-webcam.webm"));
	});

	it.each([
		"..\\settings.json",
		"recording-1.exe",
		"capture.mp4",
		"/tmp/recording-1.mp4",
	])("rejects an unsafe recording filename: %s", (fileName) => {
		expect(resolveRecordingOutputPath(recordingsDir, fileName)).toBeNull();
	});

	it("only accepts video sources inside the recordings directory for microphone sidecars", () => {
		expect(isRecordingVideoPath(path.join(recordingsDir, "capture.mp4"), recordingsDir)).toBe(
			true,
		);
		expect(isRecordingVideoPath(path.join("C:", "outside", "capture.mp4"), recordingsDir)).toBe(
			false,
		);
		expect(isRecordingVideoPath(path.join(recordingsDir, "capture.wav"), recordingsDir)).toBe(
			false,
		);
	});
});
