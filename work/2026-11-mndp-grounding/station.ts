/**
 * Host-side L2 hub and station for quickchr `listen-connect` sockets.
 *
 * Each CHR gets its own `listen-connect` socket and is its only member, so it holds slot 0 and
 * QEMU listens (`-netdev socket,listen=:<port>`). The host connects to every port; QEMU's stream
 * framing is a 4-byte big-endian length, then the Ethernet frame. The host floods each frame to
 * every other link, so the CHRs share one L2 segment, and it is a station on that segment too:
 * it can send MNDP requests (which RouterOS cannot craft) and see exactly what comes back, with
 * Ethernet and IP destinations intact, which a `/tool/sniffer` TZSP stream cannot show.
 *
 * (A quickchr `mcast` segment would be simpler, but quickchr passes no `localaddr=`, so the group
 * rides the LAN interface and a host firewall that drops inbound multicast silently breaks it.)
 *
 * The station answers ARP for its IPv4 address and IPv6 neighbor solicitations for its
 * link-local address, so a router that wants to reply unicast can resolve it.
 */
import { connect, type Socket } from "node:net";

export interface Frame {
	/** ms since the station opened. */
	t: number;
	/** Link (machine) the frame arrived on. */
	via: string;
	dstMac: string;
	srcMac: string;
	family: 4 | 6;
	src: string;
	dst: string;
	sport: number;
	dport: number;
	payloadHex: string;
}

export const STATION_MAC = "02:4d:4e:44:50:99";
export const STATION_IP4 = "192.168.77.99";
export const STATION_IP6 = "fe80::4d:4eff:fe44:5099";

const macBytes = (m: string) =>
	Buffer.from(m.split(":").map((x) => Number.parseInt(x, 16)));
const macStr = (b: Buffer) =>
	[...b].map((x) => x.toString(16).padStart(2, "0")).join(":");
const ip4Bytes = (a: string) => Buffer.from(a.split(".").map(Number));
const ip4Str = (b: Buffer) => [...b].join(".");

function ip6Bytes(a: string): Buffer {
	const [head = "", tail = ""] = a.split("::");
	const h = head ? head.split(":") : [];
	const t = a.includes("::") ? (tail ? tail.split(":") : []) : [];
	const groups = a.includes("::")
		? [...h, ...Array(8 - h.length - t.length).fill("0"), ...t]
		: h;
	const out = Buffer.alloc(16);
	for (const [i, g] of groups.entries())
		out.writeUInt16BE(Number.parseInt(g, 16), i * 2);
	return out;
}
const ip6Str = (b: Buffer) =>
	Array.from({ length: 8 }, (_, i) => b.readUInt16BE(i * 2).toString(16)).join(
		":",
	);

function csum(...parts: Buffer[]): number {
	const b = Buffer.concat(parts);
	let s = 0;
	for (let i = 0; i < b.length; i += 2)
		s += (b[i] as number) * 256 + (b[i + 1] ?? 0);
	while (s > 0xffff) s = (s & 0xffff) + (s >>> 16);
	return ~s & 0xffff;
}

function eth(
	dst: string,
	type: number,
	payload: Buffer,
	src = STATION_MAC,
): Buffer {
	const h = Buffer.alloc(14);
	macBytes(dst).copy(h, 0);
	macBytes(src).copy(h, 6);
	h.writeUInt16BE(type, 12);
	return Buffer.concat([h, payload]);
}

function udp(sport: number, dport: number, payload: Buffer): Buffer {
	const h = Buffer.alloc(8);
	h.writeUInt16BE(sport, 0);
	h.writeUInt16BE(dport, 2);
	h.writeUInt16BE(8 + payload.length, 4);
	return Buffer.concat([h, payload]);
}

