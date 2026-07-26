import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

type IpcInvokeHandler = (event: unknown, ...args: unknown[]) => unknown;
type IpcSyncHandler = (event: { returnValue?: unknown }, ...args: unknown[]) => void;

const { testUserDataDir, invokeHandlers, syncHandlers } = vi.hoisted(() => {
	// vi.mock factories are hoisted above module statements, so anything the
	// electron mock needs must be created inside vi.hoisted.
	const nodeFs = require("node:fs") as typeof import("node:fs");
	const nodeOs = require("node:os") as typeof import("node:os");
	const nodePath = require("node:path") as typeof import("node:path");
	return {
		testUserDataDir: nodeFs.mkdtempSync(
			nodePath.join(nodeOs.tmpdir(), "recordly-settings-persistence-test-"),
		),
		invokeHandlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
		syncHandlers: new Map<
			string,
			(event: { returnValue?: unknown }, ...args: unknown[]) => void
		>(),
	};
});

vi.mock("electron", () => ({
	app: {
		getPath: () => testUserDataDir,
		getVersion: () => "0.0.0-test",
	},
	ipcMain: {
		handle: (channel: string, handler: IpcInvokeHandler) => {
			invokeHandlers.set(channel, handler);
		},
		on: (channel: string, handler: IpcSyncHandler) => {
			syncHandlers.set(channel, handler);
		},
	},
}));

vi.mock("../../cursorHider", () => ({ hideCursor: () => true }));
vi.mock("../../windows", () => ({
	closeCountdownWindow: () => undefined,
	createCountdownWindow: () => ({ webContents: {} }),
	getCountdownWindow: () => null,
}));
vi.mock("../project/manager", () => ({
	loadRecordingsSettings: async () => ({}),
	updateRecordingsSettings: async () => ({}),
}));

import { APP_SETTINGS_FILE, COUNTDOWN_SETTINGS_FILE, SHORTCUTS_FILE } from "../constants";
import { registerSettingsHandlers } from "./settings";

beforeAll(() => {
	registerSettingsHandlers();
});

afterAll(async () => {
	await fsp.rm(testUserDataDir, { recursive: true, force: true });
});

function setAppSetting(key: string, value: unknown): { success: boolean } {
	const event: { returnValue?: unknown } = {};
	syncHandlers.get("app-settings:set")!(event, key, value);
	return event.returnValue as { success: boolean };
}

describe("settings persistence", () => {
	it("persists app settings through the staged atomic path without leftovers", async () => {
		expect(setAppSetting("theme", "dark").success).toBe(true);
		expect(setAppSetting("locale", "zh-CN").success).toBe(true);

		const store = JSON.parse(await fsp.readFile(APP_SETTINGS_FILE, "utf-8"));
		// The second write must merge with, not clobber, the first key.
		expect(store).toEqual({ theme: "dark", locale: "zh-CN" });
		const leftovers = (await fsp.readdir(testUserDataDir)).filter((name) =>
			name.endsWith(".tmp"),
		);
		expect(leftovers).toEqual([]);
	});

	it("serializes concurrent shortcut and countdown writes without corrupting either file", async () => {
		const saveShortcuts = invokeHandlers.get("save-shortcuts")!;
		const setCountdownDelay = invokeHandlers.get("set-countdown-delay")!;

		const results = (await Promise.all([
			saveShortcuts({}, { record: "Ctrl+R" }),
			setCountdownDelay({}, 5),
			saveShortcuts({}, { record: "Ctrl+Shift+R", stop: "Ctrl+S" }),
			setCountdownDelay({}, 3),
		])) as Array<{ success: boolean }>;
		expect(results.every((result) => result.success)).toBe(true);

		// Last write per file wins, and both parse as complete JSON.
		expect(JSON.parse(await fsp.readFile(SHORTCUTS_FILE, "utf-8"))).toEqual({
			record: "Ctrl+Shift+R",
			stop: "Ctrl+S",
		});
		expect(JSON.parse(await fsp.readFile(COUNTDOWN_SETTINGS_FILE, "utf-8"))).toEqual({
			delay: 3,
		});
		const leftovers = (await fsp.readdir(testUserDataDir)).filter((name) =>
			name.endsWith(".tmp"),
		);
		expect(leftovers).toEqual([]);
	});

	it("keeps the previous settings file intact when a staged write fails", async () => {
		expect(setAppSetting("theme", "light").success).toBe(true);
		const before = await fsp.readFile(APP_SETTINGS_FILE, "utf-8");

		const openSpy = vi.spyOn(fs, "openSync").mockImplementationOnce(() => {
			throw new Error("disk full");
		});
		expect(setAppSetting("theme", "broken").success).toBe(false);
		openSpy.mockRestore();

		// Old content survives a failed replacement attempt.
		expect(await fsp.readFile(APP_SETTINGS_FILE, "utf-8")).toBe(before);
	});
});
