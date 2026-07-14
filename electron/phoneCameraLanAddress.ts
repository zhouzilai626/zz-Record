type NetworkInterfaceEntry = {
	family: string;
	address: string;
	internal: boolean;
};

type NetworkInterfaces = Record<string, readonly NetworkInterfaceEntry[] | undefined>;

const PREFERRED_ADAPTER_NAME = /wi-?fi|wlan|wireless|ethernet|以太网/i;
const VIRTUAL_ADAPTER_NAME =
	/vethernet|wsl|hyper-v|virtual|vmware|virtualbox|tailscale|zerotier|docker|loopback/i;

function getExternalIpv4Addresses(entries: readonly NetworkInterfaceEntry[] | undefined) {
	return (entries ?? []).filter(
		(entry) => entry.family === "IPv4" && !entry.internal && !entry.address.startsWith("127."),
	);
}

export function choosePreferredLanAddress(interfaces: NetworkInterfaces): string {
	const adapters = Object.entries(interfaces)
		.map(([name, entries]) => ({ name, addresses: getExternalIpv4Addresses(entries) }))
		.filter((adapter) => adapter.addresses.length > 0);

	for (const adapter of adapters) {
		if (!VIRTUAL_ADAPTER_NAME.test(adapter.name) && PREFERRED_ADAPTER_NAME.test(adapter.name)) {
			return adapter.addresses[0].address;
		}
	}

	for (const adapter of adapters) {
		if (!VIRTUAL_ADAPTER_NAME.test(adapter.name)) {
			return adapter.addresses[0].address;
		}
	}

	return adapters[0]?.addresses[0].address ?? "127.0.0.1";
}
