import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readWorkspaceFile(relativePath: string): string {
	return fs.readFileSync(path.resolve(relativePath), "utf8");
}

describe("disabled extension runtime", () => {
	it("does not register extension IPC handlers", () => {
		const mainSource = readWorkspaceFile("electron/main.ts");
		expect(mainSource).not.toContain("registerExtensionIpcHandlers");
	});

	it("does not expose extension methods from preload", () => {
		const preloadSource = readWorkspaceFile("electron/preload.ts");
		expect(preloadSource).not.toMatch(/\bextensions(?:List|Enable|Disable|Install|Uninstall)/);
	});

	it("does not render or automatically activate extensions in the editor", () => {
		const editorSource = readWorkspaceFile("src/components/video-editor/VideoEditor.tsx");
		expect(editorSource).not.toContain("ExtensionManager");
		expect(editorSource).not.toContain("autoActivateBuiltins");
		expect(editorSource).not.toContain('id: "extensions"');
		expect(editorSource).not.toContain("extensionSectionButtons");
	});
});
