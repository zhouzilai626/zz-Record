export type PhoneCameraOverlaySettings = {
	x: number;
	y: number;
	size: number;
};

type WorkArea = {
	x: number;
	y: number;
	width: number;
	height: number;
};

type SquareBounds = {
	x: number;
	y: number;
	width: number;
	height: number;
};

export function movePhoneCameraOverlayBounds(
	bounds: SquareBounds,
	deltaX: number,
	deltaY: number,
): SquareBounds {
	return {
		x: Math.round(bounds.x + deltaX),
		y: Math.round(bounds.y + deltaY),
		width: bounds.width,
		height: bounds.height,
	};
}

export function resizePhoneCameraOverlayBounds(
	bounds: SquareBounds,
	requestedSize: number,
	limits: { minSize: number; maxSize: number },
	anchor: "top-left" | "bottom-right",
): SquareBounds {
	const size = Math.round(Math.min(Math.max(requestedSize, limits.minSize), limits.maxSize));
	return {
		x: anchor === "bottom-right" ? bounds.x + bounds.width - size : bounds.x,
		y: anchor === "bottom-right" ? bounds.y + bounds.height - size : bounds.y,
		width: size,
		height: size,
	};
}

export function normalizePhoneCameraOverlaySettings(
	value: unknown,
	workArea: WorkArea,
	limits: { minSize: number; maxSize: number },
): PhoneCameraOverlaySettings | null {
	if (!value || typeof value !== "object") {
		return null;
	}

	const candidate = value as Partial<PhoneCameraOverlaySettings>;
	const { x, y, size: requestedSize } = candidate;
	if (
		typeof x !== "number" ||
		typeof y !== "number" ||
		typeof requestedSize !== "number" ||
		!Number.isFinite(x) ||
		!Number.isFinite(y) ||
		!Number.isFinite(requestedSize)
	) {
		return null;
	}

	const size = Math.round(Math.min(Math.max(requestedSize, limits.minSize), limits.maxSize));
	return {
		x: Math.round(Math.min(Math.max(x, workArea.x), workArea.x + workArea.width - size)),
		y: Math.round(Math.min(Math.max(y, workArea.y), workArea.y + workArea.height - size)),
		size,
	};
}
