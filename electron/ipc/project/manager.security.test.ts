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

describe("approved local read paths", () => {
	it("rejects arbitrary files until the user-approved capability is recorded", async () => {
		userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-read-policy-test-"));
		temporaryDirectories.push(userDataPath);
		const externalDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-unapproved-test-"));
		temporaryDirectories.push(externalDirectory);
		const externalFile = path.join(externalDirectory, "private.txt");
		await fs.writeFile(externalFile, "private", "utf8");

		const { isAllowedLocalReadPath, rememberApprovedLocalReadPath } = await import("./manager");
		expect(isAllowedLocalReadPath(externalFile)).toBe(false);

		await rememberApprovedLocalReadPath(externalFile);
		expect(isAllowedLocalReadPath(externalFile)).toBe(true);
	});

	it("rejects a symlink under app data when its target is not allowed", async () => {
		userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-symlink-policy-test-"));
		temporaryDirectories.push(userDataPath);
		const externalDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-symlink-target-test-"));
		temporaryDirectories.push(externalDirectory);
		const externalFile = path.join(externalDirectory, "private.txt");
		const linkPath = path.join(userDataPath, "recordings", "linked-private.txt");
		await fs.writeFile(externalFile, "private", "utf8");
		await fs.mkdir(path.dirname(linkPath), { recursive: true });
		await fs.symlink(externalFile, linkPath);

		const { isAllowedLocalReadPath } = await import("./manager");
		expect(isAllowedLocalReadPath(linkPath)).toBe(false);
	});
});
