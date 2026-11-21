// MNDP canonical YAML: shape checks plus replay of the grounding evidence.
//
// The schema under test is physical/mndp.yaml (datagram grammar, value
// encodings) and profiles/mndp/profile.yaml (TLV names, values, version
// scope, requests, layouts). The bytes come from fixtures/mndp/, generated
// by work/2026-11-mndp-grounding/make-fixtures.ts from that directory's
// evidence files.
//
// Rule: TLV names, lengths, values and layouts come from the YAML, never
// from hardcoded labels. The parser below is independent of the work/
// decoder (mndp-wire.ts).

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

// ── loading ──────────────────────────────────────────────────────────────

function repoPath(rel: string): string {
	return fileURLToPath(new URL(`../../../${rel}`, import.meta.url));
}
function readYaml<T>(rel: string): T {
	return parseYaml(readFileSync(repoPath(rel), "utf8")) as T;
}
function readJson<T>(rel: string): T {
	return JSON.parse(readFileSync(repoPath(rel), "utf8")) as T;
}

type Kind = "announcement" | "request" | "dying-gasp";
type Versions = "all" | string[];

interface Encoding {
	size: number | null;
}
interface PhysicalDoc {
	id: string;
	transport: { protocol: string; port: number };
	"value-encodings": Record<string, Encoding>;
}

interface Scoped {
	confidence: string;
	"versions-seen": Versions;
}
interface ValueEntry extends Scoped {
	name: string;
	"neighbor-value"?: string | null;
}
interface Tlv extends Scoped {
	name: string;
	"neighbor-field": string | null;
	encoding: string;
	length: number | "any";
	in: Kind[];
	repeat?: boolean;
	since?: string;
	evidence: { source: string; ref: string }[];
	values?: Record<number, ValueEntry>;
	bits?: Record<number, ValueEntry>;
	"values-seen"?: Record<
		number,
		{ "neighbor-value": string | null; "versions-seen": string[] }
	>;
}
type OrderItem = number | { optional: number[]; repeat?: boolean };
interface Layout {
	kind: Kind;
	from: string;
	to: string | null;
	order: OrderItem[];
}
interface ProfileDoc {
	id: string;
	"physical-ref": string;
	scope: { "versions-observed": string[] };
	header: {
		fields: { name: string; offset: number; encoding: string }[];
	};
	tlvs: Record<number, Tlv>;
	unassigned: Record<string, unknown>;
	"unpack-derivation": {
		rows: { tlvs: number[]; "neighbor-value": string }[];
	};
	requests: {
		recommended: { hex: string };
		forms: { hex: string; replies: boolean }[];
	};
	layouts: Layout[];
}

const physical = readYaml<PhysicalDoc>("physical/mndp.yaml");
const profile = readYaml<ProfileDoc>("profiles/mndp/profile.yaml");

/** An observer's /ip/neighbor row as the lab recorded it. */
interface NeighborRow {
	[field: string]: string | null | undefined;
	identity?: string;
	version?: string;
	ipv6?: string | null;
	address6?: string;
	running?: string | null;
	unpack?: string;
}

interface AnnouncementRecord {
	id: string;
	kind: Kind;
	version: string | null;
	payloadHex: string;
	neighbor?: NeighborRow;
}
interface RequestRecord {
	id: string;
	payloadHex: string;
	responders: number;
}
interface FieldRow {
	version: string;
	arch: string;
	tlvOrder: string;
	header: { hex: string; uptimePerCountLE: number; uptimePerCountBE: number };
	tlv14: string;
	tlv18: string | null;
	tlv19: string | null;
	neighborRow: NeighborRow | null;
}

const announcements = readJson<{ records: AnnouncementRecord[] }>(
	"fixtures/mndp/announcements.json",
).records;
const requestRecords = readJson<{ records: RequestRecord[] }>(
	"fixtures/mndp/requests.json",
).records;
const fieldRows = readJson<{ rows: FieldRow[] }>(
	"fixtures/mndp/field-summary.json",
).rows;

// ── helpers ──────────────────────────────────────────────────────────────

/** RouterOS version → sortable tuple; a beta/rc sorts before its release. */
function versionKey(v: string): number[] {
	const m = /^(\d+)\.(\d+)(?:\.(\d+))?(?:(beta|rc)(\d+))?/.exec(v);
	if (!m) throw new Error(`cannot parse RouterOS version ${v}`);
	const [, major, minor, patch, pre, preN] = m;
	const stage = pre === "beta" ? 0 : pre === "rc" ? 1 : 2;
	return [
		Number(major),
		Number(minor),
		stage,
		pre ? Number(preN) : 0,
		Number(patch ?? 0),
	];
}
function compareVersions(a: string, b: string): number {
	const ka = versionKey(a);
	const kb = versionKey(b);
	for (let i = 0; i < ka.length; i++) {
		const d = (ka[i] as number) - (kb[i] as number);
		if (d !== 0) return d;
	}
	return 0;
}

