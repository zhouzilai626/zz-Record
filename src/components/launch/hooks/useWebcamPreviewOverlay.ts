import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { isPhoneCameraDeviceId } from "@/lib/phoneCamera";
import { canShowFloatingWebcamPreview } from "../floatingWebcamPreview";

const WEBCAM_PREVIEW_DRAG_THRESHOLD = 6;
const DEFAULT_WEBCAM_PREVIEW_OFFSET = { x: 0, y: 0 };
const PHONE_CAMERA_PREVIEW_FPS = 12;
const PHONE_CAMERA_PREVIEW_POLL_MS = 220;

async function loadImageElement(src: string): Promise<HTMLImageElement> {
	return await new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error("Failed to decode phone camera frame"));
		image.src = src;
	});
}

export function useWebcamPreviewOverlay({
	webcamEnabled,
	webcamDeviceId,
	showWebcamControls,
	webcamPopoverOpen,
	hudOverlayMousePassthroughSupported,
}: {
	webcamEnabled: boolean;
	webcamDeviceId?: string;
	showWebcamControls: boolean;
	webcamPopoverOpen: boolean;
	hudOverlayMousePassthroughSupported: boolean | null;
}) {
	const [showFloatingWebcamPreview, setShowFloatingWebcamPreview] = useState(true);
	const [webcamPreviewOffset, setWebcamPreviewOffset] = useState(DEFAULT_WEBCAM_PREVIEW_OFFSET);
	const webcamPreviewOffsetRef = useRef(DEFAULT_WEBCAM_PREVIEW_OFFSET);
	const webcamPreviewRef = useRef<HTMLVideoElement | null>(null);
	const recordingWebcamPreviewRef = useRef<HTMLVideoElement | null>(null);
	const recordingWebcamPreviewContainerRef = useRef<HTMLDivElement | null>(null);
	const previewStreamRef = useRef<MediaStream | null>(null);
	const phonePreviewCanvasRef = useRef<HTMLCanvasElement | null>(null);
	const phonePreviewPollTimeoutRef = useRef<number | null>(null);
	const phonePreviewInFlightRef = useRef(false);
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
	const showRecordingWebcamPreview =
		webcamEnabled &&
		canShowFloatingWebcamPreview(
			showFloatingWebcamPreview,
			hudOverlayMousePassthroughSupported,
		);
	const shouldStreamWebcamPreview =
		webcamEnabled &&
		(showRecordingWebcamPreview || (showWebcamControls && webcamPopoverOpen));

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
		}
	}, [webcamEnabled]);

	const handleWebcamPreviewPointerDown = useCallback(
		(event: PointerEvent<HTMLDivElement>) => {
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
		},
		[],
	);

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
								const width = frame.width && frame.width > 0 ? frame.width : image.naturalWidth;
								const height =
									frame.height && frame.height > 0 ? frame.height : image.naturalHeight;
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
			phonePreviewCanvasRef.current = null;
		};
	}, [attachPreviewStreamToNode, isPhoneCameraPreview, shouldStreamWebcamPreview, webcamDeviceId]);

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
	};
}
