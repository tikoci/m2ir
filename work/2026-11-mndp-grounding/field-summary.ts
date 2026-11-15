/**
 * Turn a field capture (pcap-mndp.ts output) plus the capturing router's /ip/neighbor rows into a
 * sanitized summary: one row per (version, board, TLV layout), with no identity, MAC,
 * software-id, address or interface name. Values that would identify a device are reduced to
 * shape facts (present / length / count) or computed facts (counter vs uptime ratio).
 *
 *   bun field-summary.ts <mndp.jsonl> <ip-neighbor.json (centrs --json)> > evidence/field-summary.json
 */
import { parseMndp } from "./mndp-wire.ts";

const [capturePath, neighborPath] = process.argv.slice(2) as [string, string];
const rows = (await Bun.file(capturePath).text())
	.trim()
	.split("\n")
	.map((l) => JSON.parse(l));
const neighbors: Array<Record<string, string>> = (
	await Bun.file(neighborPath).json()
).data;
const byMac = new Map(
	neighbors.map((n) => [
		n["mac-address"]?.toLowerCase().replaceAll(":", ""),
		n,
	]),
);

// Architectures looked up with rosetta routeros_device_lookup (2026-11-15) or read from the device.
const ARCH: Record<string, string> = {
	"RB912R-2nD": "MIPSBE",
	"RB924iR-2nD-BT5&BG77": "MIPSBE",
	"RBcAPGi-5acD2nD": "ARM 32bit",
	RB1100Dx4: "ARM 32bit",
};

const out = new Map<string, Record<string, unknown>>();
for (const r of rows) {
	const m = parseMndp(Buffer.from(r.payloadHex, "hex"));
	const get = (t: number) => m.tlvs.filter((x) => x.type === t);
	const one = (t: number) => get(t)[0];
	const version = one(7)?.text ?? "";
	const board = one(12)?.text ?? "";
	const order = m.tlvs.map((t) => t.type).join(",");
	const key = `${version}|${board}|${order}`;
	if (out.has(key)) continue;
	const h = Buffer.from(m.header, "hex");
	const up = one(10);
	const uptime = up ? Buffer.from(up.hex, "hex").readUInt32LE(0) : undefined;
	const le = h.readUInt32LE(0),
		be = h.readUInt32BE(0);
	const mac = one(1)?.hex;
	const n = mac ? byMac.get(mac) : undefined;
	const iface = one(16)?.text ?? "";
	out.set(key, {
		version,
		board,
		arch: ARCH[board] ?? "not looked up",
		platformIsMikroTik: one(8)?.text === "MikroTik",
		tlvOrder: order,
		header: {
			hex: m.header,
			// Seconds per announcement under each byte order; the plausible one is near the discover-interval.
			uptimePerCountLE: uptime && le ? Number((uptime / le).toFixed(2)) : null,
			uptimePerCountBE: uptime && be ? Number((uptime / be).toFixed(2)) : null,
		},
		tlv14: one(14)?.hex ?? null,
		tlv18: one(18)?.hex ?? null,
		tlv19: one(19)?.hex ?? null,
		tlv15Count: get(15).length,
		tlv17Count: get(17).length,
		interfaceShape: iface.includes("/") ? "bridge/port" : "plain",
		neighborRow: n
			? {
					ipv6: n["ipv6"] ?? null,
					unpack: n["unpack"] ?? null,
					running: n["running"] ?? null,
					"discovered-by": n["discovered-by"],
				}
			: null,
	});
}
console.log(
	JSON.stringify(
		{
			source:
				"RouterOS /tool/sniffer pcapng on a 7.26beta5 RB1100Dx4 (filter udp/5678), ~35 s, 2026-11-15; neighbors on Ethernet, VLAN, EoIP and ZeroTier links. Sanitized: no identities, MACs, software-ids, addresses or interface names.",
			rows: [...out.values()].sort((a, b) =>
				String(a["version"]).localeCompare(String(b["version"]), "en", {
					numeric: true,
				}),
			),
		},
		null,
		"\t",
	),
);