export function udp4Frame(o: {
	/** Source MAC; defaults to the station's. Another value poses as a different (silent) host. */
	srcMac?: string;
	dstMac?: string;
	dst: string;
	sport: number;
	dport?: number;
	payload: Buffer;
	src?: string;
}): Buffer {
	const u = udp(o.sport, o.dport ?? 5678, o.payload); // IPv4 UDP checksum 0 = none
	const ip = Buffer.alloc(20);
	ip[0] = 0x45;
	ip.writeUInt16BE(20 + u.length, 2);
	ip[8] = 64;
	ip[9] = 17;
	ip4Bytes(o.src ?? STATION_IP4).copy(ip, 12);
	ip4Bytes(o.dst).copy(ip, 16);
	ip.writeUInt16BE(csum(ip), 10);
	return eth(
		o.dstMac ?? "ff:ff:ff:ff:ff:ff",
		0x0800,
		Buffer.concat([ip, u]),
		o.srcMac,
	);
}

function ip6Packet(dst: string, next: number, body: Buffer, hop = 255): Buffer {
	const ip = Buffer.alloc(40);
	ip[0] = 0x60;
	ip.writeUInt16BE(body.length, 4);
	ip[6] = next;
	ip[7] = hop;
	ip6Bytes(STATION_IP6).copy(ip, 8);
	ip6Bytes(dst).copy(ip, 24);
	return Buffer.concat([ip, body]);
}

function pseudo6(dst: string, next: number, len: number): Buffer {
	const p = Buffer.alloc(40);
	ip6Bytes(STATION_IP6).copy(p, 0);
	ip6Bytes(dst).copy(p, 16);
	p.writeUInt32BE(len, 32);
	p[39] = next;
	return p;
}

export function udp6Frame(o: {
	srcMac?: string;
	dstMac?: string;
	dst: string;
	sport: number;
	dport?: number;
	payload: Buffer;
}): Buffer {
	const u = udp(o.sport, o.dport ?? 5678, o.payload);
	u.writeUInt16BE(csum(pseudo6(o.dst, 17, u.length), u) || 0xffff, 6);
	const dstMac =
		o.dstMac ?? (o.dst.toLowerCase() === "ff02::1" ? "33:33:00:00:00:01" : "");
	if (!dstMac) throw new Error(`need dstMac for ${o.dst}`);
	return eth(dstMac, 0x86dd, ip6Packet(o.dst, 17, u, 64), o.srcMac);
}

export interface Station {
	frames: Frame[];
	/** Every non-MNDP frame addressed to the station (ARP, NDP, ICMP), for unicast evidence. */
	other: Array<{
		t: number;
		via: string;
		srcMac: string;
		ethType: number;
		note: string;
	}>;
	send(f: Buffer): void;
	now(): number;
	close(): void;
}

