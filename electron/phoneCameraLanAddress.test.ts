import { describe, expect, it } from "vitest";

import { choosePreferredLanAddress } from "./phoneCameraLanAddress";

describe("choosePreferredLanAddress", () => {
	it("prefers a Wi-Fi address over a WSL virtual adapter", () => {
		expect(
			choosePreferredLanAddress({
				"vEthernet (WSL)": [{ family: "IPv4", address: "172.25.128.1", internal: false }],
				WLAN: [{ family: "IPv4", address: "192.168.0.21", internal: false }],
			}),
		).toBe("192.168.0.21");
	});

	it("uses a physical adapter when no Wi-Fi adapter is available", () => {
		expect(
			choosePreferredLanAddress({
				Ethernet: [{ family: "IPv4", address: "10.0.0.15", internal: false }],
			}),
		).toBe("10.0.0.15");
	});

	it("keeps a virtual adapter as the last available fallback", () => {
		expect(
			choosePreferredLanAddress({
				"vEthernet (WSL)": [{ family: "IPv4", address: "172.25.128.1", internal: false }],
			}),
		).toBe("172.25.128.1");
	});

	it("falls back to localhost when no external IPv4 address exists", () => {
		expect(
			choosePreferredLanAddress({
				Loopback: [{ family: "IPv4", address: "127.0.0.1", internal: true }],
			}),
		).toBe("127.0.0.1");
	});
});
