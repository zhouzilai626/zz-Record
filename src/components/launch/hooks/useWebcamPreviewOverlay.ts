import { type PointerEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { isPhoneCameraDeviceId } from "@/lib/phoneCamera";
import {
	shouldHideExternalLocalWebcamPreview,
	shouldShowExternalLocalWebcamPreview,
} from "../floatingWebcamPreview";

const WEBCAM_PREVIEW_DRAG_THRESHOLD = 6;
const DEFAULT_WEBCAM_PREVIEW_OFFSET = { x: 0, y: 0 };
const DEFAULT_WEBCAM_PREVIEW_SIZE = 288;
const MIN_WEBCAM_PREVIEW_SIZE = 144;
const MAX_WEBCAM_PREVIEW_SIZE = 480;
const PHONE_CAMERA_PREVIEW_FPS = 12;
const PHONE_CAMERA_PREVIEW_POLL_MS = 220;
const LOCAL_CAMERA_OVERLAY_PREVIEW_FPS = 12;
const LOCAL_CAMERA_OVERLAY_PREVIEW_POLL_MS = 84;

async function loadImageElement(src: string): Promise<HTMLImageElement> {
	return await new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error("Failed to decode phone camera frame"));
		image.src = src;
	});
}

export function useWebcamPreviewOverlay({
	recording,
	webcamEnabled,
	webcamDeviceId,
	showWebcamControls,
	webcamPopoverOpen,
}: {
	recording: boolean;
	webcamEnabled: boolean;
	webcamDeviceId?: string;
	showWebcamControls: boolean;
	webcamPopoverOpen: boolean;
}) {
	const [showFloatingWebcamPreview, setShowFloatingWebcamPreview] = useState(true);
	const [webcamPreviewOffset, setWebcamPreviewOffset] = useState(DEFAULT_WEBCAM_PREVIEW_OFFSET);
	const [webcamPreviewSize, setWebcamPreviewSize] = useState(DEFAULT_WEBCAM_PREVIEW_SIZE);
	const webcamPreviewOffsetRef = useRef(DEFAULT_WEBCAM_PREVIEW_OFFSET);
	const webcamPreviewRef = useRef<HTMLVideoElement | null>(null);
	const recordingWebcamPreviewRef = useRef<HTMLVideoElement | null>(null);
	const recordingWebcamPreviewContainerRef = useRef<HTMLDivElement | null>(null);
	const previewStreamRef = useRef<MediaStream | null>(null);
	const phonePreviewCanvasRef = useRef<HTMLCanvasElement | null>(null);
	const phonePreviewPollTimeoutRef = useRef<number | null>(null);
	const phonePreviewInFlightRef = useRef(false);
	const localOverlayVideoRef = useRef<HTMLVideoElement | null>(null);
	const localOverlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
	const localOverlayPollTimeoutRef = useRef<number | null>(null);
	const previewDragMoveRafRef = useRef<number | null>(null);
	const previewDragPendingPointerRef = useRef<{ clientX: number; clientY: number } | null>(null);
	const webcamPreviewDragStartRef = useRef<{
		pointerId: number;
		startX: number;
		startY: number;
		originX: number;
		originY: number;
		initialLeft: number;
		initialTop: number;
		previewWidth: number;
		previewHeight: number;
		dragging: boolean;
	} | null>(null);
	const isWebcamPreviewDraggingRef = useRef(false);
	const isPhoneCameraPreview = webcamEnabled && isPhoneCameraDeviceId(webcamDeviceId);

	// The editor can open before this renderer's normal effect cleanup runs. Hide the
	// protected native preview synchronously as recording ends so it never overlaps
	// the editor's saved webcam layer during the first rendered second.
	useLayoutEffect(() => {
		if (recording || !shouldHideExternalLocalWebcamPreview(webcamEnabled, isPhoneCameraPreview)) {
			return;
		}
		void window.electronAPI.cameraOverlayHideLocal();
	}, [isPhoneCameraPreview, recording, webcamEnabled]);

	const adjustWebcamPreviewSize = useCallback((delta: number) => {
		setWebcamPreviewSize((current) =>
			Math.max(MIN_WEBCAM_PREVIEW_SIZE, Math.min(MAX_WEBCAM_PREVIEW_SIZE, current + delta)),
		);
	}, []);
	const resetWebcamPreviewSize = useCallback(() => {
		setWebcamPreviewSize(DEFAULT_WEBCAM_PREVIEW_SIZE);
	}, []);
	// Keep recording previews in a protected native window. Rendering one inside the
	// HUD can make it part of the captured display and duplicate the saved webcam layer.
	const showRecordingWebcamPreview = false;
	const shouldStreamWebcamPreview =
		webcamEnabled &&
		(showRecordingWebcamPreview ||
			(showWebcamControls && webcamPopoverOpen) ||
			shouldShowExternalLocalWebcamPreview(
					recording,
					webcamEnabled,
					isPhoneCameraPreview,
				));

	useEffect(() => {
		if (!webcamEnabled) {
			webcamPreviewOffsetRef.current = DEFAULT_WEBCAM_PREVIEW_OFFSET;
			setWebcamPreviewOffset(DEFAULT_WEBCAM_PREVIEW_OFFSET);
			if (recordingWebcamPreviewContainerRef.current) {
				recordingWebcamPreviewContainerRef.current.style.transform = "translate(0px, 0px)";
			}
			webcamPreviewDragStartRef.current = null;
			isWebcamPreviewDraggingRef.current = false;
			setShowFloatingWebcamPreview(true);
			setWebcamPreviewSize(DEFAULT_WEBCAM_PREVIEW_SIZE);
		}
	}, [webcamEnabled]);

	const handleWebcamPreviewPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
		if (event.button !== 0) {
			return;
		}

		const previewRect = event.currentTarget.getBoundingClientRect();

		event.preventDefault();
		window.electronAPI?.hudOverlaySetIgnoreMouse?.(false);
		webcamPreviewDragStartRef.current = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			originX: webcamPreviewOffsetRef.current.x,
			originY: webcamPreviewOffsetRef.current.y,
			initialLeft: previewRect.left,
			initialTop: previewRect.top,
			previewWidth: previewRect.width,
			previewHeight: previewRect.height,
			dragging: false,
		};
		event.currentTarget.setPointerCapture(event.pointerId);
	}, []);

	const handleWebcamPreviewPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
		const dragState = webcamPreviewDragStartRef.current;
		if (!dragState || dragState.pointerId !== event.pointerId) {
			return;
		}

		const deltaX = event.clientX - dragState.startX;
		const deltaY = event.clientY - dragState.startY;

		if (!dragState.dragging && Math.hypot(deltaX, deltaY) < WEBCAM_PREVIEW_DRAG_THRESHOLD) {
			return;
		}

		if (!dragState.dragging) {
			dragState.dragging = true;
			isWebcamPreviewDraggingRef.current = true;
		}

		previewDragPendingPointerRef.current = { clientX: event.clientX, clientY: event.clientY };
		if (previewDragMoveRafRef.current !== null) {
			return;
		}

		previewDragMoveRafRef.current = requestAnimationFrame(() => {
			previewDragMoveRafRef.current = null;
			const latestDragState = webcamPreviewDragStartRef.current;
			const pointer = previewDragPendingPointerRef.current;
			if (!latestDragState || !pointer) {
				return;
			}

			const latestDeltaX = pointer.clientX - latestDragState.startX;
			const latestDeltaY = pointer.clientY - latestDragState.startY;
			const viewportWidth = Math.max(window.innerWidth, window.screen?.width ?? 0);
			const viewportHeight = Math.max(window.innerHeight, window.screen?.height ?? 0);
			const unclampedLeft = latestDragState.initialLeft + latestDeltaX;
			const unclampedTop = latestDragState.initialTop + latestDeltaY;
			const clampedLeft = Math.min(
				Math.max(0, unclampedLeft),
				Math.max(0, viewportWidth - latestDragState.previewWidth),
			);
			const clampedTop = Math.min(
				Math.max(0, unclampedTop),
				Math.max(0, viewportHeight - latestDragState.previewHeight),
			);

			const nextOffset = {
				x: latestDragState.originX + (clampedLeft - latestDragState.initialLeft),
				y: latestDragState.originY + (clampedTop - latestDragState.initialTop),
			};
			webcamPreviewOffsetRef.current = nextOffset;
			if (recordingWebcamPreviewContainerRef.current) {
				recordingWebcamPreviewContainerRef.current.style.transform = `translate(${nextOffset.x}px, ${nextOffset.y}px)`;
			}
		});
	}, []);

	const handleWebcamPreviewPointerUp = useCallback((event: PointerEvent<HTMLDivElement>) => {
		const dragState = webcamPreviewDragStartRef.current;
		if (!dragState || dragState.pointerId !== event.pointerId) {
			return;
		}
		if (previewDragMoveRafRef.current !== null) {
			cancelAnimationFrame(previewDragMoveRafRef.current);
			previewDragMoveRafRef.current = null;
		}
		previewDragPendingPointerRef.current = null;

		const wasDragging = dragState.dragging;
		webcamPreviewDragStartRef.current = null;
		isWebcamPreviewDraggingRef.current = false;
		setWebcamPreviewOffset({ ...webcamPreviewOffsetRef.current });
		if (event.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
		if (wasDragging) {
			window.electronAPI?.hudOverlaySetIgnoreMouse?.(true);
		}
	}, []);

	const attachPreviewStreamToNode = useCallback((videoElement: HTMLVideoElement | null) => {
		const previewStream = previewStreamRef.current;
		if (!videoElement || !previewStream || videoElement.srcObject === previewStream) {
			return;
		}

		videoElement.srcObject = previewStream;
		const playPromise = videoElement.play();
		if (playPromise) {
			playPromise.catch(() => {
				// Ignore autoplay interruptions while the preview element mounts.
			});
		}
	}, []);

	const setWebcamPreviewNode = useCallback(
		(node: HTMLVideoElement | null) => {
			webcamPreviewRef.current = node;
			attachPreviewStreamToNode(node);
		},
		[attachPreviewStreamToNode],
	);

	const setRecordingWebcamPreviewNode = useCallback(
		(node: HTMLVideoElement | null) => {
			recordingWebcamPreviewRef.current = node;
			attachPreviewStreamToNode(node);
		},
		[attachPreviewStreamToNode],
	);

	useEffect(() => {
		return () => {
			if (phonePreviewPollTimeoutRef.current !== null) {
				window.clearTimeout(phonePreviewPollTimeoutRef.current);
			}
			phonePreviewPollTimeoutRef.current = null;
			phonePreviewInFlightRef.current = false;
			if (previewDragMoveRafRef.current !== null) {
				cancelAnimationFrame(previewDragMoveRafRef.current);
			}
			previewDragMoveRafRef.current = null;
			previewDragPendingPointerRef.current = null;
		};
	}, []);

	useEffect(() => {
		let mounted = true;

		const startPreview = async () => {
			if (!shouldStreamWebcamPreview) {
				return;
			}

			try {
				if (isPhoneCameraPreview) {
					const canvas = document.createElement("canvas");
					canvas.width = 320;
					canvas.height = 320;
					phonePreviewCanvasRef.current = canvas;
					const previewStream = canvas.captureStream(PHONE_CAMERA_PREVIEW_FPS);
					previewStreamRef.current = previewStream;
					attachPreviewStreamToNode(webcamPreviewRef.current);
					attachPreviewStreamToNode(recordingWebcamPreviewRef.current);

					const context = canvas.getContext("2d");
					if (!context) {
						throw new Error("Failed to create phone camera preview canvas");
					}

					const pollFrame = async () => {
						if (!mounted) {
							return;
						}
						if (phonePreviewInFlightRef.current) {
							phonePreviewPollTimeoutRef.current = window.setTimeout(
								() => void pollFrame(),
								PHONE_CAMERA_PREVIEW_POLL_MS,
							);
							return;
						}

						phonePreviewInFlightRef.current = true;
						try {
							const frame = await window.electronAPI.phoneCameraGetFrame();
							if (frame.success && frame.frameDataUrl) {
								const image = await loadImageElement(frame.frameDataUrl);
								const width =
									frame.width && frame.width > 0
										? frame.width
										: image.naturalWidth;
								const height =
									frame.height && frame.height > 0
										? frame.height
										: image.naturalHeight;
								if (width > 0 && height > 0) {
									if (canvas.width !== width || canvas.height !== height) {
										canvas.width = width;
										canvas.height = height;
									}
									context.clearRect(0, 0, canvas.width, canvas.height);
									context.drawImage(image, 0, 0, canvas.width, canvas.height);
								}
							}
						} catch (error) {
							console.warn("Failed to refresh phone camera preview:", error);
						} finally {
							phonePreviewInFlightRef.current = false;
							if (mounted) {
								phonePreviewPollTimeoutRef.current = window.setTimeout(
									() => void pollFrame(),
									PHONE_CAMERA_PREVIEW_POLL_MS,
								);
							}
						}
					};

					void pollFrame();
					return;
				}

				const previewStream = await navigator.mediaDevices.getUserMedia({
					video: webcamDeviceId
						? {
								deviceId: { exact: webcamDeviceId },
								width: { ideal: 320 },
								height: { ideal: 320 },
								frameRate: { ideal: 24, max: 30 },
							}
						: {
								width: { ideal: 320 },
								height: { ideal: 320 },
								frameRate: { ideal: 24, max: 30 },
							},
					audio: false,
				});

				if (!mounted) {
					previewStream.getTracks().forEach((track) => track.stop());
					return;
				}

				previewStreamRef.current = previewStream;
				attachPreviewStreamToNode(webcamPreviewRef.current);
				attachPreviewStreamToNode(recordingWebcamPreviewRef.current);

				void window.electronAPI
					.cameraOverlayShowLocal({ excludeFromCapture: recording })
					.catch((error) => {
						console.warn("Failed to show local camera overlay:", error);
					});
				const overlayVideo = document.createElement("video");
				overlayVideo.muted = true;
				overlayVideo.playsInline = true;
				overlayVideo.srcObject = previewStream;
				localOverlayVideoRef.current = overlayVideo;
				const overlayCanvas = document.createElement("canvas");
				localOverlayCanvasRef.current = overlayCanvas;
				const overlayContext = overlayCanvas.getContext("2d");
				if (!overlayContext) {
					throw new Error("Failed to create local camera overlay canvas");
				}
				void overlayVideo.play().catch(() => {
					// The visible preview remains available even if the background sender is interrupted.
				});

				const forwardLocalOverlayFrame = () => {
					if (!mounted || localOverlayVideoRef.current !== overlayVideo) {
						return;
					}
					const width = overlayVideo.videoWidth;
					const height = overlayVideo.videoHeight;
					if (width > 0 && height > 0) {
						if (overlayCanvas.width !== width || overlayCanvas.height !== height) {
							overlayCanvas.width = width;
							overlayCanvas.height = height;
						}
						overlayContext.drawImage(overlayVideo, 0, 0, width, height);
						window.electronAPI.cameraOverlaySendLocalFrame({
							frameDataUrl: overlayCanvas.toDataURL("image/jpeg", 0.72),
							width,
							height,
						});
					}
					localOverlayPollTimeoutRef.current = window.setTimeout(
						forwardLocalOverlayFrame,
						LOCAL_CAMERA_OVERLAY_PREVIEW_POLL_MS,
					);
				};
				localOverlayPollTimeoutRef.current = window.setTimeout(
					forwardLocalOverlayFrame,
					Math.round(1000 / LOCAL_CAMERA_OVERLAY_PREVIEW_FPS),
				);
			} catch (error) {
				console.warn("Failed to start live webcam preview:", error);
			}
		};

		void startPreview();

		return () => {
			mounted = false;
			if (phonePreviewPollTimeoutRef.current !== null) {
				window.clearTimeout(phonePreviewPollTimeoutRef.current);
			}
			phonePreviewPollTimeoutRef.current = null;
			phonePreviewInFlightRef.current = false;
			const previewNode = webcamPreviewRef.current;
			const recordingPreviewNode = recordingWebcamPreviewRef.current;
			const previewStream = previewStreamRef.current;

			[previewNode, recordingPreviewNode]
				.filter((node): node is HTMLVideoElement => Boolean(node))
				.forEach((videoElement) => {
					videoElement.pause();
					videoElement.srcObject = null;
				});
			previewStream?.getTracks().forEach((track) => track.stop());
			if (previewStreamRef.current === previewStream) {
				previewStreamRef.current = null;
			}
			if (localOverlayPollTimeoutRef.current !== null) {
				window.clearTimeout(localOverlayPollTimeoutRef.current);
			}
			localOverlayPollTimeoutRef.current = null;
			if (localOverlayVideoRef.current) {
				localOverlayVideoRef.current.pause();
				localOverlayVideoRef.current.srcObject = null;
			}
			localOverlayVideoRef.current = null;
			localOverlayCanvasRef.current = null;
			if (!isPhoneCameraPreview) {
				void window.electronAPI.cameraOverlayHideLocal();
			}
			phonePreviewCanvasRef.current = null;
		};
	}, [
		attachPreviewStreamToNode,
		isPhoneCameraPreview,
		recording,
		shouldStreamWebcamPreview,
		webcamDeviceId,
	]);

	return {
		showFloatingWebcamPreview,
		setShowFloatingWebcamPreview,
		webcamPreviewOffset,
		recordingWebcamPreviewContainerRef,
		isWebcamPreviewDraggingRef,
		webcamPreviewDragStartRef,
		handleWebcamPreviewPointerDown,
		handleWebcamPreviewPointerMove,
		handleWebcamPreviewPointerUp,
		setWebcamPreviewNode,
		setRecordingWebcamPreviewNode,
		showRecordingWebcamPreview,
		webcamPreviewSize,
		adjustWebcamPreviewSize,
		resetWebcamPreviewSize,
	};
}
