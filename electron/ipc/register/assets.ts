import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ipcMain } from "electron";
import { USER_DATA_PATH } from "../../appPaths";
import { getAssetRootPath, isAllowedLocalReadPath } from "../project/manager";
import { normalizePath } from "../utils";
import type { IpcCallerPolicy } from "../handlers";

const EDITOR_WINDOW_TYPES = ["editor"] as const;

export function registerAssetHandlers(callerPolicy?: IpcCallerPolicy) {
	const isEditorCaller = (event: Electron.IpcMainInvokeEvent) =>
		!callerPolicy || callerPolicy.allows(event, EDITOR_WINDOW_TYPES);

	async function resolveReadableLocalFilePath(filePath: string) {
		const normalizedPath = normalizePath(filePath);
		const resolvedPath = await fs.realpath(normalizedPath).catch(() => normalizedPath);
		const stats = await fs.stat(resolvedPath);
		if (!stats.isFile()) {
			throw new Error("Path is not a readable file");
		}
		return normalizePath(resolvedPath);
	}

	// Generate a tiny thumbnail for a wallpaper image and cache it in userData.
	// Returns the cached thumbnail as raw JPEG bytes for fast grid rendering.
	// Serialized to prevent concurrent nativeImage operations from eating memory.
	const THUMB_SIZE = 96;
	const thumbCacheDir = path.join(USER_DATA_PATH, "wallpaper-thumbs");
	let thumbGenerationQueue: Promise<void> = Promise.resolve();

	ipcMain.handle("generate-wallpaper-thumbnail", async (event, filePath: string) => {
		if (!isEditorCaller(event)) {
			return { success: false, error: "Unauthorized IPC caller" };
		}
		try {
			const resolved = await resolveReadableLocalFilePath(filePath);
			if (!isAllowedLocalReadPath(resolved)) {
				throw new Error("Local file path has not been approved for this session");
			}

			const stat = await fs.stat(resolved);
			const cacheKey = Buffer.from(`${resolved}:${stat.mtimeMs}`).toString("base64url");
			const thumbPath = path.join(thumbCacheDir, `${cacheKey}.jpg`);
			if (existsSync(thumbPath)) {
				return { success: true, data: await fs.readFile(thumbPath) };
			}

			let jpegData: Buffer;
			const generation = thumbGenerationQueue.then(async () => {
				const { nativeImage } = await import("electron");
				const img = nativeImage.createFromPath(resolved);
				if (img.isEmpty()) throw new Error("Failed to load image");
				const { width, height } = img.getSize();
				const scale = THUMB_SIZE / Math.min(width, height);
				jpegData = img.resize({
					width: Math.round(width * scale),
					height: Math.round(height * scale),
					quality: "good",
				}).toJPEG(70);
				await fs.mkdir(thumbCacheDir, { recursive: true });
				await fs.writeFile(thumbPath, jpegData);
			});
			thumbGenerationQueue = generation.catch(() => undefined);
			await generation;
			return { success: true, data: jpegData! };
		} catch (error) {
			return { success: false, error: String(error) };
		}
	});

	ipcMain.handle("get-asset-base-path", (event) => {
		if (!isEditorCaller(event)) return null;
		try {
			const assetPath = getAssetRootPath();
			return pathToFileURL(`${assetPath}${path.sep}`).toString();
		} catch (err) {
			console.error("Failed to resolve asset base path:", err);
			return null;
		}
	});

	ipcMain.handle("list-asset-directory", async (event, relativeDir: string) => {
		if (!isEditorCaller(event)) {
			return { success: false, error: "Unauthorized IPC caller" };
		}
		try {
			const normalizedRelativeDir = String(relativeDir ?? "")
				.replace(/\\/g, "/")
				.replace(/^\/+/, "");
			const assetRootPath = path.resolve(getAssetRootPath());
			const targetDirPath = path.resolve(assetRootPath, normalizedRelativeDir);
			if (
				targetDirPath !== assetRootPath &&
				!targetDirPath.startsWith(`${assetRootPath}${path.sep}`)
			) {
				return { success: false, error: "Invalid asset directory" };
			}
			const entries = await fs.readdir(targetDirPath, { withFileTypes: true });
			return {
				success: true,
				files: entries.filter((entry) => entry.isFile()).map((entry) => entry.name)
					.sort(new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare),
			};
		} catch (error) {
			console.error("Failed to list asset directory:", error);
			return { success: false, error: String(error) };
		}
	});

	ipcMain.handle("read-local-file", async (event, filePath: string) => {
		if (!isEditorCaller(event)) {
			return { success: false, error: "Unauthorized IPC caller" };
		}
		try {
			if (typeof filePath !== "string" || !filePath.trim()) {
				throw new Error("A readable local file path is required");
			}
			const resolved = await resolveReadableLocalFilePath(filePath);
			if (!isAllowedLocalReadPath(resolved)) {
				throw new Error("Local file path has not been approved for this session");
			}
			return { success: true, data: await fs.readFile(resolved) };
		} catch (error) {
			console.error("Failed to read local file:", error);
			return { success: false, error: String(error) };
		}
	});
}
