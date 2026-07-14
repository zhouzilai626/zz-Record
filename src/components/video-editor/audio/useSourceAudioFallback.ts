import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { SOURCE_AUDIO_FALLBACK_TOAST_ID } from "@/components/video-editor/audio/audioTypes";

const SIDECAR_DISCOVERY_RETRY_DELAY_MS = 250;
const SIDECAR_DISCOVERY_MAX_RETRIES = 20;

interface UseSourceAudioFallbackParams {
	currentSourcePath: string | null;
	refreshKey?: number;
	summarizeErrorMessage: (message: string) => string;
}

export function useSourceAudioFallback({
	currentSourcePath,
	refreshKey = 0,
	summarizeErrorMessage,
}: UseSourceAudioFallbackParams) {
	const [sourceAudioFallbackPaths, setSourceAudioFallbackPaths] = useState<string[]>([]);
	const [sourceAudioFallbackStartDelayMsByPath, setSourceAudioFallbackStartDelayMsByPath] =
		useState<Record<string, number>>({});
	const previousSourcePathRef = useRef<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		let retryTimeout: number | null = null;
		// Refetch when late recording sidecars are finalized after the editor opens.
		void refreshKey;
		const sourceChanged = previousSourcePathRef.current !== currentSourcePath;
		previousSourcePathRef.current = currentSourcePath;
		if (sourceChanged) {
			setSourceAudioFallbackPaths([]);
			setSourceAudioFallbackStartDelayMsByPath({});
		}

		if (!currentSourcePath) {
			return () => {
				cancelled = true;
			};
		}

		const loadFallbackPaths = async (attempt = 0) => {
			try {
				const result =
					await window.electronAPI.getVideoAudioFallbackPaths(currentSourcePath);
				if (cancelled) {
					return;
				}
				if (!result.success) {
					if (sourceChanged) {
						setSourceAudioFallbackPaths([]);
						setSourceAudioFallbackStartDelayMsByPath({});
					}
					toast.warning(
						result.error
							? `Could not load companion audio sources: ${summarizeErrorMessage(result.error)}`
							: "Could not load companion audio sources. Playback and export may miss microphone audio.",
						{ id: SOURCE_AUDIO_FALLBACK_TOAST_ID, duration: 10000 },
					);
					return;
				}

				toast.dismiss(SOURCE_AUDIO_FALLBACK_TOAST_ID);
				const paths = result.paths ?? [];
				setSourceAudioFallbackPaths(paths);
				setSourceAudioFallbackStartDelayMsByPath(result.startDelayMsByPath ?? {});

				// A fresh recording opens the editor before background sidecars finish
				// writing. In packaged builds the completion event can arrive before
				// this listener is attached, so retry an initially empty lookup briefly.
				if (paths.length === 0 && attempt < SIDECAR_DISCOVERY_MAX_RETRIES) {
					retryTimeout = window.setTimeout(() => {
						void loadFallbackPaths(attempt + 1);
					}, SIDECAR_DISCOVERY_RETRY_DELAY_MS);
				}
			} catch (error) {
				if (!cancelled) {
					if (sourceChanged) {
						setSourceAudioFallbackPaths([]);
						setSourceAudioFallbackStartDelayMsByPath({});
					}
					toast.warning(
						`Could not load companion audio sources: ${summarizeErrorMessage(String(error))}`,
						{ id: SOURCE_AUDIO_FALLBACK_TOAST_ID, duration: 10000 },
					);
				}
			}
		};

		void loadFallbackPaths();

		return () => {
			cancelled = true;
			if (retryTimeout !== null) {
				window.clearTimeout(retryTimeout);
			}
		};
	}, [currentSourcePath, refreshKey, summarizeErrorMessage]);

	return { sourceAudioFallbackPaths, sourceAudioFallbackStartDelayMsByPath };
}
