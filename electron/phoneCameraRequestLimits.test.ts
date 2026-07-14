import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";

import { RequestBodyTooLargeError, readJsonBody } from "./phoneCameraRequestLimits";

function requestFrom(
	chunks: string[],
	contentLength?: string,
): Readable & {
	headers: Record<string, string | undefined>;
} {
	const request = Readable.from(chunks.map((chunk) => Buffer.from(chunk)));
	return Object.assign(request, {
		headers: { ...(contentLength ? { "content-length": contentLength } : {}) },
	});
}

describe("readJsonBody", () => {
	it("rejects a request declared larger than its route limit before reading it", async () => {
		const request = requestFrom(["{}"], "65");

		await expect(readJsonBody(request, 64)).rejects.toBeInstanceOf(RequestBodyTooLargeError);
	});

	it("rejects a streamed request that crosses its route limit", async () => {
		const request = requestFrom(['{"frame":"', "1234567890", '"}'], undefined);

		await expect(readJsonBody(request, 16)).rejects.toBeInstanceOf(RequestBodyTooLargeError);
	});

	it("parses a JSON request within its route limit", async () => {
		const request = requestFrom(['{"connected":true}'], "18");

		await expect(readJsonBody(request, 64)).resolves.toEqual({ connected: true });
	});
});
