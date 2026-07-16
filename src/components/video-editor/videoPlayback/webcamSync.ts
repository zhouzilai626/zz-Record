import { clampMediaTimeToDuration } from "@/lib/mediaTiming";

/**
 * Maps the editor timeline time to the corresponding webcam media timestamp,
 * accounting for any recorded webcam start offset and media duration clamps.
 */
export function getWebcamMediaTargetTimeSeconds({
	currentTime,
	webcamDuration,
	timeOffsetMs,
}: {
	currentTime: number;
	webcamDuration?: number | null;
	timeOffsetMs?: number | null;
}): number {
	const safeOffsetMs = Number.isFinite(timeOffsetMs) ? (timeOffsetMs ?? 0) : 0;
	const shiftedTime = currentTime - safeOffsetMs / 1000;
	return clampMediaTimeToDuration(shiftedTime, webcamDuration);
}

export const getWebcamPreviewTargetTimeSeconds = getWebcamMediaTargetTimeSeconds;

const WEBCAM_BOUNDARY_FRAME_SECONDS = 1 / 60;

export type WebcamPreviewSyncState = {
	targetTime: number;
	shouldPlay: boolean;
	boundary: "before-start" | "active" | "after-end";
};

/**
 * Resolves preview-only webcam boundary behavior. Keeping this separate from
 * getWebcamMediaTargetTimeSeconds preserves exact timestamps for exporters,
 * while the interactive preview freezes on a decodable boundary frame instead
 * of repeatedly replaying an ended media element.
 */
export function getWebcamPreviewSyncState({
	currentTime,
	webcamDuration,
	timeOffsetMs,
}: {
	currentTime: number;
	webcamDuration?: number | null;
	timeOffsetMs?: number | null;
}): WebcamPreviewSyncState {
	const safeOffsetMs = Number.isFinite(timeOffsetMs) ? (timeOffsetMs ?? 0) : 0;
	const shiftedTime = currentTime - safeOffsetMs / 1000;
	const hasDuration = Number.isFinite(webcamDuration) && (webcamDuration ?? 0) > 0;

	if (shiftedTime <= 0) {
		const duration = hasDuration ? (webcamDuration ?? 0) : WEBCAM_BOUNDARY_FRAME_SECONDS;
		return {
			targetTime: Math.min(WEBCAM_BOUNDARY_FRAME_SECONDS, duration),
			shouldPlay: false,
			boundary: "before-start",
		};
	}

	if (hasDuration) {
		const duration = webcamDuration ?? 0;
		const boundaryFrameOffset = Math.min(WEBCAM_BOUNDARY_FRAME_SECONDS, duration / 2);
		const terminalFrameTime = Math.max(0, duration - boundaryFrameOffset);
		if (shiftedTime >= terminalFrameTime) {
			return {
				targetTime: terminalFrameTime,
				shouldPlay: false,
				boundary: "after-end",
			};
		}
	}

	return {
		targetTime: clampMediaTimeToDuration(shiftedTime, webcamDuration),
		shouldPlay: true,
		boundary: "active",
	};
}

/**
 * Decides whether the webcam media element needs a corrective seek for the
 * current preview frame, while avoiding repeated seeks during active media seeks.
 */
export function shouldSeekWebcamMedia({
	desiredTime,
	isPlaying,
	isSeeking,
	previousTimelineTime,
	timelineTime,
	webcamCurrentTime,
}: {
	desiredTime: number;
	isPlaying: boolean;
	isSeeking: boolean;
	previousTimelineTime: number | null;
	timelineTime: number;
	webcamCurrentTime: number;
}): boolean {
	if (isSeeking) {
		return false;
	}

	const timelineJumped =
		previousTimelineTime === null || Math.abs(timelineTime - previousTimelineTime) > 0.25;
	const driftThreshold = isPlaying ? 0.35 : 0.01;

	return timelineJumped || Math.abs(webcamCurrentTime - desiredTime) > driftThreshold;
}
