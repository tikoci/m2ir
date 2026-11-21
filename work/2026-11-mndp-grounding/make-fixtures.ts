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

// /ip/packing: the first announcement carrying each set of TLVs 2–4.
{
	const name = "probe-7.26beta5.json";
	const seen = new Set<string>();
	for (const a of evidence(name).announcements) {
		const types = tlvTypes(a.payloadHex);
		const packing = types.filter((t) => [2, 3, 4, 9].includes(t)).join(",");
		if (!packing || seen.has(packing)) continue;
		seen.add(packing);
		announcements.push({
			id: `packing-${packing.replaceAll(",", "-")}`,
			source: `${src(name)} announcements[t=${a.t}] step ${a.step}`,
			kind: "announcement",
			version: versionOf(a.payloadHex),
			payloadHex: a.payloadHex,
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
}
const requests: RequestRecord[] = [];
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
			},
			i: number,
		) => {
			if (name === "requests-main-run2.json" && !run2Keep.has(r.id)) return;
			requests.push({
				id: r.round === undefined ? r.id : `${r.id}#${r.round}`,
				source: `${src(name)} requests[${i}]`,
				payloadHex: r.payloadHex,
				responders: new Set(r.replies.map((x) => x.router)).size,
			});
		},
	);
}

const field = evidence("field-summary.json");

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
write("field-summary.json", {
	provenance: {
		generator: "work/2026-11-mndp-grounding/make-fixtures.ts",
		copiedFrom: src("field-summary.json"),
		source: field.source,
	},
	rows: field.rows,
});

console.log(
	`fixtures/mndp: ${announcements.length} announcements, ${requests.length} requests, ${field.rows.length} field rows`,
);
