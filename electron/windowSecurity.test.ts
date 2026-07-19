import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
	canRequestMediaPermission,
	getRendererWindowType,
	isTrustedIpcSenderForWindowTypes,
	isTrustedRendererUrl,
} from "./windowSecurity";

const developmentContext = {
	devServerUrl: "http://localhost:5173",
	packagedRendererBaseUrl: null,
	rendererDist: path.resolve("dist"),
};

const productionContext = {
	devServerUrl: null,
	packagedRendererBaseUrl: "http://127.0.0.1:43123",
	rendererDist: path.resolve("dist"),
};

describe("renderer window security", () => {
	it("trusts configured development, packaged, and file renderer URLs", () => {
		expect(
			isTrustedRendererUrl("http://localhost:5173/?windowType=editor", developmentContext),
		).toBe(true);
		expect(
			isTrustedRendererUrl("http://127.0.0.1:43123/?windowType=editor", productionContext),
		).toBe(true);
		expect(
			isTrustedRendererUrl(
				pathToFileURL(path.resolve("dist/index.html")).toString(),
				productionContext,
			),
		).toBe(true);
	});

	it("does not trust packaged or file renderers while using the development server", () => {
		expect(
			isTrustedRendererUrl("http://127.0.0.1:43123", {
				...developmentContext,
				packagedRendererBaseUrl: "http://127.0.0.1:43123",
			}),
		).toBe(false);
		expect(
			isTrustedRendererUrl(
				pathToFileURL(path.resolve("dist/index.html")).toString(),
				developmentContext,
			),
		).toBe(false);
	});

	it("only trusts a packaged renderer served from IPv4 loopback", () => {
		expect(
			isTrustedRendererUrl("http://localhost:43123", {
				...productionContext,
				packagedRendererBaseUrl: "http://localhost:43123",
			}),
		).toBe(false);
	});

	it("rejects external, data, and malformed URLs", () => {
		expect(isTrustedRendererUrl("https://example.com", productionContext)).toBe(false);
		expect(isTrustedRendererUrl("data:text/html,hello", productionContext)).toBe(false);
		expect(isTrustedRendererUrl("not a url", productionContext)).toBe(false);
	});

	it("only grants media permissions to the trusted HUD renderer", () => {
		expect(
			canRequestMediaPermission(
				"http://localhost:5173/?windowType=hud-overlay",
				"media",
				developmentContext,
				true,
			),
		).toBe(true);
		expect(
			canRequestMediaPermission(
				"http://localhost:5173/?windowType=editor",
				"media",
				developmentContext,
				true,
			),
		).toBe(false);
		expect(
			canRequestMediaPermission(
				"https://example.com/?windowType=hud-overlay",
				"media",
				developmentContext,
				true,
			),
		).toBe(false);
		expect(
			canRequestMediaPermission(
				"http://localhost:5173/?windowType=hud-overlay",
				"geolocation",
				developmentContext,
				true,
			),
		).toBe(false);
		expect(
			canRequestMediaPermission(
				"http://localhost:5173/?windowType=hud-overlay",
				"media",
				developmentContext,
				false,
			),
		).toBe(false);
	});

	it("only permits trusted renderer roles for sensitive IPC", () => {
		expect(
			isTrustedIpcSenderForWindowTypes(
				"http://localhost:5173/?windowType=editor",
				developmentContext,
				["editor"],
			),
		).toBe(true);
		expect(
			isTrustedIpcSenderForWindowTypes(
				"http://localhost:5173/?windowType=hud-overlay",
				developmentContext,
				["editor"],
			),
		).toBe(false);
		expect(
			isTrustedIpcSenderForWindowTypes(
				"https://example.com/?windowType=editor",
				developmentContext,
				["editor"],
			),
		).toBe(false);
	});

	it("reads the window type without trusting the URL", () => {
		expect(getRendererWindowType("http://localhost:5173/?windowType=editor")).toBe("editor");
		expect(getRendererWindowType("invalid")).toBeNull();
	});
});
