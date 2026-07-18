import { randomUUID } from "node:crypto";
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