function seenOn(
	entry: { "versions-seen": Versions },
	version: string,
): boolean {
	const list =
		entry["versions-seen"] === "all"
			? profile.scope["versions-observed"]
			: entry["versions-seen"];
	return list.includes(version);
}

interface Record_ {
	type: number;
	value: Uint8Array;
}
interface Datagram {
	header: Uint8Array;
	records: Record_[];
}

/** Parse by physical/mndp.yaml: 4-byte header, then u16be type + u16be length records to the exact end. */
function parseDatagram(hex: string): Datagram | null {
	const buf = Uint8Array.from(
		(hex.match(/.{2}/g) ?? []).map((b) => Number.parseInt(b, 16)),
	);
	if (buf.length < 4) return null;
	const dv = new DataView(buf.buffer);
	const records: Record_[] = [];
	let o = 4;
	while (o < buf.length) {
		if (o + 4 > buf.length) return null;
		const type = dv.getUint16(o);
		const length = dv.getUint16(o + 2);
		if (o + 4 + length > buf.length) return null;
		records.push({ type, value: buf.subarray(o + 4, o + 4 + length) });
		o += 4 + length;
	}
	return { header: buf.subarray(0, 4), records };
}

function mustParse(hex: string): Datagram {
	const d = parseDatagram(hex);
	if (!d) throw new Error(`malformed datagram ${hex}`);
	return d;
}

function tlvNamed(name: string): [number, Tlv] {
	const hit = Object.entries(profile.tlvs).find(([, t]) => t.name === name);
	if (!hit) throw new Error(`no TLV named ${name} in profiles/mndp`);
	return [Number(hit[0]), hit[1]];
}

const text = (v: Uint8Array) => new TextDecoder().decode(v);

/** How the lab's neighbor reads record a field RouterOS left out. */
const ABSENT = "(absent)";

/** Expand an IPv6 address to 32 hex digits. */
function ipv6Hex(addr: string): string {
	const [head, tail] = addr.split("::");
	const h = head ? head.split(":") : [];
	const t = tail !== undefined && tail !== "" ? tail.split(":") : [];
	const fill =
		tail === undefined ? [] : Array(8 - h.length - t.length).fill("0");
	return [...h, ...fill, ...t].map((g) => g.padStart(4, "0")).join("");
}

/** Does `types` follow `order`? Optional groups may skip members; repeat lets a member recur. */
function matchesOrder(types: number[], order: OrderItem[]): boolean {
	let i = 0;
	for (const item of order) {
		if (typeof item === "number") {
			if (types[i] !== item) return false;
			i++;
			continue;
		}
		for (const member of item.optional) {
			if (types[i] === member) {
				i++;
				while (item.repeat && types[i] === member) i++;
			}
		}
	}
	return i === types.length;
}

function layoutFor(kind: Kind, version: string): Layout[] {
	return profile.layouts.filter(
		(l) =>
			l.kind === kind &&
			compareVersions(version, l.from) >= 0 &&
			(l.to === null || compareVersions(version, l.to) <= 0),
	);
}

/** The request rule in profiles/mndp `requests.rule`. */
function isRequest(hex: string): boolean {
	const d = parseDatagram(hex);
	if (!d) return false;
	const [requestType] = tlvNamed("request");
	return (
		d.header.every((b) => b === 0) ||
		d.records.some((r) => r.type === requestType)
	);
}

// ── shape ────────────────────────────────────────────────────────────────

