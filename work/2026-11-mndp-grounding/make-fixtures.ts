/**
 * Build fixtures/mndp/*.json from this directory's evidence files.
 *
 * The fixtures are small, reviewable slices of the lab evidence that
 * test/profiles/mndp/ replays against the canonical YAML
 * (physical/mndp.yaml, profiles/mndp/profile.yaml). Each record names its
 * source file and step so it can be traced back. Payloads are copied
 * byte for byte; CHR MACs, software-ids and addresses are disposable lab
 * values (see README.md → Evidence). field-summary.json is already
 * sanitized and is copied as is.
 *
 * Run from the repository root: bun work/2026-11-mndp-grounding/make-fixtures.ts
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseMndp } from "./mndp-wire.ts";

const here = import.meta.dir;
const outDir = resolve(here, "../../fixtures/mndp");
const evidence = (name: string) =>
	JSON.parse(readFileSync(resolve(here, "evidence", name), "utf8"));
const src = (name: string) => `work/2026-11-mndp-grounding/evidence/${name}`;

interface Announcement {
	id: string;
	source: string;
	kind: "announcement" | "dying-gasp";
	version: string | null;
	payloadHex: string;
	neighbor?: Record<string, string>;
}

/** RouterOS version from TLV 7 (first word), or null when the payload has none. */
function versionOf(hex: string): string | null {
	const t7 = parseMndp(Buffer.from(hex, "hex")).tlvs.find((t) => t.type === 7);
	if (!t7) return null;
	return Buffer.from(t7.hex, "hex").toString("utf8").split(" ")[0] ?? null;
}

function tlvTypes(hex: string): number[] {
	return parseMndp(Buffer.from(hex, "hex")).tlvs.map((t) => t.type);
}

const announcements: Announcement[] = [];

// Version sweep: the first announcement each version sent.
{
	const name = "sweep-baseline.json";
	const seen = new Set<string>();
	for (const a of evidence(name).announcements) {
		const v = versionOf(a.payloadHex);
		if (!v || seen.has(v)) continue;
		seen.add(v);
		announcements.push({
			id: `sweep-${v}`,
			source: `${src(name)} announcements[t=${a.t}]`,
			kind: "announcement",
			version: v,
			payloadHex: a.payloadHex,
		});
	}
}

// /ip/packing: each packing step's last subject announcement, with the
// observer's neighbor row for the subject after the step.
{
	const name = "probe-7.26beta5.json";
	const doc = evidence(name);
	const subjectMacs = new Set<string>(doc.subject.macs);
	for (const step of doc.steps) {
		if (!String(step.id).startsWith("packing:")) continue;
		const last = doc.announcements
			.filter(
				(a: { step: string; srcMac: string }) =>
					a.step === step.id && subjectMacs.has(a.srcMac),
			)
			.at(-1);
		const row = (step.neighbor ?? []).find(
			(n: { identity?: string }) => n.identity === "mndp-subject",
		);
		if (!last || !row) continue;
		announcements.push({
			id: `probe-${step.id}`.replace(/[^a-z0-9.-]+/gi, "-"),
			source: `${src(name)} steps[${step.id}] announcements[t=${last.t}]`,
			kind: "announcement",
			version: versionOf(last.payloadHex),
			payloadHex: last.payloadHex,
			neighbor: row,
		});
	}
}

// TTL study: each interval step's last subject announcement.
interface TtlSample {
	id: string;
	source: string;
	discoverIntervalSeconds: number;
	ttl: number;
}
const ttlSamples: TtlSample[] = [];
{
	const name = "ttl-7.26beta5.json";
	const doc = evidence(name);
	const subjectMacs = new Set<string>(doc.subject.macs);
	const seconds = (v: string) => {
		const m = /^(\d+)(s|m|h)$/.exec(v);
		if (!m) throw new Error(`ttl: cannot read interval ${v}`);
		return Number(m[1]) * { s: 1, m: 60, h: 3600 }[m[2] as "s" | "m" | "h"];
	};
	for (const step of doc.steps) {
		const cmd: string | undefined = step.commands[0]?.cmd;
		const m = cmd ? /discover-interval=(\S+)/.exec(cmd) : null;
		if (!m) continue;
		const last = doc.announcements
			.filter(
				(a: { step: string; srcMac: string }) =>
					a.step === step.id && subjectMacs.has(a.srcMac),
			)
			.at(-1);
		const t19 = last
			? parseMndp(Buffer.from(last.payloadHex, "hex")).tlvs.find(
					(t) => t.type === 19,
				)
			: undefined;
		if (!t19) continue;
		ttlSamples.push({
			id: step.id,
			source: `${src(name)} steps[${step.id}] announcements[t=${last.t}]`,
			discoverIntervalSeconds: seconds(m[1] as string),
			ttl: Number.parseInt(t19.hex, 16),
		});
	}
}

