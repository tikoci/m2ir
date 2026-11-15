/**
 * Minimal, dependency-free decoders for the MNDP grounding lab.
 *
 * - `tzspFrame()` strips RouterOS `/tool/sniffer` TZSP v1 framing and returns the Ethernet frame.
 * - `udp5678()` pulls the UDP/5678 payload out of an Ethernet frame (IPv4 or IPv6).
 * - `parseMndp()` splits an MNDP payload into header + raw TLVs. It names nothing it was not
 *   told: names live in the `NAMES` table only for the types every source agrees on, plus the
 *   lab names for 18/19. Every TLV keeps its raw hex so a report can be re-decoded later.
 */

export interface Tlv {
	type: number;
	length: number;
	hex: string;
	/** Text rendering for printable values, for reading reports; never used as evidence. */
	text?: string;
}

export interface Mndp {
	header: string;
	tlvs: Tlv[];
	/** Bytes after the last complete TLV (non-empty means a truncated or malformed payload). */
	trailing: string;
}

export const NAMES: Record<number, string> = {
	1: "mac",
	5: "identity",
	7: "version",
	8: "platform",
	10: "uptime",
	11: "software-id",
	12: "board",
	14: "unpack",
	15: "ipv6",
	16: "interface",
	17: "ipv4",
	18: "running",
	19: "tlv-19",
};

export function parseMndp(p: Uint8Array): Mndp {
	const b = Buffer.from(p);
	const tlvs: Tlv[] = [];
	let o = 4;
	while (o + 4 <= b.length) {
		const type = b.readUInt16BE(o);
		const length = b.readUInt16BE(o + 2);
		if (o + 4 + length > b.length) break;
		const v = b.subarray(o + 4, o + 4 + length);
		const printable = length > 1 && /^[\x20-\x7e]+$/.test(v.toString("latin1"));
		tlvs.push({
			type,
			length,
			hex: v.toString("hex"),
			...(printable ? { text: v.toString("latin1") } : {}),
		});
		o += 4 + length;
	}
	return {
		header: b.subarray(0, Math.min(4, b.length)).toString("hex"),
		tlvs,
		trailing: b.subarray(o).toString("hex"),
	};
}

/** TZSP v1 (RouterOS sniffer streaming): 4-byte header, then tagged fields until tag 1 (END). */
export function tzspFrame(d: Buffer): Buffer | undefined {
	if (d.length < 5 || d[0] !== 1 || d[1] !== 0) return undefined; // version 1, type 0 = received tag list
	let o = 4;
	while (o < d.length) {
		const tag = d[o] as number;
		if (tag === 1) return d.subarray(o + 1);
		if (tag === 0) {
			o++;
			continue;
		}
		o += 2 + (d[o + 1] as number);
	}
	return undefined;
}

export interface Udp {
	family: 4 | 6;
	src: string;
	dst: string;
	srcMac: string;
	payload: Buffer;
}

const mac = (b: Buffer) =>
	[...b].map((x) => x.toString(16).padStart(2, "0")).join(":");

/** Return the UDP/5678 payload of an Ethernet frame, or undefined for anything else. */
export function udp5678(f: Buffer): Udp | undefined {
	if (f.length < 14) return undefined;
	let type = f.readUInt16BE(12);
	let o = 14;
	if (type === 0x8100 && f.length >= 18) {
		type = f.readUInt16BE(16);
		o = 18;
	}
	const srcMac = mac(f.subarray(6, 12));
	if (type === 0x0800 && f.length >= o + 20) {
		const ihl = ((f[o] as number) & 0x0f) * 4;
		if (f[o + 9] !== 17 || f.length < o + ihl + 8) return undefined;
		const u = o + ihl;
		if (f.readUInt16BE(u + 2) !== 5678) return undefined;
		const len = f.readUInt16BE(u + 4);
		return {
			family: 4,
			src: [...f.subarray(o + 12, o + 16)].join("."),
			dst: [...f.subarray(o + 16, o + 20)].join("."),
			srcMac,
			payload: f.subarray(u + 8, u + len),
		};
	}
	if (type === 0x86dd && f.length >= o + 48) {
		if (f[o + 6] !== 17) return undefined; // no extension headers expected for MNDP
		const u = o + 40;
		if (f.readUInt16BE(u + 2) !== 5678) return undefined;
		const len = f.readUInt16BE(u + 4);
		const a6 = (b: Buffer) =>
			Array.from({ length: 8 }, (_, i) =>
				b.readUInt16BE(i * 2).toString(16),
			).join(":");
		return {
			family: 6,
			src: a6(f.subarray(o + 8, o + 24)),
			dst: a6(f.subarray(o + 24, o + 40)),
			srcMac,
			payload: f.subarray(u + 8, u + len),
		};
	}
	return undefined;
}

/** One-line summary of a payload: header, then type=value for each TLV (uptime as LE seconds). */
export function summary(m: Mndp): string {
	const parts = m.tlvs.map((t) => {
		const name = NAMES[t.type] ?? `t${t.type}`;
		if (t.type === 10 && t.length === 4)
			return `${name}=${Buffer.from(t.hex, "hex").readUInt32LE(0)}`;
		return `${name}=${t.text ?? t.hex}`;
	});
	return `[${m.header}] ${parts.join(" ")}${m.trailing ? ` +trailing:${m.trailing}` : ""}`;
}
