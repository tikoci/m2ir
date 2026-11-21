// MNDP canonical YAML: shape checks plus replay of the grounding evidence.
//
// The schema under test is physical/mndp.yaml (datagram grammar, value
// encodings) and profiles/mndp/profile.yaml (TLV names, values, version
// scope, requests, layouts). The bytes come from fixtures/mndp/, generated
// by work/2026-11-mndp-grounding/make-fixtures.ts from that directory's
// evidence files.
//
// Rule: field widths, TLV names, lengths, values, version lists, layouts and
// the request rule come from the YAML, never from hardcoded labels. The
// parser below reads its widths from physical/mndp.yaml and is independent
// of the work/ decoder (mndp-wire.ts). Each fixture family has a minimum
// size, so an emptied fixture fails instead of passing vacuously.

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
	endian?: string;
}
interface SeqItem {
	name: string;
	size?: number;
	width?: string;
}
interface PhysicalDoc {
	id: string;
	transport: { protocol: string; port: number };
	structure: { datagram: { seq: SeqItem[] }; tlv: { seq: SeqItem[] } };
	"value-encodings": Record<string, Encoding>;
}

interface Evidence {
	source: string;
	ref: string;
}
interface Scoped {
	confidence: string;
	"versions-seen": Versions;
	evidence?: Evidence[];
}
interface ValueEntry extends Scoped {
	value: number;
	name?: string;
	"neighbor-value"?: string | null;
}
interface BitEntry extends Scoped {
	mask: number;
	name: string;
	"neighbor-value": string;
}
interface Tlv extends Scoped {
	name: string;
	"neighbor-field": string | null;
	encoding: string;
	length: number | "any";
	"emit-length"?: number;
	"accepted-lengths-seen"?: number[];
	in: Kind[];
	repeat?: boolean;
	since?: string;
	evidence: Evidence[];
	values?: ValueEntry[];
	bits?: BitEntry[];
	"values-seen"?: ValueEntry[];
	formula?: { multiplier: number; offset: number; max: number };
	examples?: { "discover-interval-seconds": number; value: number }[];
	"encoding-by-architecture"?: { architectures: string[]; encoding: string }[];
}
type OrderItem =
	| number
	| { optional: number[]; repeat?: boolean }
	| { "one-of": number[][]; optional?: boolean };
interface Layout {
	kind: Kind;
	from: string;
	to: string | null;
	sampled: string[];
	order: OrderItem[];
}
interface RuleClause {
	header?: number;
	"has-tlv"?: number;
}
type RequesterRow = "created-or-refreshed" | "none" | "not-checked";
interface ProfileDoc {
	id: string;
	"physical-ref": string;
	scope: { "versions-observed": string[]; "architectures-observed": string[] };
	header: {
		fields: {
			name: string;
			offset: number;
			encoding: string;
			"byte-order-by-architecture": {
				architectures: string[];
				endian: string;
			}[];
			"special-values": ValueEntry[];
		}[];
	};
	tlvs: Record<number, Tlv>;
	unassigned: Record<string, { evidence?: Evidence[] }>;
	"unpack-derivation": {
		rows: { tlvs: number[]; "neighbor-value": string }[];
	};
	requests: {
		rule: { requires: string; "any-of": RuleClause[] };
		recommended: { hex: string };
		forms: { hex: string; replies: boolean; "requester-row": RequesterRow }[];
	};
	layouts: Layout[];
}

const physical = readYaml<PhysicalDoc>("physical/mndp.yaml");
const profile = readYaml<ProfileDoc>("profiles/mndp/profile.yaml");

