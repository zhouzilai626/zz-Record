import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { atomicWriteFile } from "./atomicFile";

const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-atomic-write-test-"));
	temporaryDirectories.push(directory);
	return directory;
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
	);
});

describe("atomicWriteFile", () => {
	it("replaces an existing file with complete new content", async () => {
		const directory = await createTemporaryDirectory();
		const targetPath = path.join(directory, "project.recordly");
		await fs.writeFile(targetPath, '{"version":1}', "utf8");

		await atomicWriteFile(targetPath, '{"version":2,"projectId":"next"}');

		await expect(fs.readFile(targetPath, "utf8")).resolves.toBe(
			'{"version":2,"projectId":"next"}',
		);
		const files = await fs.readdir(directory);
		expect(files).toEqual(["project.recordly"]);
	});

	it("writes binary data through the same staged replacement path", async () => {
		const directory = await createTemporaryDirectory();
		const targetPath = path.join(directory, "project.recordly");
		await fs.writeFile(targetPath, "last-known-good", "utf8");

		await atomicWriteFile(targetPath, new Uint8Array([1, 2, 3]));
		await expect(fs.readFile(targetPath)).resolves.toEqual(Buffer.from([1, 2, 3]));
	});

	it("keeps the prior file intact and removes staging data when staging fails", async () => {
		const directory = await createTemporaryDirectory();
		const targetPath = path.join(directory, "project.recordly");
		await fs.writeFile(targetPath, "last-known-good", "utf8");
		const openSpy = vi.spyOn(fs, "open").mockRejectedValueOnce(new Error("disk full"));

		await expect(atomicWriteFile(targetPath, "next-version")).rejects.toThrow("disk full");
		expect(await fs.readFile(targetPath, "utf8")).toBe("last-known-good");
		expect((await fs.readdir(directory)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
		openSpy.mockRestore();
	});

	it("keeps the prior file intact and removes staging data when commit fails", async () => {
		const directory = await createTemporaryDirectory();
		const targetPath = path.join(directory, "project.recordly");
		await fs.writeFile(targetPath, "last-known-good", "utf8");
		const renameSpy = vi.spyOn(fs, "rename").mockRejectedValueOnce(new Error("rename failed"));

		await expect(atomicWriteFile(targetPath, "next-version")).rejects.toThrow("rename failed");
		expect(await fs.readFile(targetPath, "utf8")).toBe("last-known-good");
		expect((await fs.readdir(directory)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
		renameSpy.mockRestore();
	});
});
