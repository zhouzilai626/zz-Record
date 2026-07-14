import path from "node:path";

const RECORDING_FILE_NAME_PATTERN = /^recording-\d+(?:-webcam)?\.(?:webm|mov|mp4)$/i;
const RECORDING_VIDEO_EXTENSION_PATTERN = /\.(?:webm|mov|mp4)$/i;

function isPathInsideDirectory(candidatePath: string, directoryPath: string): boolean {
	const relativePath = path.relative(path.resolve(directoryPath), path.resolve(candidatePath));
	return (
		relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
	);
}

export function resolveRecordingOutputPath(
	recordingsDir: string,
	fileName: unknown,
): string | null {
	if (
		typeof fileName !== "string" ||
		path.basename(fileName) !== fileName ||
		!RECORDING_FILE_NAME_PATTERN.test(fileName)
	) {
		return null;
	}

	const outputPath = path.resolve(recordingsDir, fileName);
	return isPathInsideDirectory(outputPath, recordingsDir) ? outputPath : null;
}

export function isRecordingVideoPath(videoPath: string, recordingsDir: string): boolean {
	return (
		RECORDING_VIDEO_EXTENSION_PATTERN.test(videoPath) &&
		isPathInsideDirectory(videoPath, recordingsDir)
	);
}
