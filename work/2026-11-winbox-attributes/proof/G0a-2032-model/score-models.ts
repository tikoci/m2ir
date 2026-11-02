// cspell:ignore getcount getall getobj subtable reqid fe0019 rosetta ungrounded fjump preds resid gcd
// G0a offline [20,32] model fit: re-extract the 5-point rule-set dataset
// from primary evidence (F-jump step JSONL + E3-W sweep + control reads),
// then score a bounded model family with explicit residuals.
// ZERO router contact: static file reads only. Usage:
//   bun work/2026-11-winbox-attributes/proof/G0a-2032-model/score-models.ts
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const FJUMP = join(ROOT, "work/2026-11-winbox-attributes/proof/F-jump");
const E3W = join(ROOT, "work/2026-11-winbox-attributes/proof/E3-W");
const OUT = join(ROOT, "work/2026-11-winbox-attributes/proof/G0a-2032-model");

type Entry = { key: string; tcode: string; value: unknown };
type Record = {
	direction: string;
	to: [number, number];
	from: [number, number];
	cmd: number | null;
	reqId: number;
	decode: { ok: boolean; entries: Entry[] };
};

function readJsonl(path: string): Record[] {
	return readFileSync(path, "utf8")
		.trim()
		.split("\n")
		.map((l) => JSON.parse(l) as Record);
}

function entryValue(rec: Record, key: string): unknown {
	return rec.decode.entries.find((e) => e.key === key)?.value;
}

/** [20,32] GETCOUNT rx value: rx record whose from == [20,32]. */
function getCount32(lines: Record[]): { line: number; value: number } {
	for (let i = 0; i < lines.length; i++) {
		const r = lines[i] as Record;
		if (r.direction === "rx" && r.from[0] === 20 && r.from[1] === 32) {
			return { line: i + 1, value: entryValue(r, "0xfe0019") as number };
		}
	}
	throw new Error("no [20,32] rx record");
}

/** Native f40 (0x28) action vector from a [20,3] GETALL rx record. */
function f40Vector(lines: Record[]): number[] {
	for (const r of lines) {
		if (r.direction === "rx" && r.from[0] === 20 && r.from[1] === 3) {
			const rows = entryValue(r, "0xfe0002") as Entry[][] | undefined;
			if (!Array.isArray(rows)) continue; // GETCOUNT rx, not GETALL
			return rows.map((row) => row.find((e) => e.key === "0x000028")?.value as number);
		}
	}
	return [];
}

function controlActions(path: string): string[] {
	const j = JSON.parse(readFileSync(path, "utf8")) as { data: { action: string }[] };
	return j.data.map((d) => d.action);
}

// ---- dataset extraction (provenance recorded per point) ----
type Point = { id: string; rules: string; nA: number; nJ: number; value: number; provenance: string };

const base = getCount32(readJsonl(join(FJUMP, "step-baseline.jsonl")));
const j1 = getCount32(readJsonl(join(FJUMP, "step-j1.jsonl")));
const j2 = getCount32(readJsonl(join(FJUMP, "step-j2.jsonl")));
const j2b = getCount32(readJsonl(join(FJUMP, "step-j2b.jsonl")));
const j3r = getCount32(readJsonl(join(FJUMP, "step-j3read.jsonl")));
const rest = getCount32(readJsonl(join(FJUMP, "step-restored.jsonl")));
const filtLines = readJsonl(join(E3W, "step-filter-sweep.jsonl"));
const filt90 = getCount32([filtLines[89] as Record]);

const f40j1 = f40Vector(readJsonl(join(FJUMP, "step-j1.jsonl")));
const f40j2b = f40Vector(readJsonl(join(FJUMP, "step-j2b.jsonl")));
const f40j3r = f40Vector(readJsonl(join(FJUMP, "step-j3read.jsonl")));