/** An observer's /ip/neighbor row as the lab recorded it. */
interface NeighborRow {
	[field: string]: string | null | undefined;
	ipv6?: string | null;
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
	requesterRow?: "created-or-refreshed" | "none";
}
interface TtlRecord {
	id: string;
	discoverIntervalSeconds: number;
	ttl: number;
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
interface VersionsIndex {
	versions: string[];
	tlvs: Record<string, string[]>;
	values: Record<string, string[]>;
	zeroHeader: string[];
}

const announcements = readJson<{ records: AnnouncementRecord[] }>(
	"fixtures/mndp/announcements.json",
).records;
const requestRecords = readJson<{ records: RequestRecord[] }>(
	"fixtures/mndp/requests.json",
).records;
const ttlRecords = readJson<{ records: TtlRecord[] }>(
	"fixtures/mndp/ttl.json",
).records;
const fieldRows = readJson<{ rows: FieldRow[] }>(
	"fixtures/mndp/field-summary.json",
).rows;
const versionsIndex = readJson<VersionsIndex>(
	"fixtures/mndp/versions-index.json",
);

/** How the lab's neighbor reads record a field RouterOS left out. */
const ABSENT = "(absent)";

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

function resolveVersions(v: Versions): string[] {
	return v === "all" ? profile.scope["versions-observed"] : v;
}
function seenOn(
	entry: { "versions-seen": Versions },
	version: string,
): boolean {
	return resolveVersions(entry["versions-seen"]).includes(version);
}
const sortedSet = (xs: Iterable<string>) => [...new Set(xs)].sort();

// Parser driven by physical/mndp.yaml.
type Width = "u8" | "u16be" | "u16le" | "u32be" | "u32le";
const WIDTH_BYTES: Record<Width, number> = {
	u8: 1,
	u16be: 2,
	u16le: 2,
	u32be: 4,
	u32le: 4,
};
function readWidth(dv: DataView, o: number, w: Width): number {
	switch (w) {
		case "u8":
			return dv.getUint8(o);
		case "u16be":
			return dv.getUint16(o, false);
		case "u16le":
			return dv.getUint16(o, true);
		case "u32be":
			return dv.getUint32(o, false);
		case "u32le":
			return dv.getUint32(o, true);
	}
}
function seqItem(seq: SeqItem[], name: string): SeqItem {
	const item = seq.find((s) => s.name === name);
	if (!item) throw new Error(`physical/mndp.yaml: no ${name} in structure`);
	return item;
}
const HEADER_SIZE = seqItem(physical.structure.datagram.seq, "header")
	.size as number;
const TYPE_WIDTH = seqItem(physical.structure.tlv.seq, "type").width as Width;
const LENGTH_WIDTH = seqItem(physical.structure.tlv.seq, "length")
	.width as Width;

interface TlvRecord {
	type: number;
	value: Uint8Array;
}
interface Datagram {
	header: Uint8Array;
	records: TlvRecord[];
}

function hexBytes(hex: string): Uint8Array {
	return Uint8Array.from(
		(hex.match(/.{2}/g) ?? []).map((b) => Number.parseInt(b, 16)),
	);
}

/** Returns null for a datagram that breaks physical/mndp.yaml framing-rule. */
function parseDatagram(hex: string): Datagram | null {
	const buf = hexBytes(hex);
	if (buf.length < HEADER_SIZE) return null;
	const dv = new DataView(buf.buffer);
	const tw = WIDTH_BYTES[TYPE_WIDTH];
	const lw = WIDTH_BYTES[LENGTH_WIDTH];
	const records: TlvRecord[] = [];
	let o = HEADER_SIZE;
	while (o < buf.length) {
		if (o + tw + lw > buf.length) return null;
		const type = readWidth(dv, o, TYPE_WIDTH);
		const length = readWidth(dv, o + tw, LENGTH_WIDTH);
		const start = o + tw + lw;
		if (start + length > buf.length) return null;
		records.push({ type, value: buf.subarray(start, start + length) });
		o = start + length;
	}
	return { header: buf.subarray(0, HEADER_SIZE), records };
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
const hexOf = (v: Uint8Array) =>
	[...v].map((b) => b.toString(16).padStart(2, "0")).join("");

/** Expand an IPv6 address to 32 hex digits. */
function ipv6Hex(addr: string): string {
	const [head, tail] = addr.split("::");
	const h = head ? head.split(":") : [];
	const t = tail !== undefined && tail !== "" ? tail.split(":") : [];
	const fill =
		tail === undefined ? [] : Array(8 - h.length - t.length).fill("0");
	return [...h, ...fill, ...t].map((g) => g.padStart(4, "0")).join("");
}

/** Does `types` follow `order`? See the layouts comment in profile.yaml. */
function matchesOrder(types: number[], order: OrderItem[]): boolean {
	let i = 0;
	for (const item of order) {
		if (typeof item === "number") {
			if (types[i] !== item) return false;
			i++;
		} else if ("one-of" in item) {
			const hit = item["one-of"].find((seq) =>
				seq.every((t, k) => types[i + k] === t),
			);
			if (hit) i += hit.length;
			else if (!item.optional) return false;
		} else {
			for (const member of item.optional) {
				if (types[i] === member) {
					i++;
					while (item.repeat && types[i] === member) i++;
				}
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

/** profiles/mndp `requests.rule`, evaluated from its structure. */
function isRequest(hex: string): boolean {
	const rule = profile.requests.rule;
	if (rule.requires !== "framing-rule")
		throw new Error(`unknown request requirement ${rule.requires}`);
	const d = parseDatagram(hex);
	if (!d) return false;
	const header = new DataView(
		d.header.buffer,
		d.header.byteOffset,
		4,
	).getUint32(0);
	return rule["any-of"].some((clause) => {
		if (clause.header !== undefined) return header === clause.header;
		if (clause["has-tlv"] !== undefined)
			return d.records.some((r) => r.type === clause["has-tlv"]);
		throw new Error(`unknown request clause ${JSON.stringify(clause)}`);
	});
}

function ttlFor(seconds: number): number {
	const [, ttl] = tlvNamed("ttl");
	const f = ttl.formula;
	if (!f) throw new Error("ttl: no formula");
	return Math.min(seconds * f.multiplier + f.offset, f.max);
}

/** Field rows name the CPU as the sniffer summary does; map to architecture-name. */
function fieldArchitecture(arch: string): string | null {
	if (arch === "MIPSBE") return "mipsbe";
	if (arch === "ARM 32bit") return "arm";
	if (arch === "ARM64") return "arm64";
	return null;
}

// ── shape ────────────────────────────────────────────────────────────────

describe("MNDP schema shape", () => {
	test("profile binds the physical grammar on UDP 5678", () => {
		expect(profile["physical-ref"]).toBe("../../physical/mndp.yaml");
		expect(profile.id).toBe(physical.id);
		expect(physical.transport).toMatchObject({ protocol: "udp", port: 5678 });
	});

	test("the physical grammar is the one RouterOS sends", () => {
		expect(HEADER_SIZE).toBe(4);
		expect(TYPE_WIDTH).toBe("u16be");
		expect(LENGTH_WIDTH).toBe("u16be");
	});

	test("the parser rejects what framing-rule calls malformed", () => {
		expect(parseDatagram("")).toBeNull();
		expect(parseDatagram("000000")).toBeNull();
		expect(parseDatagram("0000000000")).toBeNull(); // trailing byte
		expect(parseDatagram("00000000000500ff6161")).toBeNull(); // length overrun
		expect(parseDatagram("0000000000050002616100")).toBeNull(); // trailing after a record
		expect(parseDatagram("00000000")?.records).toEqual([]);
		expect(parseDatagram("00000000000600000005000161")?.records).toHaveLength(
			2,
		);
	});

	test("header is one counter in the sender's byte order", () => {
		const [field] = profile.header.fields;
		expect(profile.header.fields).toHaveLength(1);
		expect(field?.offset).toBe(0);
		expect(physical["value-encodings"][field?.encoding ?? ""]).toMatchObject({
			size: HEADER_SIZE,
			endian: "sender",
		});
		const architectures = field?.["byte-order-by-architecture"].flatMap(
			(b) => b.architectures,
		);
		expect(sortedSet(architectures ?? [])).toEqual(
			sortedSet(profile.scope["architectures-observed"]),
		);
	});

	test("TLVs 1–19 are covered: each is named or listed as unassigned", () => {
		for (let t = 1; t <= 19; t++) {
			const named = t in profile.tlvs;
			const unassigned = String(t) in profile.unassigned;
			expect(named !== unassigned, `TLV ${t}`).toBe(true);
		}
		expect(profile.unassigned["13"]?.evidence?.length).toBeGreaterThan(0);
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
			if (enc && enc.size !== null) expect(t.length, where).toBe(enc.size);
			for (const alt of t["encoding-by-architecture"] ?? []) {
				expect(physical["value-encodings"][alt.encoding]?.size, where).toBe(
					t.length as number,
				);
				for (const a of alt.architectures)
					expect(profile.scope["architectures-observed"]).toContain(a);
			}
			expect(t.confidence, where).toBeString();
			expect(t.evidence.length, where).toBeGreaterThan(0);
			expect(t.in.length, where).toBeGreaterThan(0);
			for (const k of t.in)
				expect(["announcement", "request", "dying-gasp"]).toContain(k);
			if (t["versions-seen"] !== "all")
				for (const v of t["versions-seen"])
					expect(observed, where).toContain(v);
			const entries: (ValueEntry | BitEntry)[] = [
				...(t.values ?? []),
				...(t.bits ?? []),
				...(t["values-seen"] ?? []),
			];
			for (const e of entries) {
				const n = "mask" in e ? e.mask : e.value;
				const label = `${where} ${"mask" in e ? "mask" : "value"} ${n}`;
				expect(Number.isInteger(n) && n >= 0 && n <= 0xff, label).toBe(true);
				expect(e.confidence, label).toBeString();
				expect(e["versions-seen"], label).toBeDefined();
				expect(e.evidence?.length ?? 0, label).toBeGreaterThan(0);
			}
			for (const group of [t.values, t.bits, t["values-seen"]]) {
				if (!group) continue;
				const keys = group.map((e) => ("mask" in e ? e.mask : e.value));
				expect(new Set(keys).size, `${where} duplicate value`).toBe(
					keys.length,
				);
			}
		}
	});

	test("the header's special values carry scope and evidence", () => {
		for (const sv of profile.header.fields[0]?.["special-values"] ?? []) {
			expect(sv.confidence).toBeString();
			expect(sv.evidence?.length ?? 0).toBeGreaterThan(0);
		}
	});

	test("the recommended request satisfies the request rule", () => {
		expect(isRequest(profile.requests.recommended.hex)).toBe(true);
	});

	test("TLV lengths in documented request forms pass the YAML's length rules", () => {
		const accepts = (t: Tlv, n: number) => t.length === "any" || t.length === n;
		const seen = new Map<number, Set<number>>();
		for (const form of profile.requests.forms) {
			const d = parseDatagram(form.hex);
			if (!d) continue;
			for (const r of d.records) {
				const t = profile.tlvs[r.type];
				if (!t) continue; // e.g. type 0 in "header 0 + empty TLV 0"
				const where = `${form.hex} TLV ${r.type}`;
				expect(accepts(t, r.value.length), where).toBe(true);
				if (form.replies)
					seen.set(r.type, (seen.get(r.type) ?? new Set()).add(r.value.length));
			}
		}
		// accepted-lengths-seen is exactly the lengths in forms that drew replies.
		let checked = 0;
		for (const [type, t] of Object.entries(profile.tlvs)) {
			if (!t["accepted-lengths-seen"]) continue;
			checked++;
			expect([...t["accepted-lengths-seen"]].sort(), `TLV ${type}`).toEqual(
				[...(seen.get(Number(type)) ?? [])].sort(),
			);
		}
		expect(checked).toBeGreaterThan(0);
		// The recommended request uses each TLV's emit-length.
		const rec = mustParse(profile.requests.recommended.hex);
		for (const r of rec.records) {
			const t = profile.tlvs[r.type];
			if (t?.["emit-length"] !== undefined)
				expect(r.value.length, `recommended TLV ${r.type}`).toBe(
					t["emit-length"],
				);
			if (t && t["emit-length"] !== undefined)
				expect(accepts(t, t["emit-length"])).toBe(true);
		}
	});

	test("every documented request form agrees with the request rule", () => {
		expect(profile.requests.forms.length).toBeGreaterThanOrEqual(15);
		for (const form of profile.requests.forms)
			expect(isRequest(form.hex), form.hex || "(empty)").toBe(form.replies);
	});
});

// ── version scope against every evidence payload ─────────────────────────

describe("versions-seen matches the evidence in both directions", () => {
	test("scope.versions-observed is every version in the evidence", () => {
		expect(sortedSet(profile.scope["versions-observed"])).toEqual(
			sortedSet(versionsIndex.versions),
		);
	});

	test("each TLV's versions-seen", () => {
		for (const [type, t] of Object.entries(profile.tlvs)) {
			if (!t.in.includes("announcement")) continue; // TLV 6: request only
			expect(
				sortedSet(resolveVersions(t["versions-seen"])),
				`TLV ${type} ${t.name}`,
			).toEqual(sortedSet(versionsIndex.tlvs[type] ?? []));
		}
	});

	test("each TLV's since is no later than its first sighting", () => {
		for (const [type, t] of Object.entries(profile.tlvs)) {
			if (!t.since) continue;
			for (const v of versionsIndex.tlvs[type] ?? [])
				expect(
					compareVersions(v, t.since),
					`TLV ${type} on ${v}`,
				).toBeGreaterThanOrEqual(0);
			const before = versionsIndex.versions.filter(
				(v) => compareVersions(v, t.since as string) < 0,
			);
			expect(
				before.length,
				`TLV ${type}: versions before since`,
			).toBeGreaterThan(0);
		}
	});

	test("each enum value's versions-seen", () => {
		const check = (
			type: number,
			entries: ValueEntry[],
			skip?: (v: number) => boolean,
		) => {
			const keyed = new Set<string>();
			for (const e of entries) {
				if (skip?.(e.value)) continue;
				const key = `${type}:${e.value}`;
				keyed.add(key);
				expect(sortedSet(resolveVersions(e["versions-seen"])), key).toEqual(
					sortedSet(versionsIndex.values[key] ?? []),
				);
			}
			for (const key of Object.keys(versionsIndex.values))
				if (key.startsWith(`${type}:`) && !skip?.(Number(key.split(":")[1])))
					expect(keyed.has(key), `${key} seen but not in the YAML`).toBe(true);
		};
		const [t14, ipv6] = tlvNamed("ipv6-enabled");
		check(t14, ipv6.values ?? []);
		const [t18, running] = tlvNamed("running");
		check(t18, running["values-seen"] ?? []);
		// TLV 19: only 00 is an enum value; the rest follow the formula.
		const [t19, ttl] = tlvNamed("ttl");
		check(
			t19,
			(ttl.values ?? []).filter((v) => v.value !== 0),
			(v) => v !== 0,
		);
	});

	test("each TLV 18 bit's versions-seen is the union of the values that set it", () => {
		const [t18, running] = tlvNamed("running");
		for (const bit of running.bits ?? []) {
			const versions = Object.entries(versionsIndex.values)
				.filter(
					([k]) =>
						k.startsWith(`${t18}:`) &&
						(Number(k.split(":")[1]) & bit.mask) !== 0,
				)
				.flatMap(([, v]) => v);
			expect(
				sortedSet(resolveVersions(bit["versions-seen"])),
				bit.name,
			).toEqual(sortedSet(versions));
		}
	});

	test("the zero header's versions-seen", () => {
		const zero = profile.header.fields[0]?.["special-values"].find(
			(v) => v.value === 0,
		);
		expect(sortedSet(resolveVersions(zero?.["versions-seen"] ?? []))).toEqual(
			sortedSet(versionsIndex.zeroHeader),
		);
	});

	test("each layout's sampled versions fall inside its bounds", () => {
		for (const l of profile.layouts) {
			expect(l.sampled[0]).toBe(l.from);
			for (const v of l.sampled) {
				expect(compareVersions(v, l.from)).toBeGreaterThanOrEqual(0);
				if (l.to) expect(compareVersions(v, l.to)).toBeLessThanOrEqual(0);
			}
		}
	});
});

// ── announcement replay ──────────────────────────────────────────────────

describe("lab announcements decode by the YAML", () => {
	test("fixture coverage", () => {
		expect(announcements.length).toBeGreaterThanOrEqual(35);
		expect(announcements.some((r) => r.kind === "dying-gasp")).toBe(true);
		expect(
			announcements.filter((r) => r.neighbor).length,
		).toBeGreaterThanOrEqual(25);
	});

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
					const v = t.values.find((e) => e.value === byte);
					expect(v, `${t.name} value ${byte}`).toBeDefined();
					if (v)
						expect(seenOn(v, version), `${t.name}=${byte} on ${version}`).toBe(
							true,
						);
				}
				if (t.bits) {
					const named = t.bits.reduce((m, b) => m | b.mask, 0);
					expect(byte & ~named, `${t.name} unnamed bits`).toBe(0);
					expect(
						t["values-seen"]?.find((e) => e.value === byte),
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
	const withRows = announcements.filter((r) => r.neighbor);
	const seenUnpack = new Set<string>();
	const seenRunning = new Set<number>();

	for (const rec of withRows) {
		test(rec.id, () => {
			const d = mustParse(rec.payloadHex);
			const row = rec.neighbor as NeighborRow;
			const values = (name: string) => {
				const [type] = tlvNamed(name);
				return d.records.filter((r) => r.type === type).map((r) => r.value);
			};
			// Lab reads record a missing field as "(absent)" or leave it out.
			const shown = (name: string) =>
				row[tlvNamed(name)[1]["neighbor-field"] as string] ?? ABSENT;

			for (const name of ["identity", "version"])
				expect(text(values(name)[0] ?? new Uint8Array()), name).toBe(
					shown(name) as string,
				);

			// The lab's REST neighbor reads leave a false `ipv6` out.
			const [, ipv6] = tlvNamed("ipv6-enabled");
			const flag = values("ipv6-enabled")[0]?.[0] as number;
			const shownIpv6 = shown("ipv6-enabled");
			expect(
				ipv6.values?.find((e) => e.value === flag)?.["neighbor-value"],
			).toBe(shownIpv6 === ABSENT ? "false" : (shownIpv6 as string));

			const [, running] = tlvNamed("running");
			const bits = values("running")[0]?.[0];
			if (bits !== undefined) {
				seenRunning.add(bits);
				const label =
					running["values-seen"]?.find((e) => e.value === bits)?.[
						"neighbor-value"
					] ?? null;
				expect(label ?? ABSENT).toBe(shown("running") as string);
			}

			const unpackTypes = [
				"unpack-simple",
				"unpack-headers",
				"unpack-all",
				"aggregated-size",
			]
				.map((n) => tlvNamed(n)[0])
				.filter((t) => d.records.some((r) => r.type === t));
			const derivation = profile["unpack-derivation"].rows.find(
				(r) =>
					sortedSet(r.tlvs.map(String)).join() ===
					sortedSet(unpackTypes.map(String)).join(),
			);
			expect(derivation, `unpack TLVs ${unpackTypes}`).toBeDefined();
			expect(derivation?.["neighbor-value"]).toBe(
				shown("unpack-simple") as string,
			);
			seenUnpack.add(derivation?.["neighbor-value"] ?? "");

			// When the sender announces addresses, the observer shows one of
			// them. The reverse need not hold: an observer can keep showing an
			// address after the sender stops sending TLV 15.
			const addresses = values("address6").map(hexOf);
			if (addresses.length > 0) {
				const a6 = shown("address6");
				expect(a6 && a6 !== ABSENT, "address6 shown").toBe(true);
				expect(addresses).toContain(ipv6Hex(a6 as string));
			}
		});
	}

	test("every unpack outcome and every TLV 18 value was exercised", () => {
		expect(sortedSet(seenUnpack)).toEqual(
			sortedSet(
				profile["unpack-derivation"].rows.map((r) => r["neighbor-value"]),
			),
		);
		const [, running] = tlvNamed("running");
		expect([...seenRunning].sort()).toEqual(
			(running["values-seen"] ?? []).map((e) => e.value).sort(),
		);
	});
});

// ── TTL formula ──────────────────────────────────────────────────────────

describe("TLV 19 follows the YAML formula", () => {
	test("the YAML's own examples", () => {
		const [, ttl] = tlvNamed("ttl");
		expect(ttl.examples?.length).toBeGreaterThanOrEqual(6);
		for (const ex of ttl.examples ?? [])
			expect(ttlFor(ex["discover-interval-seconds"])).toBe(ex.value);
	});

	test("the lab's interval steps", () => {
		expect(ttlRecords.length).toBeGreaterThanOrEqual(5);
		for (const r of ttlRecords)
			expect(ttlFor(r.discoverIntervalSeconds), r.id).toBe(r.ttl);
	});
});

// ── requests ─────────────────────────────────────────────────────────────

describe("hub-lab requests follow the YAML request rule", () => {
	test("requests drew all six routers; other datagrams at most one stray periodic", () => {
		expect(requestRecords.length).toBeGreaterThanOrEqual(60);
		expect(requestRecords.some((r) => isRequest(r.payloadHex))).toBe(true);
		expect(requestRecords.some((r) => !isRequest(r.payloadHex))).toBe(true);
		for (const r of requestRecords) {
			if (isRequest(r.payloadHex)) expect(r.responders, r.id).toBe(6);
			else expect(r.responders, r.id).toBeLessThanOrEqual(1);
		}
	});

	test("each form's replies and requester-row agree with the fixtures", () => {
		const byHex = new Map<string, RequestRecord[]>();
		for (const r of requestRecords)
			byHex.set(r.payloadHex, [...(byHex.get(r.payloadHex) ?? []), r]);
		let replyChecks = 0;
		let rowChecks = 0;
		for (const form of profile.requests.forms) {
			const recs = byHex.get(form.hex) ?? [];
			if (recs.length) replyChecks++;
			for (const r of recs) expect(r.responders === 6, r.id).toBe(form.replies);

			const reads = recs.filter(
				(r) => r.requesterRow && !r.id.includes("after"),
			);
			if (form["requester-row"] === "not-checked") {
				expect(reads, `${form.hex}: has a read, so it is checked`).toEqual([]);
			} else {
				expect(reads.length, `${form.hex}: no read backs it`).toBeGreaterThan(
					0,
				);
				for (const r of reads)
					expect(r.requesterRow, r.id).toBe(form["requester-row"]);
				rowChecks++;
			}
		}
		expect(replyChecks).toBeGreaterThanOrEqual(15);
		expect(rowChecks).toBeGreaterThanOrEqual(6);
	});
});

// ── field capture ────────────────────────────────────────────────────────

describe("field capture rows fit the YAML", () => {
	const orders = profile.header.fields[0]?.["byte-order-by-architecture"] ?? [];
	const endianFor = (arch: string) =>
		orders.find((o) => o.architectures.includes(arch))?.endian;

	test("fixture coverage, including both header byte orders", () => {
		expect(fieldRows.length).toBeGreaterThanOrEqual(20);
		const byteOrders = fieldRows
			.map((r) => fieldArchitecture(r.arch))
			.filter((a): a is string => a !== null)
			.map(endianFor);
		expect(byteOrders).toContain("le");
		expect(byteOrders).toContain("be");
	});

	for (const row of fieldRows) {
		const version = row.version.split(" ")[0] as string;
		test(`${version} ${row.arch}`, () => {
			const types = row.tlvOrder.split(",").map(Number);
			for (const t of types) {
				const tlv = profile.tlvs[t];
				if (!tlv) throw new Error(`TLV ${t} not in profiles/mndp`);
				expect(seenOn(tlv, version), `${tlv.name} on ${version}`).toBe(true);
			}
			for (const name of ["running", "ttl"]) {
				const [type, tlv] = tlvNamed(name);
				const due =
					tlv.since !== undefined && compareVersions(version, tlv.since) >= 0;
				expect(types.includes(type), `${name} on ${version}`).toBe(due);
			}
			const layouts = layoutFor("announcement", version);
			expect(layouts.length, `layout for ${version}`).toBe(1);
			expect(matchesOrder(types, layouts[0]?.order ?? [])).toBe(true);

			const [, ipv6] = tlvNamed("ipv6-enabled");
			const flag = Number.parseInt(row.tlv14, 16);
			const entry = ipv6.values?.find((e) => e.value === flag);
			expect(entry && seenOn(entry, version)).toBe(true);
			if (row.neighborRow)
				expect(entry?.["neighbor-value"]).toBe(row.neighborRow.ipv6 as string);

			// Header: uptime ÷ counter is a plausible discover-interval only
			// under the byte order the YAML gives for the CPU.
			const arch = fieldArchitecture(row.arch);
			if (arch === null) return;
			const endian = endianFor(arch);
			expect(endian, `byte order for ${arch}`).toBeDefined();
			const perCount =
				endian === "be"
					? row.header.uptimePerCountBE
					: row.header.uptimePerCountLE;
			const other =
				endian === "be"
					? row.header.uptimePerCountLE
					: row.header.uptimePerCountBE;
			expect(perCount).toBeGreaterThan(1);
			expect(perCount).toBeLessThan(65);
			expect(other < 1 || other > 1000).toBe(true);
		});
	}
});