describe("MNDP schema shape", () => {
	test("profile binds the physical grammar on UDP 5678", () => {
		expect(profile["physical-ref"]).toBe("../../physical/mndp.yaml");
		expect(profile.id).toBe(physical.id);
		expect(physical.transport).toMatchObject({ protocol: "udp", port: 5678 });
	});

	test("header is one counter in the sender's byte order", () => {
		const [field] = profile.header.fields;
		expect(profile.header.fields).toHaveLength(1);
		expect(field?.offset).toBe(0);
		expect(physical["value-encodings"][field?.encoding ?? ""]).toMatchObject({
			size: 4,
			endian: "sender",
		});
	});

	test("TLVs 1–19 are covered: each is named or listed as unassigned", () => {
		for (let t = 1; t <= 19; t++) {
			const named = t in profile.tlvs;
			const unassigned = String(t) in profile.unassigned;
			expect(named !== unassigned).toBe(true);
		}
		expect(Object.keys(profile.unassigned)).toContain("13");
	});

	test("every TLV has a unique name, a known encoding, a matching length, scope and evidence", () => {
		const names = new Set<string>();
		const observed = profile.scope["versions-observed"];
		for (const [type, t] of Object.entries(profile.tlvs)) {
			const where = `TLV ${type}`;
			expect(names.has(t.name), `${where} name`).toBe(false);
			names.add(t.name);
			const enc = physical["value-encodings"][t.encoding];
			expect(enc, `${where} encoding ${t.encoding}`).toBeDefined();
			if (enc?.size === null) expect(t.length, where).toBe("any");
			else expect(t.length, where).toBe(enc?.size as number);
			expect(t.confidence, where).toBeString();
			expect(t.evidence.length, where).toBeGreaterThan(0);
			expect(t.in.length, where).toBeGreaterThan(0);
			for (const k of t.in)
				expect(["announcement", "request", "dying-gasp"]).toContain(k);
			if (t["versions-seen"] !== "all")
				for (const v of t["versions-seen"])
					expect(observed, where).toContain(v);
			for (const group of [t.values, t.bits])
				for (const [raw, entry] of Object.entries(group ?? {})) {
					const n = Number(raw);
					expect(n >= 0 && n <= 0xff, `${where} value ${raw}`).toBe(true);
					expect(entry.confidence, `${where} value ${raw}`).toBeString();
					expect(entry["versions-seen"], `${where} value ${raw}`).toBeDefined();
				}
		}
	});

	test("the recommended request satisfies the request rule", () => {
		expect(isRequest(profile.requests.recommended.hex)).toBe(true);
	});

	test("every documented request form agrees with the request rule", () => {
		for (const form of profile.requests.forms)
			expect(isRequest(form.hex), form.hex || "(empty)").toBe(form.replies);
	});
});

// ── announcement replay ──────────────────────────────────────────────────

describe("lab announcements decode by the YAML", () => {
	for (const rec of announcements) {
		test(rec.id, () => {
			const d = mustParse(rec.payloadHex);
			const version = rec.version;
			if (!version) throw new Error(`${rec.id}: no version`);
			const types = d.records.map((r) => r.type);

			for (const r of d.records) {
				const t = profile.tlvs[r.type];
				if (!t)
					throw new Error(`${rec.id}: TLV ${r.type} not in profiles/mndp`);
				if (t.length !== "any") expect(r.value.length, t.name).toBe(t.length);
				expect(t.in, t.name).toContain(rec.kind);
				expect(seenOn(t, version), `${t.name} seen on ${version}`).toBe(true);
				if (!t.repeat)
					expect(
						types.filter((x) => x === r.type),
						t.name,
					).toHaveLength(1);
				const byte = r.value[0] as number;
				if (t.values && t.name !== "ttl") {
					const v = t.values[byte];
					expect(v, `${t.name} value ${byte}`).toBeDefined();
					if (v)
						expect(seenOn(v, version), `${t.name}=${byte} on ${version}`).toBe(
							true,
						);
				}
				if (t.bits) {
					const named = Object.keys(t.bits).reduce((m, b) => m | Number(b), 0);
					expect(byte & ~named, `${t.name} unnamed bits`).toBe(0);
					expect(
						t["values-seen"]?.[byte],
						`${t.name} value ${byte}`,
					).toBeDefined();
				}
			}

			const [ttlType] = tlvNamed("ttl");
			const ttl = d.records.find((r) => r.type === ttlType);
			if (ttl) expect(ttl.value[0] === 0).toBe(rec.kind === "dying-gasp");

			const layouts = layoutFor(rec.kind, version);
			expect(layouts.length, `layout for ${rec.kind} ${version}`).toBe(1);
			expect(
				matchesOrder(types, layouts[0]?.order ?? []),
				`order ${types.join(",")}`,
			).toBe(true);
		});
	}
});