// Hub-lab setting studies: the last announcement of each step, with the
// observer's neighbor row for that router after the step.
for (const name of ["running-7.26beta5.json", "ipv6-7.17-7.26beta5.json"]) {
	const doc = evidence(name);
	for (const step of doc.steps) {
		const last = step.announcements.at(-1);
		if (!last) continue;
		announcements.push({
			id: `${doc.study}-${step.router}-${step.id}`
				.replace(/[^a-z0-9.-]+/gi, "-")
				.replace(/-+$/, ""),
			source: `${src(name)} steps[${step.id}]`,
			kind: "announcement",
			version: versionOf(last.payloadHex),
			payloadHex: last.payloadHex,
			neighbor: step.neighbor,
		});
	}
}

// Hub session: one boot announcement (header 0) and one 6.49.23 announcement.
{
	const name = "hub-session-2026-11-16.json";
	const frames: { payloadHex: string; t: number; via: string }[] =
		evidence(name).frames;
	const boot = frames.find(
		(f) => f.payloadHex.startsWith("00000000") && versionOf(f.payloadHex),
	);
	const v649 = frames.find((f) => versionOf(f.payloadHex) === "6.49.23");
	for (const [id, f] of [
		["boot-header-0", boot],
		["hub-6.49.23", v649],
	] as const) {
		if (!f) throw new Error(`hub session: no frame for ${id}`);
		announcements.push({
			id: `${id}-${versionOf(f.payloadHex)}`,
			source: `${src(name)} frames[t=${f.t} via=${f.via}]`,
			kind: "announcement",
			version: versionOf(f.payloadHex),
			payloadHex: f.payloadHex,
		});
	}
}

// Dying gasp: no TLV 7, TLV 19 = 00.
{
	const name = "dying-gasp-7.26beta5.json";
	const doc = evidence(name);
	const dg = doc.announcements.find(
		(a: { payloadHex: string }) =>
			tlvTypes(a.payloadHex).includes(19) &&
			!tlvTypes(a.payloadHex).includes(7),
	);
	if (!dg) throw new Error("dying-gasp: none found");
	announcements.push({
		id: "dying-gasp-7.26beta5",
		source: `${src(name)} announcements[t=${dg.t}]`,
		kind: "dying-gasp",
		version: doc.subject.version,
		payloadHex: dg.payloadHex,
	});
}

// Requests: per send, how many distinct routers replied. Run 1 is left out
// (its 9-zero-byte result is unexplained, see FINDINGS.md → Requests), and
// so are unicast and IPv6-only sends, which by design reach fewer routers.
interface RequestRecord {
	id: string;
	source: string;
	payloadHex: string;
	responders: number;
	/** requests-fresh only: did the 7.x receivers create or refresh a row for the sender? */
	requesterRow?: "created-or-refreshed" | "none";
}
const requests: RequestRecord[] = [];

/**
 * A row counts as created or refreshed when every 7.x receiver lists the
 * sender with an age inside the 4 s window. A row left over from an earlier
 * send (fresh-z9-after-z4, age 55 s) is neither.
 */
function requesterRow(
	id: string,
	listedBy: Record<string, { age: string } | null>,
): "created-or-refreshed" | "none" {
	const ages = Object.values(listedBy).map((row) =>
		row ? Number.parseInt(row.age, 10) : null,
	);
	if (ages.every((a) => a !== null && a <= 5)) return "created-or-refreshed";
	if (ages.every((a) => a === null || a > 5)) return "none";
	throw new Error(`requests-fresh ${id}: receivers disagree`);
}
const run2Keep = new Set([
	"empty-bcast",
	"z3-bcast",
	"nz4-bcast",
	"nzbe4-bcast",
	"nz-t6-bcast",
	"t6-8-bcast",
	"t6-9-bcast",
	"z4-bcast",
	"z9-bcast",
	"fake-ann-h0",
	"fake-ann-h5",
]);
for (const name of [
	"requests-forms.json",
	"requests-fresh.json",
	"requests-main-run2.json",
]) {
	const doc = evidence(name);
	doc.requests.forEach(
		(
			r: {
				id: string;
				payloadHex: string;
				round?: number;
				replies: { router: string }[];
				listedBy?: Record<string, { age: string } | null>;
			},
			i: number,
		) => {
			if (name === "requests-main-run2.json" && !run2Keep.has(r.id)) return;
			requests.push({
				id: r.round === undefined ? r.id : `${r.id}#${r.round}`,
				source: `${src(name)} requests[${i}]`,
				payloadHex: r.payloadHex,
				responders: new Set(r.replies.map((x) => x.router)).size,
				...(r.listedBy ? { requesterRow: requesterRow(r.id, r.listedBy) } : {}),
			});
		},
	);
}

const field = evidence("field-summary.json");

