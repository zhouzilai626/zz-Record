import { describe, expect, it } from "vitest";
import { createEditorUpdateCardModel, formatUpdateProgress } from "./updateCardState";

describe("createEditorUpdateCardModel", () => {
	it("offers a manual check when idle", () => {
		expect(
			createEditorUpdateCardModel({
				status: "idle",
				currentVersion: "1.4.8",
				availableVersion: null,
			}),
		).toMatchObject({
			title: "官方更新服务",
			primaryAction: "check",
			primaryLabel: "检查更新",
		});
	});

	it("shows a download action only for an available update", () => {
		expect(
			createEditorUpdateCardModel({
				status: "available",
				currentVersion: "1.4.8",
				availableVersion: "1.4.9",
			}),
		).toMatchObject({
			title: "ZZ Record v1.4.9 可更新",
			primaryAction: "download",
			primaryLabel: "下载更新",
		});
	});

	it("does not expose an action while a download is in progress", () => {
		expect(
			createEditorUpdateCardModel({
				status: "downloading",
				currentVersion: "1.4.8",
				availableVersion: "1.4.9",
			}),
		).toMatchObject({
			primaryAction: null,
			showProgress: true,
		});
	});

	it("only offers installation after a download is ready", () => {
		expect(
			createEditorUpdateCardModel({
				status: "ready",
				currentVersion: "1.4.8",
				availableVersion: "1.4.9",
			}),
		).toMatchObject({
			primaryAction: "install",
			primaryLabel: "安装并重启",
		});
	});

	it("keeps failures recoverable by offering a new check", () => {
		expect(
			createEditorUpdateCardModel({
				status: "error",
				currentVersion: "1.4.8",
				availableVersion: null,
				detail: "network unavailable",
			}),
		).toMatchObject({
			primaryAction: "check",
			primaryLabel: "重试检查",
			detail: "network unavailable",
		});
	});
});

describe("formatUpdateProgress", () => {
	it("clamps invalid progress to a safe display range", () => {
		expect(formatUpdateProgress(undefined)).toBe(0);
		expect(formatUpdateProgress(-2)).toBe(0);
		expect(formatUpdateProgress(42.6)).toBe(43);
		expect(formatUpdateProgress(200)).toBe(100);
	});
});
