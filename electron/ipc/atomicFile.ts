import { randomUUID } from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Replaces a file only after a fully-written sibling temporary file is durable.
 * Keeping both paths in the same directory lets rename provide an atomic commit.
 */
export async function atomicWriteFile(
	targetPath: string,
	data: string | Uint8Array,
): Promise<void> {
	const resolvedTargetPath = path.resolve(targetPath);
	const directory = path.dirname(resolvedTargetPath);
	const temporaryPath = path.join(
		directory,
		`.${path.basename(resolvedTargetPath)}.${randomUUID()}.tmp`,
	);
	let committed = false;

	await fs.mkdir(directory, { recursive: true });
	try {
		const handle = await fs.open(temporaryPath, "wx");
		try {
			await handle.writeFile(data);
			await handle.sync();
		} finally {
			await handle.close();
		}

		await fs.rename(temporaryPath, resolvedTargetPath);
		committed = true;
	} finally {
		if (!committed) {
			await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
		}
	}
}

/**
 * Synchronous variant for callers on synchronous IPC paths (event.returnValue),
 * with the same staged temp file + fsync + atomic rename guarantees.
 */
export function atomicWriteFileSync(
	targetPath: string,
	data: string | Uint8Array,
): void {
	const resolvedTargetPath = path.resolve(targetPath);
	const directory = path.dirname(resolvedTargetPath);
	const temporaryPath = path.join(
		directory,
		`.${path.basename(resolvedTargetPath)}.${randomUUID()}.tmp`,
	);
	let committed = false;

	fsSync.mkdirSync(directory, { recursive: true });
	try {
		const handle = fsSync.openSync(temporaryPath, "wx");
		try {
			fsSync.writeFileSync(handle, data);
			fsSync.fsyncSync(handle);
		} finally {
			fsSync.closeSync(handle);
		}

		fsSync.renameSync(temporaryPath, resolvedTargetPath);
		committed = true;
	} finally {
		if (!committed) {
			try {
				fsSync.rmSync(temporaryPath, { force: true });
			} catch {
				// Keep the original error from the write path.
			}
		}
	}
}