describe("neighbor rows match the YAML's neighbor-field bindings", () => {
	for (const rec of announcements.filter((r) => r.neighbor)) {
		test(rec.id, () => {
			const d = mustParse(rec.payloadHex);
			const row = rec.neighbor as NeighborRow;
			const tlvValues = (name: string) => {
				const [type] = tlvNamed(name);
				return d.records.filter((r) => r.type === type).map((r) => r.value);
			};

			for (const name of ["identity", "version"]) {
				const [, t] = tlvNamed(name);
				expect(text(tlvValues(name)[0] ?? new Uint8Array())).toBe(
					row[t["neighbor-field"] as string] as string,
				);
			}

			// The lab's REST neighbor reads leave a false `ipv6` out.
			const [, ipv6] = tlvNamed("ipv6-enabled");
			const flag = tlvValues("ipv6-enabled")[0]?.[0] as number;
			const shownIpv6 = row[ipv6["neighbor-field"] as string] as string;
			expect(ipv6.values?.[flag]?.["neighbor-value"]).toBe(
				shownIpv6 === ABSENT ? "false" : shownIpv6,
			);

			const [, running] = tlvNamed("running");
			const bits = tlvValues("running")[0]?.[0];
			if (bits !== undefined) {
				const shown =
					running["values-seen"]?.[bits]?.["neighbor-value"] ?? null;
				expect(shown ?? ABSENT).toBe(row.running as string);
			}

			const unpackTypes = ["unpack-simple", "unpack-headers", "unpack-all"]
				.map((n) => tlvNamed(n)[0])
				.filter((t) => d.records.some((r) => r.type === t));
			const derivation = profile["unpack-derivation"].rows.find(
				(r) =>
					r.tlvs.filter((t) => t >= 2 && t <= 4).join() === unpackTypes.join(),
			);
			expect(derivation?.["neighbor-value"]).toBe(row.unpack as string);

			const addresses = tlvValues("address6").map((v) =>
				[...v].map((b) => b.toString(16).padStart(2, "0")).join(""),
			);
			// Only one direction: the receiver can keep listing an address
			// after the sender stops announcing it.
			if (addresses.length > 0 && row.address6 && row.address6 !== ABSENT)
				expect(addresses).toContain(ipv6Hex(row.address6));
		});
	}
});

// ── requests ─────────────────────────────────────────────────────────────

describe("hub-lab requests follow the YAML request rule", () => {
	test("requests drew all six routers; other datagrams at most one stray periodic", () => {
		for (const r of requestRecords) {
			if (isRequest(r.payloadHex)) expect(r.responders, r.id).toBe(6);
			else expect(r.responders, r.id).toBeLessThanOrEqual(1);
		}
	});

	test("every form in the YAML with a fixture agrees with the fixture", () => {
		const byHex = new Map<string, RequestRecord[]>();
		for (const r of requestRecords)
			byHex.set(r.payloadHex, [...(byHex.get(r.payloadHex) ?? []), r]);
		let checked = 0;
		for (const form of profile.requests.forms) {
			const recs = byHex.get(form.hex);
			if (!recs) continue;
			checked++;
			for (const r of recs) expect(r.responders === 6, r.id).toBe(form.replies);
		}
		expect(checked).toBeGreaterThanOrEqual(15);
	});
});

// ── field capture ────────────────────────────────────────────────────────

describe("field capture rows fit the YAML", () => {
	for (const row of fieldRows) {
		const version = row.version.split(" ")[0] as string;
		test(`${version} ${row.arch}`, () => {
			const types = row.tlvOrder.split(",").map(Number);
			for (const t of types) {
				const tlv = profile.tlvs[t];
				if (!tlv) throw new Error(`TLV ${t} not in profiles/mndp`);
				expect(seenOn(tlv, version), `${tlv.name} on ${version}`).toBe(true);
				if (tlv.since)
					expect(compareVersions(version, tlv.since)).toBeGreaterThanOrEqual(0);
			}
			for (const name of ["running", "ttl"]) {
				const [type, tlv] = tlvNamed(name);
				if (tlv.since && compareVersions(version, tlv.since) >= 0)
					expect(types, `${name} on ${version}`).toContain(type);
			}
			const layouts = layoutFor("announcement", version);
			expect(layouts.length, `layout for ${version}`).toBe(1);
			expect(matchesOrder(types, layouts[0]?.order ?? [])).toBe(true);

			const [, ipv6] = tlvNamed("ipv6-enabled");
			const flag = Number.parseInt(row.tlv14, 16);
			expect(seenOn(ipv6.values?.[flag] as ValueEntry, version)).toBe(true);
			if (row.neighborRow)
				expect(ipv6.values?.[flag]?.["neighbor-value"]).toBe(
					row.neighborRow.ipv6 as string,
				);

			// Header: uptime ÷ counter lands near a discover-interval only
			// under the byte order the YAML gives for the CPU.
			const be = row.arch === "MIPSBE";
			const perCount = be
				? row.header.uptimePerCountBE
				: row.header.uptimePerCountLE;
			const other = be
				? row.header.uptimePerCountLE
				: row.header.uptimePerCountBE;
			expect(perCount).toBeGreaterThan(1);
			expect(perCount).toBeLessThan(65);
			expect(other < 1 || other > 1000).toBe(true);
		});
	}
});