// Versions index: for every TLV, TLV 14/18/19 value and the zero header,
// the versions it was seen on across ALL evidence payloads that carry TLV 7
// (lab, hub lab, request replies) plus the field rows. The test compares the
// YAML's versions-seen with this in both directions.
const index = {
	versions: new Set<string>(),
	tlvs: new Map<number, Set<string>>(),
	values: new Map<string, Set<string>>(),
	zeroHeader: new Set<string>(),
};
const note = (
	map: Map<string | number, Set<string>>,
	key: string | number,
	v: string,
) => {
	const set = map.get(key) ?? new Set<string>();
	set.add(v);
	map.set(key, set);
};
function indexPayload(hex: string, fallbackVersion?: string): void {
	const m = parseMndp(Buffer.from(hex, "hex"));
	const v = versionOf(hex) ?? fallbackVersion;
	if (!v || m.trailing) return;
	index.versions.add(v);
	if (m.header === "00000000") index.zeroHeader.add(v);
	for (const t of m.tlvs) {
		note(index.tlvs as Map<string | number, Set<string>>, t.type, v);
		if ([14, 18, 19].includes(t.type))
			note(
				index.values as Map<string | number, Set<string>>,
				`${t.type}:${Number.parseInt(t.hex, 16)}`,
				v,
			);
	}
}
function walk(node: unknown): void {
	if (Array.isArray(node)) for (const x of node) walk(x);
	else if (node && typeof node === "object") {
		const hex = (node as { payloadHex?: unknown }).payloadHex;
		if (typeof hex === "string") indexPayload(hex);
		for (const x of Object.values(node)) walk(x);
	}
}
for (const name of new Bun.Glob("*.json").scanSync(resolve(here, "evidence")))
	if (name !== "field-summary.json") walk(evidence(name));
// Dying gasps carry no TLV 7; take the version from the study's subject.
{
	const doc = evidence("dying-gasp-7.26beta5.json");
	for (const a of doc.announcements as { payloadHex: string }[])
		if (!versionOf(a.payloadHex))
			indexPayload(a.payloadHex, doc.subject.version);
}
for (const row of field.rows as {
	version: string;
	tlvOrder: string;
	tlv14: string;
	tlv18: string | null;
	tlv19: string | null;
}[]) {
	const v = row.version.split(" ")[0] as string;
	index.versions.add(v);
	for (const t of row.tlvOrder.split(","))
		note(index.tlvs as Map<string | number, Set<string>>, Number(t), v);
	for (const [type, hex] of [
		[14, row.tlv14],
		[18, row.tlv18],
		[19, row.tlv19],
	] as const)
		if (hex !== null)
			note(
				index.values as Map<string | number, Set<string>>,
				`${type}:${Number.parseInt(hex, 16)}`,
				v,
			);
}
const sorted = (s: Set<string>) => [...s].sort();
const versionsIndex = {
	versions: sorted(index.versions),
	tlvs: Object.fromEntries(
		[...index.tlvs].sort((a, b) => a[0] - b[0]).map(([t, s]) => [t, sorted(s)]),
	),
	values: Object.fromEntries(
		[...index.values].sort().map(([k, s]) => [k, sorted(s)]),
	),
	zeroHeader: sorted(index.zeroHeader),
};

mkdirSync(outDir, { recursive: true });
const write = (file: string, body: unknown) =>
	writeFileSync(resolve(outDir, file), `${JSON.stringify(body, null, "\t")}\n`);

write("announcements.json", {
	provenance: {
		generator: "work/2026-11-mndp-grounding/make-fixtures.ts",
		sanitization:
			"Disposable quickchr CHR values only (MACs, software-ids, 192.0.2.0/24 and 192.168.77.0/24 addresses, link-local IPv6).",
	},
	records: announcements,
});
write("requests.json", {
	provenance: {
		generator: "work/2026-11-mndp-grounding/make-fixtures.ts",
		routers:
			"six hub-lab routers: 6.49.23, 7.17.2, 7.18.2, 7.20.8 and two 7.26beta5",
		windowMs: 4000,
		notes:
			"responders = distinct routers that announced within the window after the send. Not every announcement in a window is a reply: 6.49.23's 60 s periodic can fall in one.",
	},
	records: requests,
});
write("ttl.json", {
	provenance: {
		generator: "work/2026-11-mndp-grounding/make-fixtures.ts",
		notes:
			"TLV 19 of the subject's last announcement in each discover-interval step.",
	},
	records: ttlSamples,
});
write("versions-index.json", {
	provenance: {
		generator: "work/2026-11-mndp-grounding/make-fixtures.ts",
		notes:
			"Versions each TLV, each TLV 14/18/19 value (key type:value, decimal) and the zero header were seen on, across every evidence payload with TLV 7 plus the field rows. Payloads with trailing bytes are skipped.",
	},
	...versionsIndex,
});
write("field-summary.json", {
	provenance: {
		generator: "work/2026-11-mndp-grounding/make-fixtures.ts",
		copiedFrom: src("field-summary.json"),
		source: field.source,
	},
	rows: field.rows,
});

// Normalize to the repo's JSON formatting so a regeneration diffs cleanly.
const fmt = Bun.spawnSync(["bunx", "biome", "format", "--write", outDir], {
	stdout: "ignore",
	stderr: "inherit",
});
if (fmt.exitCode !== 0) throw new Error("biome format failed on fixtures/mndp");

console.log(
	`fixtures/mndp: ${announcements.length} announcements, ${requests.length} requests, ${ttlSamples.length} TTL samples, ${field.rows.length} field rows, ${versionsIndex.versions.length} versions indexed`,
);