const points: Point[] = [
	{ id: "P0-empty", rules: "{}", nA: 0, nJ: 0, value: base.value, provenance: `F-jump step-baseline.jsonl rx line ${base.line} (fe0019=${base.value}); symmetric restore step-restored.jsonl=${rest.value}` },
	{ id: "P1-accept", rules: "{A}", nA: 1, nJ: 0, value: filt90.value, provenance: `E3-W step-filter-sweep.jsonl rx line 90 (fe0019=${filt90.value}); control control-filter-find-read.json=[${controlActions(join(E3W, "control-filter-find-read.json")).join(",")}]` },
	{ id: "P2-jump", rules: "{J}", nA: 0, nJ: 1, value: j1.value, provenance: `F-jump step-j1.jsonl rx line ${j1.line} (fe0019=${j1.value}); control control-j1-read.json action=jump; native f40=[${f40j1.join(",")}]` },
	{ id: "P3-jump-accept", rules: "{J,A}", nA: 1, nJ: 1, value: j2b.value, provenance: `F-jump step-j2b.jsonl rx line ${j2b.line} (fe0019=${j2b.value}); NO control read-back (procedural gap); native f40=[${f40j2b.join(",")}] order J-then-A` },
	{ id: "P4-accept-accept", rules: "{A,A}", nA: 2, nJ: 0, value: j3r.value, provenance: `F-jump step-j3read.jsonl rx line ${j3r.line} (fe0019=${j3r.value}); control control-j3-read.json=[${controlActions(join(FJUMP, "control-j3-read.json")).join(",")}]; native f40=[${f40j3r.join(",")}] with f41 residue on rowid 1` },
];
const bonusJ2 = `BONUS (not in 5-point set): step-j2.jsonl [20,32]=${j2.value} — jump-target string vary leaves the value unchanged`;

// ---- bounded model family: each predicts f(nA, nJ) ----
type Model = { id: string; family: string; predict: (nA: number, nJ: number) => number; note: string };
const VA = 8; // singleton accept value (forced)
const VJ = 2; // singleton jump value (forced)
const models: Model[] = [
	{ id: "M-count", family: "counting", predict: (a, j) => a + j, note: "row count N" },
	{ id: "M-presence", family: "counting", predict: (a, j) => (a + j > 0 ? 1 : 0), note: "presence flag" },
	{ id: "M-accept-count", family: "counting", predict: (a, _j) => a, note: "accept-rule count" },
	{ id: "M-jump-count", family: "counting", predict: (_a, j) => j, note: "jump-rule count" },
	{ id: "M-linear", family: "linear-weighted-sum", predict: (a, j) => VA * a + VJ * j, note: "weights forced by singletons" },
	{ id: "M-distinct", family: "counting", predict: (a, j) => (a > 0 ? 1 : 0) + (j > 0 ? 1 : 0), note: "distinct-action count" },
	{ id: "M-or", family: "bit-accumulation", predict: (a, j) => (a > 0 ? VA : 0) | (j > 0 ? VJ : 0), note: "bitmask OR over actions present" },
	{ id: "M-xor", family: "bit-accumulation", predict: (a, j) => (a % 2 === 1 ? VA : 0) ^ (j % 2 === 1 ? VJ : 0), note: "XOR accumulation" },
	{ id: "M-and", family: "bit-accumulation", predict: (a, j) => (a > 0 && j > 0 ? VA & VJ : a > 0 ? VA : j > 0 ? VJ : 0), note: "AND accumulation" },
	{ id: "M-min", family: "min-max", predict: (a, j) => (a > 0 && j > 0 ? Math.min(VA, VJ) : a > 0 ? VA : j > 0 ? VJ : 0), note: "min over per-action values" },
	{ id: "M-max", family: "min-max", predict: (a, j) => (a > 0 && j > 0 ? Math.max(VA, VJ) : a > 0 ? VA : j > 0 ? VJ : 0), note: "max over per-action values" },
	{ id: "M-gcd", family: "arithmetic", predict: (a, j) => (a > 0 && j > 0 ? 2 : a > 0 ? VA : j > 0 ? VJ : 0), note: "gcd(8,2)=2 for the pair" },
	{ id: "M-diff", family: "arithmetic", predict: (a, j) => Math.abs(VA * a - VJ * j), note: "|weighted difference|" },
	{ id: "M-product", family: "arithmetic", predict: (a, j) => (a + j === 0 ? 0 : VA ** a * VJ ** j), note: "product of per-action values" },
	{ id: "M-first-wins", family: "order-dependent", predict: (a, j) => (j > 0 && a > 0 ? VJ : a > 0 ? VA : j > 0 ? VJ : 0), note: "first-added rule wins (J added before A in P3)" },
	{ id: "M-last-wins", family: "order-dependent", predict: (a, j) => (j > 0 && a > 0 ? VA : a > 0 ? VA : j > 0 ? VJ : 0), note: "last-added rule wins" },
	{ id: "M-pow2", family: "arithmetic", predict: (a, j) => (a + j === 0 ? 0 : 2 ** Math.max(0, 3 - a - 2 * j)), note: "2^(3-nA-2nJ) gated on nonempty" },
];

