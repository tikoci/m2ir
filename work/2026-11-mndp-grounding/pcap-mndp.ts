/**
 * Extract MNDP payloads from a pcapng file (RouterOS `/tool/sniffer file-name=` writes pcapng),
 * one JSON line per distinct (source MAC, payload) pair, keeping the first capture time, a copy
 * count and the capture interface names RouterOS recorded in its Interface Description Blocks.
 *
 *   bun work/2026-11-mndp-grounding/pcap-mndp.ts <in.pcapng> > out.jsonl
 */
import { parseMndp, summary, udp5678 } from "./mndp-wire.ts";

const buf = Buffer.from(
	await Bun.file(process.argv[2] as string).arrayBuffer(),
);
if (buf.readUInt32LE(0) !== 0x0a0d0d0a) throw new Error("not a pcapng file");
const le = buf.readUInt32LE(8) === 0x1a2b3c4d;
const u16 = (o: number) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
const u32 = (o: number) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));

const ifaces: Array<{ linkType: number; name?: string }> = [];
type Row = {
	t: number;
	copies: number;
	ifaces: string[];
	family: number;
	src: string;
	dst: string;
	srcMac: string;
	payloadHex: string;
	summary: string;
};
const seen = new Map<string, Row>();
let o = 0;
let frames = 0;
while (o + 12 <= buf.length) {
	const type = u32(o);
	const len = u32(o + 4);
	if (len < 12) break;
	const body = o + 8;
	if (type === 1) {
		const iface: { linkType: number; name?: string } = { linkType: u16(body) };
		let p = body + 8; // linktype(2) reserved(2) snaplen(4)
		while (p + 4 <= o + len - 4) {
			const code = u16(p),
				olen = u16(p + 2);
			if (code === 0) break;
			if (code === 2)
				iface.name = buf.subarray(p + 4, p + 4 + olen).toString("utf8");
			p += 4 + Math.ceil(olen / 4) * 4;
		}
		ifaces.push(iface);
	} else if (type === 6) {
		frames++;
		const id = u32(body);
		const t =
			Number((BigInt(u32(body + 4)) << 32n) | BigInt(u32(body + 8))) / 1e6;
		const caplen = u32(body + 12);
		const frame = buf.subarray(body + 20, body + 20 + caplen);
		const iface = ifaces[id];
		const u = iface?.linkType === 1 ? udp5678(frame) : undefined;
		if (u && u.payload.length >= 4) {
			const payloadHex = u.payload.toString("hex");
			const key = `${u.srcMac} ${payloadHex}`;
			const name = iface?.name ?? `if${id}`;
			const prev = seen.get(key);
			if (prev) {
				prev.copies++;
				if (!prev.ifaces.includes(name)) prev.ifaces.push(name);
			} else
				seen.set(key, {
					t,
					copies: 1,
					ifaces: [name],
					family: u.family,
					src: u.src,
					dst: u.dst,
					srcMac: u.srcMac,
					payloadHex,
					summary: summary(parseMndp(u.payload)),
				});
		}
	}
	o += len;
}
for (const v of seen.values()) console.log(JSON.stringify(v));
console.error(
	`frames=${frames} interfaces=${ifaces.length} linktypes=${[...new Set(ifaces.map((i) => i.linkType))].join(",")} distinct-mndp=${seen.size}`,
);