/** Open one TCP link per machine (`name → QEMU listen port`) and hub them together. */
export async function openStation(
	ports: Record<string, number>,
): Promise<Station> {
	const t0 = Date.now();
	const now = () => Date.now() - t0;
	const frames: Frame[] = [];
	const other: Station["other"] = [];
	const links = new Map<string, Socket>();
	const write = (s: Socket, f: Buffer) => {
		const len = Buffer.alloc(4);
		len.writeUInt32BE(f.length, 0);
		s.write(Buffer.concat([len, f]));
	};
	/** Flood a frame to every link except the one it came from. */
	const flood = (f: Buffer, from?: string) => {
		for (const [name, s] of links) if (name !== from) write(s, f);
	};
	const send = (f: Buffer) => flood(f);

	const handle = (f: Buffer, via: string) => {
		if (f.length < 14) return;
		const dstMac = macStr(f.subarray(0, 6));
		const srcMac = macStr(f.subarray(6, 12));
		if (srcMac === STATION_MAC) return; // our own frame looped back
		const type = f.readUInt16BE(12);
		const forUs = dstMac === STATION_MAC;
		if (!forUs) flood(f, via); // a hub: the CHRs see each other
		const note = (n: string) =>
			other.push({ t: now(), via, srcMac, ethType: type, note: n });
		if (type === 0x0806 && f.length >= 42) {
			// ARP: answer requests for our IPv4.
			const op = f.readUInt16BE(20);
			const tpa = ip4Str(f.subarray(38, 42));
			if (op === 1 && tpa === STATION_IP4) {
				note(`arp who-has ${tpa} from ${ip4Str(f.subarray(28, 32))}`);
				const a = Buffer.alloc(28);
				a.writeUInt16BE(1, 0);
				a.writeUInt16BE(0x0800, 2);
				a[4] = 6;
				a[5] = 4;
				a.writeUInt16BE(2, 6);
				macBytes(STATION_MAC).copy(a, 8);
				ip4Bytes(STATION_IP4).copy(a, 14);
				f.subarray(22, 28).copy(a, 18);
				f.subarray(28, 32).copy(a, 24);
				send(eth(srcMac, 0x0806, a));
			}
			return;
		}
		if (type === 0x0800 && f.length >= 34) {
			const ihl = ((f[14] as number) & 0x0f) * 4;
			const proto = f[23];
			const src = ip4Str(f.subarray(26, 30));
			const dst = ip4Str(f.subarray(30, 34));
			const u = 14 + ihl;
			if (proto === 17 && f.length >= u + 8) {
				const sport = f.readUInt16BE(u);
				const dport = f.readUInt16BE(u + 2);
				if (sport === 5678 || dport === 5678 || forUs) {
					const len = f.readUInt16BE(u + 4);
					frames.push({
						t: now(),
						via,
						dstMac,
						srcMac,
						family: 4,
						src,
						dst,
						sport,
						dport,
						payloadHex: f.subarray(u + 8, u + len).toString("hex"),
					});
				}
			} else if (forUs || dst === STATION_IP4) {
				note(
					`ipv4 proto ${proto} ${src} -> ${dst}${proto === 1 ? ` icmp type ${f[u]} code ${f[u + 1]}` : ""}`,
				);
			}
			return;
		}
		if (type === 0x86dd && f.length >= 54) {
			const next = f[20];
			const src = ip6Str(f.subarray(22, 38));
			const dst = ip6Str(f.subarray(38, 54));
			const u = 54;
			if (next === 17 && f.length >= u + 8) {
				const sport = f.readUInt16BE(u);
				const dport = f.readUInt16BE(u + 2);
				if (sport === 5678 || dport === 5678 || forUs) {
					const len = f.readUInt16BE(u + 4);
					frames.push({
						t: now(),
						via,
						dstMac,
						srcMac,
						family: 6,
						src,
						dst,
						sport,
						dport,
						payloadHex: f.subarray(u + 8, u + len).toString("hex"),
					});
				}
				return;
			}
			if (next === 58 && f[u] === 135 && f.length >= u + 24) {
				// Neighbor solicitation: answer for our link-local address.
				const target = f.subarray(u + 8, u + 24);
				if (target.equals(ip6Bytes(STATION_IP6))) {
					note(`ndp ns for ${ip6Str(target)} from ${src}`);
					const na = Buffer.alloc(32);
					na[0] = 136;
					na.writeUInt32BE(0x60000000, 4); // solicited + override
					target.copy(na, 8);
					na[24] = 2; // target link-layer address option
					na[25] = 1;
					macBytes(STATION_MAC).copy(na, 26);
					const reply = src === "0:0:0:0:0:0:0:0" ? "ff02::1" : src;
					na.writeUInt16BE(csum(pseudo6(reply, 58, na.length), na), 2);
					send(eth(srcMac, 0x86dd, ip6Packet(reply, 58, na)));
				}
				return;
			}
			if (forUs)
				note(
					`ipv6 next ${next} ${src} -> ${dst}${next === 58 ? ` icmp6 type ${f[u]}` : ""}`,
				);
		}
	};

	for (const [name, port] of Object.entries(ports)) {
		const s = connect(port, "127.0.0.1");
		await new Promise<void>((res, rej) => {
			s.once("connect", () => res());
			s.once("error", rej);
		});
		s.setNoDelay(true);
		let buf = Buffer.alloc(0);
		s.on("data", (d: Buffer) => {
			buf = Buffer.concat([buf, d]);
			while (buf.length >= 4) {
				const len = buf.readUInt32BE(0);
				if (buf.length < 4 + len) break;
				handle(buf.subarray(4, 4 + len), name);
				buf = buf.subarray(4 + len);
			}
		});
		s.on("close", () => links.delete(name));
		links.set(name, s);
	}
	return {
		frames,
		other,
		send,
		now,
		close: () => {
			for (const s of links.values()) s.destroy();
		},
	};
}