// brute-force affine-modular family: f = (a*nA + b*nJ + c) mod m
function bruteForceModular(): { fits: string[]; searched: number } {
	const fits: string[] = [];
	let searched = 0;
	for (let m = 2; m <= 64; m++) {
		for (let a = 0; a <= 32; a++) {
			for (let b = 0; b <= 32; b++) {
				for (let c = 0; c < m; c++) {
					searched++;
					const ok = points.every((p) => (a * p.nA + b * p.nJ + c) % m === p.value);
					if (ok) fits.push(`a=${a} b=${b} c=${c} m=${m}`);
				}
			}
		}
	}
	return { fits, searched };
}

// ---- scoring ----
type Scored = { id: string; family: string; note: string; preds: number[]; residuals: number[]; maxAbs: number; fits: boolean };
const scored: Scored[] = models.map((m) => {
	const preds = points.map((p) => m.predict(p.nA, p.nJ));
	const residuals = preds.map((pr, i) => pr - (points[i] as Point).value);
	return { id: m.id, family: m.family, note: m.note, preds, residuals, maxAbs: Math.max(...residuals.map(Math.abs)), fits: residuals.every((r) => r === 0) };
});

const mod = bruteForceModular();
scored.push({
	id: "M-mod-affine-search",
	family: "modular",
	note: `exhaustive (a,b,c,m) a,b<=32 m<=64: ${mod.searched} combos, ${mod.fits.length} fit`,
	preds: [],
	residuals: [],
	maxAbs: mod.fits.length === 0 ? Number.POSITIVE_INFINITY : 0,
	fits: mod.fits.length > 0,
});

// ---- output ----
console.log("dataset:", points.map((p) => `${p.rules}->${p.value}`).join(" "));
console.log(bonusJ2);
for (const s of scored) {
	if (s.id === "M-mod-affine-search") {
		console.log(`${s.id}: searched=${mod.searched} fits=${mod.fits.length} ${s.fits ? "FITS" : "NO-FIT"}`);
	} else {
		console.log(`${s.id}: pred=[${s.preds.join(",")}] resid=[${s.residuals.join(",")}] maxAbs=${s.maxAbs} ${s.fits ? "FITS" : "FAIL"}`);
	}
}
const survivors = scored.filter((s) => s.fits).map((s) => s.id);
console.log(`survivors: ${survivors.length === 0 ? "NONE — AMBIGUOUS" : survivors.join(",")}`);

const yaml: string[] = [
	"# cspell:ignore getcount getall subtable reqid preds gcd",
	"# G0a machine-checked dataset + model scores (generated by score-models.ts; do not hand-edit).",
	"dataset:",
];
for (const p of points) yaml.push(`  - id: ${p.id}`, `    rules: "${p.rules}"`, `    n_accept: ${p.nA}`, `    n_jump: ${p.nJ}`, `    value: ${p.value}`, `    provenance: "${p.provenance}"`);
yaml.push(`bonus_j2_note: "${bonusJ2}"`, "models:");
for (const s of scored) {
	yaml.push(`  - id: ${s.id}`, `    family: ${s.family}`, `    note: "${s.note}"`);
	if (s.id === "M-mod-affine-search") {
		yaml.push(`    searched: ${mod.searched}`, `    fits_found: ${mod.fits.length}`, `    verdict: ${s.fits ? "FITS" : "NO-FIT"}`);
	} else {
		yaml.push(`    predictions: [${s.preds.join(", ")}]`, `    residuals: [${s.residuals.join(", ")}]`, `    max_abs_residual: ${s.maxAbs}`, `    verdict: ${s.fits ? "FITS" : "FAIL"}`);
	}
}
yaml.push(`survivors: [${survivors.join(", ")}]`, "overall: AMBIGUOUS (no bounded model fits all 5 points)");
writeFileSync(join(OUT, "scores.yaml"), `${yaml.join("\n")}\n`);
console.log("wrote scores.yaml");
