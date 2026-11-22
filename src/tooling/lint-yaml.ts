/**
 * YAML schema linter for m2ir protocol schema files.
 *
 * Validates enum-constrained fields across all YAML files in profiles/,
 * physical/, and concepts/. Catches parse errors and enum violations for
 * `confidence`, `maturity`, and `evidence[].source`.
 *
 * Run via: bun src/tooling/lint-yaml.ts
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseDocument } from "yaml";

import { findRepoRoot } from "./repo-paths.ts";

// ── Enum constants (must match src/schema/m2ir.schema.json) ──────────────────

const CONFIDENCE_VALUES = new Set([
	"documented",
	"inferred",
	"observed-only",
	"guessed",
	"superseded",
]);

const MATURITY_VALUES = new Set(["exploratory", "stable", "speculative"]);

const EVIDENCE_SOURCE_VALUES = new Set(["code", "doc", "sample", "talk"]);

// ── Deep-walk validator ───────────────────────────────────────────────────────

function validateEnumField(
	value: unknown,
	allowed: Set<string>,
	fieldPath: string,
	label: string,
	errors: string[],
): void {
	if (typeof value !== "string") {
		errors.push(
			`${fieldPath}: invalid ${label} ${JSON.stringify(value)} (expected one of: ${[...allowed].join(", ")})`,
		);
		return;
	}

	if (!allowed.has(value)) {
		errors.push(
			`${fieldPath}: invalid ${label} "${value}" (allowed: ${[...allowed].join(", ")})`,
		);
	}
}

/**
 * Recursively walks a parsed YAML document and collects enum violations.
 *
 * `source` is only validated when it appears as a direct property of an item
 * inside an `evidence` array — not when `source` appears in other contexts
 * such as `source-table.source` or process descriptions.
 *
 * Returns error strings of the form `<dot-path>: <message>`.
 */
function walkNode(node: unknown, path: string, errors: string[]): void {
	if (node === null || node === undefined || typeof node !== "object") {
		return;
	}

	if (Array.isArray(node)) {
		for (let i = 0; i < node.length; i++) {
			walkNode(node[i], `${path}[${i}]`, errors);
		}
		return;
	}

	const obj = node as Record<string, unknown>;

	for (const [key, value] of Object.entries(obj)) {
		const childPath = path ? `${path}.${key}` : key;

		if (key === "confidence") {
			validateEnumField(
				value,
				CONFIDENCE_VALUES,
				childPath,
				"confidence",
				errors,
			);
		} else if (key === "maturity") {
			validateEnumField(value, MATURITY_VALUES, childPath, "maturity", errors);
		} else if (key === "evidence" && Array.isArray(value)) {
			// Validate source only within evidence array items.
			for (let i = 0; i < value.length; i++) {
				const item = value[i];
				if (item !== null && typeof item === "object" && !Array.isArray(item)) {
					const src = (item as { source?: unknown }).source;
					if (src !== undefined) {
						validateEnumField(
							src,
							EVIDENCE_SOURCE_VALUES,
							`${childPath}[${i}].source`,
							"evidence source",
							errors,
						);
					}
				}
				// Recurse into evidence items for any nested confidence/maturity/evidence.
				walkNode(item, `${childPath}[${i}]`, errors);
			}
		} else {
			walkNode(value, childPath, errors);
		}
	}
}

// ── Typed field identity (profiles/winbox-ipc/profile.yaml key-id) ───────────

