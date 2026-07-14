import path from "node:path";
import { fileURLToPath } from "node:url";

export type RendererSecurityContext = {
	devServerUrl?: string | null;
	packagedRendererBaseUrl?: string | null;
	rendererDist: string;
};

const MEDIA_PERMISSIONS = new Set([
	"media",
	"audioCapture",
	"microphone",
	"camera",
	"videoCapture",
]);

function getOrigin(value?: string | null): string | null {
	if (!value) return null;
	try {
		return new URL(value).origin;
	} catch {
		return null;
	}
}

function getPackagedRendererOrigin(value?: string | null): string | null {
	if (!value) return null;
	try {
		const url = new URL(value);
		return url.protocol === "http:" && url.hostname === "127.0.0.1" ? url.origin : null;
	} catch {
		return null;
	}
}

function isPackagedRendererFile(url: URL, rendererDist: string): boolean {
	if (url.protocol !== "file:") return false;
	try {
		return path.resolve(fileURLToPath(url)) === path.resolve(rendererDist, "index.html");
	} catch {
		return false;
	}
}

export function isTrustedRendererUrl(value: string, context: RendererSecurityContext): boolean {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return false;
	}

	const devServerOrigin = getOrigin(context.devServerUrl);
	if (devServerOrigin) {
		return url.origin === devServerOrigin;
	}

	const packagedRendererOrigin = getPackagedRendererOrigin(context.packagedRendererBaseUrl);
	return (
		url.origin === packagedRendererOrigin || isPackagedRendererFile(url, context.rendererDist)
	);
}

export function getRendererWindowType(value: string): string | null {
	try {
		return new URL(value).searchParams.get("windowType");
	} catch {
		return null;
	}
}

export function canRequestMediaPermission(
	value: string,
	permission: string,
	context: RendererSecurityContext,
	isHudOverlayWindow: boolean,
): boolean {
	return (
		isHudOverlayWindow &&
		MEDIA_PERMISSIONS.has(permission) &&
		isTrustedRendererUrl(value, context) &&
		getRendererWindowType(value) === "hud-overlay"
	);
}
