import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

let userDataPath = "";

vi.mock("electron", () => ({
	app: {
		getPath: (name: string) => {
			if (name === "userData" || name === "appData" || name === "temp") {
				return userDataPath;
			}
			return userDataPath;
		},
		getAppPath: () => userDataPath,
		isPackaged: false,
		setPath: () => undefined,
	},
}));

const temporaryDirectories: string[] = [];

afterEach(async () => {
	vi.resetModules();
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) =>
			fs.rm(directory, { recursive: true, force: true }),
		),
	);
});

describe("recordings settings persistence", () => {
	it("serializes concurrent read-merge-write updates without dropping fields", async () => {
		userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-settings-test-"));
		temporaryDirectories.push(userDataPath);
		const { updateRecordingsSettings } = await import("./manager");
		const settingsPath = path.join(userDataPath, "recordings-settings.json");
		await fs.writeFile(settingsPath, JSON.stringify({ existing: true }), "utf8");

		await Promise.all([
			updateRecordingsSettings({ recordingsDir: "C:/recordings" }),
			updateRecordingsSettings({ microphoneDeviceId: "mic-1" }),
			updateRecordingsSettings({ systemAudio: false }),
		]);

		expect(JSON.parse(await fs.readFile(settingsPath, "utf8"))).toEqual({
			existing: true,
			recordingsDir: "C:/recordings",
			microphoneDeviceId: "mic-1",
			systemAudio: false,
		});
	});
});