/** tcode spellings used in handler field maps -> RouterOS type letter. */
export const TCODE_LETTER: Record<string, string> = {
	bool: "b",
	u32: "u",
	u8: "u",
	be32: "u",
	u64: "q",
	bytes_16: "a",
	string: "s",
	bytes: "r",
	message: "m",
	u32_array: "U",
	u64_array: "Q",
	bytes16_array: "A",
	string_array: "S",
	message_array: "M",
	bytes_array: "R",
	bool_array: "B",
};
const TYPE_LETTERS = new Set(Object.values(TCODE_LETTER));

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validateFieldEntry(
	entry: unknown,
	path: string,
	errors: string[],
): void {
	if (!isRecord(entry)) return;
	const tcode = entry["tcode"];
	if (typeof tcode === "string" && !(tcode in TCODE_LETTER)) {
		errors.push(
			`${path}.tcode: unknown tcode "${tcode}" (known: ${Object.keys(TCODE_LETTER).join(", ")})`,
		);
	}
	const variants = entry["variants"];
	if (variants === undefined) return;
	if (!isRecord(variants) || Object.keys(variants).length < 2) {
		errors.push(
			`${path}.variants: expected a map of at least two type letters (use a plain entry for one type)`,
		);
		return;
	}
	for (const k of ["name", "tcode"])
		if (k in entry)
			errors.push(
				`${path}.${k}: not allowed next to variants; put it on each variant`,
			);
	for (const [letter, v] of Object.entries(variants)) {
		const vp = `${path}.variants.${letter}`;
		if (!TYPE_LETTERS.has(letter)) {
			errors.push(
				`${vp}: "${letter}" is not a type letter (allowed: ${[...TYPE_LETTERS].join(" ")})`,
			);
			continue;
		}
		if (!isRecord(v) || typeof v["name"] !== "string") {
			errors.push(`${vp}: expected an entry with a string name`);
			continue;
		}
		const vt = v["tcode"];
		if (typeof vt === "string" && TCODE_LETTER[vt] !== letter)
			errors.push(
				`${vp}.tcode: "${vt}" belongs to type letter "${TCODE_LETTER[vt] ?? "?"}", not "${letter}"`,
			);
		validateFieldEntry(v, vp, errors);
	}
}

/**
 * Checks handler field maps (gui-handlers.yaml shape): `fields.map` and
 * every `fields.namespace-*` map. A field number with two types must use
 * `variants:` keyed by type letter.
 */
function validateHandlerFields(doc: unknown, errors: string[]): void {
	if (!isRecord(doc) || !isRecord(doc["handlers"])) return;
	for (const [h, handler] of Object.entries(doc["handlers"])) {
		if (!isRecord(handler) || !isRecord(handler["fields"])) continue;
		for (const [group, map] of Object.entries(handler["fields"])) {
			if (group !== "map" && !group.startsWith("namespace-")) continue;
			if (!isRecord(map)) continue;
			for (const [field, entry] of Object.entries(map))
				validateFieldEntry(
					entry,
					`handlers.${h}.fields.${group}.${field}`,
					errors,
				);
		}
	}
}

/**
 * Validates a parsed YAML document object and returns error strings
 * prefixed with `filePath`.
 */
export function validateYamlDocument(doc: unknown, filePath: string): string[] {
	const inner: string[] = [];
	walkNode(doc, "", inner);
	validateHandlerFields(doc, inner);
	return inner.map((err) => `${filePath}: ${err}`);
}

// ── Main entry point ──────────────────────────────────────────────────────────

if (import.meta.main) {
	const repoRoot = findRepoRoot();

	const GLOB_PATTERNS = [
		"profiles/**/*.yaml",
		"physical/**/*.yaml",
		"concepts/**/*.yaml",
	];

	const relPaths: string[] = [];
	for (const pattern of GLOB_PATTERNS) {
		const glob = new Bun.Glob(pattern);
		for (const file of glob.scanSync({ cwd: repoRoot })) {
			relPaths.push(file);
		}
	}
	relPaths.sort();

	let totalErrors = 0;

	for (const relPath of relPaths) {
		const absPath = resolve(repoRoot, relPath);
		const content = readFileSync(absPath, "utf8");
		const doc = parseDocument(content);

		for (const err of doc.errors) {
			console.error(`${relPath}: YAML parse error: ${err.message}`);
			totalErrors++;
		}

		if (doc.contents !== null) {
			const parsed = doc.toJS();
			const errors = validateYamlDocument(parsed, relPath);
			for (const err of errors) {
				console.error(err);
			}
			totalErrors += errors.length;
		}
	}

	if (totalErrors > 0) {
		console.error(
			`\nYAML lint: ${totalErrors} error(s) across ${relPaths.length} file(s)`,
		);
		process.exit(1);
	} else {
		console.log(`YAML lint: ${relPaths.length} file(s) OK`);
	}
}
