import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	app: {
		getPath: () => ".test-user-data",
	},
}));

import { handlePhoneCameraBridgeRequest } from "./phoneCameraBridgeServer";

const servers: ReturnType<typeof createServer>[] = [];

async function startTestServer(): Promise<string> {
	const server = createServer((request, response) => {
		void handlePhoneCameraBridgeRequest(request, response);
	});
	servers.push(server);

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});

	const address = server.address() as AddressInfo;
	return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
	await Promise.all(
		servers.splice(0).map(
			(server) =>
				new Promise<void>((resolve, reject) => {
					server.close((error) => (error ? reject(error) : resolve()));
				}),
		),
	);
});

describe("phone camera bridge", () => {
	it("serves only the HTTPS image-frame client implementation", async () => {
		const baseUrl = await startTestServer();
		const response = await fetch(`${baseUrl}/phone-camera`);
		const page = await response.text();

		expect(response.status).toBe(410);
		expect(page).toContain("/phone-camera/connect");
		expect(page).toContain("/phone-camera/frame");
		expect(page).not.toMatch(/RTCPeerConnection|RTCSessionDescription|RTCIceCandidate/i);
		expect(page).not.toMatch(/stun:|\/api\/webrtc-/i);
	});

	it("returns 404 for removed WebRTC signaling routes on repeated requests", async () => {
		const baseUrl = await startTestServer();
		const requests = Array.from({ length: 50 }, (_, index) =>
			fetch(`${baseUrl}/api/webrtc-${index % 2 === 0 ? "offer" : "ice"}`, {
				method: index % 3 === 0 ? "GET" : "POST",
				headers: { "Content-Type": "application/json" },
				body:
					index % 3 === 0
						? undefined
						: JSON.stringify({ candidate: `candidate-${index}` }),
			}),
		);

		const responses = await Promise.all(requests);
		expect(responses.every((response) => response.status === 404)).toBe(true);
	});
});
