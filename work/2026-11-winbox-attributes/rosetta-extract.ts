// cspell:ignore cliref syscap unsettable addr terse ddl fts regen bfd blackhole blubster crs cwr dnat ece edonkey ein fasttrack gnutella prestera psh randomise rst snat soulseek tarpit tos urg winmx
// Rosetta pilot-candidate extractor (Phase A of attribute-discovery-plan.md).
//
// Opens the pinned Rosetta database read-only, runs the version-pinned SQL
// in ./queries/, and regenerates source-inventory.yaml + candidates.yaml.
//
// Usage:
//   bun work/2026-11-winbox-attributes/rosetta-extract.ts
//   bun work/2026-11-winbox-attributes/rosetta-extract.ts --db ~/.rosetta/ros-help-0.12.0.db
//   bun work/2026-11-winbox-attributes/rosetta-extract.ts --out work/2026-11-winbox-attributes
//
// The database is never written to and no bulk vendor prose is exported:
// description_markdown is reduced to a character count plus a url/line
// citation. Exits non-zero when provenance drifts from EXPECTED_PROVENANCE.

import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import {
	createReadStream,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { stringify } from "yaml";

const SCRIPT_DIR = dirname(resolve(Bun.main));
const QUERIES_DIR = join(SCRIPT_DIR, "queries");
const DEFAULT_DB = join(homedir(), ".rosetta", "ros-help-0.12.0.db");

// Pinned by attribute-discovery-plan.md lines 82-85. Recheck before editing.
const EXPECTED_PROVENANCE: Record<string, string> = {
	release_tag: "v0.12.0",
	schema_version: "12",
	source_commit: "6b6397d7739a563b894f9b07f7ac2f6b1ad7f4bf",
	built_at: "2026-10-30T21:34:20.911Z",
};

const EXPECTED_COUNTS: Record<string, string> = {
	"cliref 7.24": "10758",
	"cliref 7.25": "10833",
	"cliref 7.26": "11284",
	"inspect 7.25": "37240",
	"inspect 7.26beta4": "37233",
};

interface QuerySpec {
	file: string;
	purpose: string;
}

const QUERIES: QuerySpec[] = [
	{ file: "00-db-meta.sql", purpose: "database provenance key/value pairs" },
	{
		file: "10-cliref-field-counts.sql",
		purpose: "cliref field rows per manual version (plan verbatim)",
	},
	{
		file: "11-cliref-page-entry-counts.sql",
		purpose: "cliref pages/entries/fields per manual version",
	},
	{
		file: "12-inspect-arg-counts.sql",
		purpose: "inspect arg rows per presence version (plan verbatim)",
	},
	{
		file: "13-presence-versions.sql",
		purpose: "versions with detailed inspect presence",
	},
	{
		file: "14-ros-versions-count.sql",
		purpose: "ros_versions row count (not presence coverage)",
	},
	{
		file: "15-cliref-trees.sql",
		purpose: "manual versions with full cliref trees",
	},
	{
		file: "20-pilot-cliref.sql",
		purpose: "pilot-menu cliref candidates, all pinned versions",
	},
	{
		file: "21-pilot-standard.sql",
		purpose: "shared standard arguments for pilot menus",
	},
	{
		file: "22-pilot-inspect.sql",
		purpose: "inspect nodes under pilot menu paths",
	},
	{
		file: "23-pilot-entry-links.sql",
		purpose: "pilot entry to inspect-node menu links",
	},
	{
		file: "24-pilot-field-links.sql",
		purpose: "pilot field to inspect-arg verb links",
	},
	{
		file: "30-type-tag-samples.sql",
		purpose: "full schema_nodes.type_tag distribution",
	},
	{
		file: "31-table-ddl.sql",
		purpose: "CREATE TABLE text for the column audit",
	},
];

// Strict tokens whose absence supports the negative finding. Matched as
// case-insensitive substrings of DDL text; expect zero hits.
const STRICT_IDENTITY_TOKENS = [
	"winbox",
	"tlv",
	"handler_id",
	"field_id",
	"field_num",
	"attr_id",
	"command_num",
	"command_id",
	"wire_id",
	"wire_tag",
];

type Row = Record<string, unknown>;

function fail(message: string): never {
	console.error(`rosetta-extract: ${message}`);
	process.exit(1);
}

function sha256Text(text: string): string {
	return createHash("sha256").update(text, "utf8").digest("hex");
}

function sha256File(path: string): Promise<string> {
	return new Promise((res, rej) => {
		const hash = createHash("sha256");
		const stream = createReadStream(path);
		stream.on("data", (chunk: Buffer) => hash.update(chunk));
		stream.on("end", () => res(hash.digest("hex")));
		stream.on("error", rej);
	});
}

function textCell(row: Row, key: string): string | null {
	const value = row[key];
	return typeof value === "string" ? value : null;
}

function numCell(row: Row, key: string): number | null {
	const value = row[key];
	return typeof value === "number" ? value : null;
}

function reqText(row: Row, key: string, query: string): string {
	const value = textCell(row, key);
	if (value === null) {
		fail(`query ${query}: expected text in column "${key}"`);
	}
	return value;
}

function reqNum(row: Row, key: string, query: string): number {
	const value = numCell(row, key);
	if (value === null) {
		fail(`query ${query}: expected number in column "${key}"`);
	}
	return value;
}

function gitInfo(): { head: string; dirty: boolean } {
	try {
		const head = Bun.spawnSync(["git", "rev-parse", "HEAD"]);
		const status = Bun.spawnSync(["git", "status", "--porcelain"]);
		if (!head.success || !status.success) {
			return { head: "unknown", dirty: true };
		}
		return {
			head: new TextDecoder().decode(head.stdout).trim(),
			dirty: new TextDecoder().decode(status.stdout).trim().length > 0,
		};
	} catch {
		return { head: "unknown", dirty: true };
	}
}

function parseArgs(argv: string[]): { dbPath: string; outDir: string } {
	let dbPath = DEFAULT_DB;
	let outDir = SCRIPT_DIR;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--db") {
			const next = argv[i + 1];
			if (next === undefined) fail("--db requires a path argument");
			dbPath = next.startsWith("~/") ? join(homedir(), next.slice(2)) : next;
			i++;
		} else if (arg === "--out") {
			const next = argv[i + 1];
			if (next === undefined) fail("--out requires a directory argument");
			outDir = resolve(next);
			i++;
		} else {
			fail(`unknown argument "${arg}" (expected --db PATH or --out DIR)`);
		}
	}
	return { dbPath, outDir };
}

const GENERATED_HEADER = `# cspell:ignore cliref syscap unsettable addr iface terse asvalue oid num numericon ubit toc llms kpps mbps dbi multigig msrp wayback regen ddl fts afi ampdu mcs pcq ptp bfd blackhole blubster crs cwr dnat ece edonkey ein fasttrack gnutella prestera psh randomise rst snat soulseek tarpit tos urg winmx
# GENERATED by rosetta-extract.ts — do not hand-edit.
# Regenerate with: bun work/2026-11-winbox-attributes/rosetta-extract.ts
`;

async function main(): Promise<void> {
	const { dbPath, outDir } = parseArgs(Bun.argv.slice(2));
	const resolvedDb = resolve(dbPath);
	// Record a portable path: collapse the home directory to ~ so the
	// inventory does not embed a machine-specific username.
	const home = homedir();
	const displayDb = resolvedDb.startsWith(`${home}/`)
		? `~/${resolvedDb.slice(home.length + 1)}`
		: resolvedDb;
	let dbBytes = 0;
	try {
		dbBytes = statSync(resolvedDb).size;
	} catch {
		fail(`database not found: ${resolvedDb}`);
	}
	const dbSha256 = await sha256File(resolvedDb);
	const db = new Database(resolvedDb, { readonly: true });

	// Read + hash every query file first so results always cite exact text.
	const queryText = new Map<string, string>();
	const querySha = new Map<string, string>();
	for (const spec of QUERIES) {
		const text = readFileSync(join(QUERIES_DIR, spec.file), "utf8");
		queryText.set(spec.file, text);
		querySha.set(spec.file, sha256Text(text));
	}
	const run = (file: string): Row[] => {
		const sql = queryText.get(file);
		if (sql === undefined) fail(`missing query text for ${file}`);
		return db.query(sql).all() as Row[];
	};

	// Provenance gate: a stale database invalidates every count below.
	const metaRows = run("00-db-meta.sql");
	const meta = new Map<string, string>();
	for (const row of metaRows) {
		meta.set(reqText(row, "key", "00"), reqText(row, "value", "00"));
	}
	for (const [key, expected] of Object.entries(EXPECTED_PROVENANCE)) {
		const actual = meta.get(key);
		if (actual !== expected) {
			fail(
				`provenance drift: db_meta.${key} is ${JSON.stringify(actual)}, ` +
					`expected ${JSON.stringify(expected)} (recheck plan lines 82-85)`,
			);
		}
	}

	const clirefFieldCounts = run("10-cliref-field-counts.sql").map((row) => ({
		manual_version: reqText(row, "manual_version", "10"),
		fields: reqNum(row, "fields", "10"),
	}));
	const clirefPageEntryCounts = run("11-cliref-page-entry-counts.sql").map(
		(row) => ({
			manual_version: reqText(row, "manual_version", "11"),
			pages: reqNum(row, "pages", "11"),
			entries: reqNum(row, "entries", "11"),
			fields: reqNum(row, "fields", "11"),
		}),
	);
	const inspectArgCounts = run("12-inspect-arg-counts.sql").map((row) => ({
		version: reqText(row, "version", "12"),
		args: reqNum(row, "args", "12"),
	}));
	const presenceVersions = run("13-presence-versions.sql").map((row) =>
		reqText(row, "version", "13"),
	);
	const rosVersionsRow = run("14-ros-versions-count.sql")[0];
	if (rosVersionsRow === undefined) fail("query 14 returned no rows");
	const rosVersions = reqNum(rosVersionsRow, "ros_versions", "14");
	const clirefTrees = run("15-cliref-trees.sql").map((row) =>
		reqText(row, "manual_version", "15"),
	);

	// Count gate: fail loudly when the pinned database stops matching the
	// plan's recorded observations instead of silently emitting new numbers.
	for (const row of clirefFieldCounts) {
		const expected = EXPECTED_COUNTS[`cliref ${row.manual_version}`];
		if (expected !== undefined && String(row.fields) !== expected) {
			fail(
				`count drift: cliref fields ${row.manual_version}=${row.fields}, ` +
					`expected ${expected}`,
			);
		}
	}
	for (const row of inspectArgCounts) {
		const expected = EXPECTED_COUNTS[`inspect ${row.version}`];
		if (expected !== undefined && String(row.args) !== expected) {
			fail(
				`count drift: inspect args ${row.version}=${row.args}, ` +
					`expected ${expected}`,
			);
		}
	}

	// Column audit: PRAGMA column lists plus strict-token DDL search.
	const ddlRows = run("31-table-ddl.sql");
	const auditedTables: { name: string; columns: string[] }[] = [];
	const strictHits: { table: string; token: string; line: string }[] = [];
	const looseWireHits: { table: string; line: string }[] = [];
	for (const row of ddlRows) {
		const table = reqText(row, "name", "31");
		const ddl = reqText(row, "sql", "31");
		const cols = db.query(`PRAGMA table_info("${table}")`).all() as Row[];
		auditedTables.push({
			name: table,
			columns: cols.map((col) => reqText(col, "name", `pragma:${table}`)),
		});
		for (const line of ddl.split("\n")) {
			const lower = line.toLowerCase();
			for (const token of STRICT_IDENTITY_TOKENS) {
				if (lower.includes(token)) {
					strictHits.push({ table, token, line: line.trim() });
				}
			}
			if (lower.includes("wire")) {
				looseWireHits.push({ table, line: line.trim() });
			}
		}
	}

	const typeTags = run("30-type-tag-samples.sql").map((row) => ({
		type_tag: reqText(row, "type_tag", "30"),
		nodes: reqNum(row, "nodes", "30"),
	}));

	// Pilot candidates: keep version trees separate, no bulk prose.
	const pilotCliref = run("20-pilot-cliref.sql");
	const pilotStandard = run("21-pilot-standard.sql");
	const pilotInspect = run("22-pilot-inspect.sql");
	const pilotEntryLinks = run("23-pilot-entry-links.sql");
	const pilotFieldLinks = run("24-pilot-field-links.sql");

	db.close();

	const git = gitInfo();
	const extractedAt = new Date().toISOString();
	const rowCounts = new Map<string, number>([
		["00-db-meta.sql", metaRows.length],
		["10-cliref-field-counts.sql", clirefFieldCounts.length],
		["11-cliref-page-entry-counts.sql", clirefPageEntryCounts.length],
		["12-inspect-arg-counts.sql", inspectArgCounts.length],
		["13-presence-versions.sql", presenceVersions.length],
		["14-ros-versions-count.sql", 1],
		["15-cliref-trees.sql", clirefTrees.length],
		["20-pilot-cliref.sql", pilotCliref.length],
		["21-pilot-standard.sql", pilotStandard.length],
		["22-pilot-inspect.sql", pilotInspect.length],
		["23-pilot-entry-links.sql", pilotEntryLinks.length],
		["24-pilot-field-links.sql", pilotFieldLinks.length],
		["30-type-tag-samples.sql", typeTags.length],
		["31-table-ddl.sql", ddlRows.length],
	]);
	const queryInventory = QUERIES.map((spec) => ({
		file: `queries/${spec.file}`,
		sha256: querySha.get(spec.file),
		rows: rowCounts.get(spec.file) ?? -1,
		purpose: spec.purpose,
	}));

	const inventory = {
		provenance: {
			db_path: displayDb,
			db_sha256: dbSha256,
			db_bytes: dbBytes,
			release_tag: meta.get("release_tag"),
			schema_version: meta.get("schema_version"),
			source_commit: meta.get("source_commit"),
			built_at: meta.get("built_at"),
			cliref_manual_version: meta.get("cliref_manual_version"),
			docs_manual_version: meta.get("docs_manual_version"),
			extracted_at: extractedAt,
			extractor: "work/2026-11-winbox-attributes/rosetta-extract.ts",
			git_head: git.head,
			git_dirty: git.dirty,
		},
		counts: {
			cliref_fields: clirefFieldCounts,
			cliref_pages_entries: clirefPageEntryCounts,
			inspect_args: inspectArgCounts,
			presence_versions: presenceVersions,
			ros_versions: rosVersions,
			cliref_trees: clirefTrees,
		},
		negative_finding: {
			claim:
				"No numeric WinBox handler/field/verb identity columns were found " +
				"in the inspected Rosetta data.",
			method: [
				"Listed PRAGMA table_info columns for every non-FTS table (see audited_tables).",
				"Substring-searched all CREATE TABLE text for strict identity tokens " +
					"(see strict_tokens, strict_hits).",
				"Recorded the full schema_nodes.type_tag distribution (see type_tags).",
			],
			strict_tokens: STRICT_IDENTITY_TOKENS,
			strict_hits: strictHits,
			loose_wire_hits: looseWireHits,
			loose_wire_note:
				"A loose 'wire' substring only matches devices.wireless_*_chains " +
				"(Wi-Fi radio chain counts), which are unrelated to WinBox wire tags.",
			type_tags: {
				distinct: typeTags.length,
				interpretation:
					"Every value is a CLI enum type name (e.g. SecurityAuthenticationTypes), " +
					"not a numeric wire tag.",
				values: typeTags,
			},
			audited_tables: auditedTables,
		},
		queries: queryInventory,
		regen:
			"bun work/2026-11-winbox-attributes/rosetta-extract.ts [--db PATH] [--out DIR]",
	};

	// Index links by "manual_version|source_path|field" for the ledger.
	const fieldLinkIndex = new Map<string, string[]>();
	for (const row of pilotFieldLinks) {
		const key = [
			reqText(row, "manual_version", "24"),
			reqText(row, "source_path", "24"),
			reqText(row, "field_name", "24"),
		].join("|");
		const list = fieldLinkIndex.get(key) ?? [];
		list.push(reqText(row, "inspect_arg_path", "24"));
		fieldLinkIndex.set(key, list);
	}
	const entryLinkIndex = new Map<string, Row>();
	for (const row of pilotEntryLinks) {
		const key = [
			reqText(row, "manual_version", "23"),
			reqText(row, "source_path", "23"),
		].join("|");
		entryLinkIndex.set(key, row);
	}

	const menus = new Map<string, Row[]>();
	for (const row of pilotCliref) {
		const key = [
			reqText(row, "manual_version", "20"),
			reqText(row, "source_path", "20"),
		].join("|");
		const list = menus.get(key) ?? [];
		list.push(row);
		menus.set(key, list);
	}
	const pilotMenus = [...menus.entries()]
		.sort(([a], [b]) => (a < b ? -1 : 1))
		.map(([key, rows]) => {
			const first = rows[0];
			if (first === undefined) fail(`empty menu group ${key}`);
			const manualVersion = reqText(first, "manual_version", "20");
			const sourcePath = reqText(first, "source_path", "20");
			const entryLink = entryLinkIndex.get(key);
			return {
				cli_path: sourcePath,
				manual_version: manualVersion,
				page: {
					url: reqText(first, "url", "20"),
					sha256: reqText(first, "source_sha256", "20"),
					slug: reqText(first, "slug", "20"),
				},
				entry: {
					source_type: reqText(first, "source_type", "20"),
					package: textCell(first, "package"),
					conditions: textCell(first, "conditions"),
					entry_syscap: textCell(first, "entry_syscap"),
					source_lines: [
						reqNum(first, "entry_line", "20"),
						reqNum(first, "entry_end_line", "20"),
					],
				},
				entry_link:
					entryLink === undefined
						? null
						: {
								schema_path: reqText(entryLink, "schema_path", "23"),
								match_kind: reqText(entryLink, "match_kind", "23"),
								match_detail: textCell(entryLink, "match_detail"),
							},
				fields: rows.map((row) => {
					const fieldKey = [
						manualVersion,
						sourcePath,
						reqText(row, "name", "20"),
					].join("|");
					return {
						name: reqText(row, "name", "20"),
						raw_type: reqText(row, "raw_type", "20"),
						field_kind: reqText(row, "field_kind", "20"),
						mandatory: reqNum(row, "mandatory", "20") === 1,
						unsettable: reqNum(row, "unsettable", "20") === 1,
						field_syscap: textCell(row, "field_syscap"),
						source_line: reqNum(row, "source_line", "20"),
						description_chars: reqNum(row, "description_chars", "20"),
						workflow_status: "candidate",
						native_wire_identity: "unknown",
						inspect_args: fieldLinkIndex.get(fieldKey) ?? [],
					};
				}),
			};
		});

	const standardByVersion = new Map<string, Row[]>();
	for (const row of pilotStandard) {
		const version = reqText(row, "manual_version", "21");
		const list = standardByVersion.get(version) ?? [];
		list.push(row);
		standardByVersion.set(version, list);
	}
	const standardArgs = [...standardByVersion.entries()]
		.sort(([a], [b]) => (a < b ? -1 : 1))
		.map(([version, rows]) => ({
			manual_version: version,
			args: rows.map((row) => ({
				section: reqText(row, "section", "21"),
				name: reqText(row, "name", "21"),
				source_line: reqNum(row, "source_line", "21"),
				description_chars: reqNum(row, "description_chars", "21"),
			})),
		}));

	const inspectByPath = new Map<string, { node: Row; versions: string[] }>();
	for (const row of pilotInspect) {
		const path = reqText(row, "path", "22");
		const slot = inspectByPath.get(path) ?? { node: row, versions: [] };
		const version = textCell(row, "presence_version");
		if (version !== null) slot.versions.push(version);
		inspectByPath.set(path, slot);
	}
	const inspectNodes = [...inspectByPath.entries()]
		.sort(([a], [b]) => (a < b ? -1 : 1))
		.map(([, slot]) => ({
			path: reqText(slot.node, "path", "22"),
			name: reqText(slot.node, "name", "22"),
			type: reqText(slot.node, "type", "22"),
			parent_path: textCell(slot.node, "parent_path"),
			data_type: textCell(slot.node, "data_type"),
			type_tag: textCell(slot.node, "type_tag"),
			enum_values: textCell(slot.node, "enum_values"),
			presence: slot.versions.sort(),
		}));

	const candidates = {
		provenance: {
			db_sha256: dbSha256,
			release_tag: meta.get("release_tag"),
			extracted_at: extractedAt,
			source_inventory: "work/2026-11-winbox-attributes/source-inventory.yaml",
		},
		notes: [
			"CLI names are experiment aliases, not protocol identity. Every field keeps " +
				"native_wire_identity: unknown until Phase C proves a numeric mapping.",
			"cliref_field_inspect_links excludes read-only arguments, so actual-interface " +
				"and vrf have empty inspect_args by view construction, not by negative proof.",
			"One cliref property joins to inspect args under several verbs (add/set/reset); " +
				"the join suggests experiments, never a proven numeric mapping.",
			"The ip/address raw_type is a composite of address plus netmask: split-field " +
				"experiments are required before any single-TLV claim.",
			"schema_nodes completion examples (interface names, PCI ids) are observations " +
				"from an extraction context, not universal enum members.",
		],
		pilot_menus: pilotMenus,
		standard_args: standardArgs,
		inspect_nodes: inspectNodes,
	};

	writeFileSync(
		join(outDir, "source-inventory.yaml"),
		GENERATED_HEADER + stringify(inventory),
	);
	writeFileSync(
		join(outDir, "candidates.yaml"),
		GENERATED_HEADER + stringify(candidates),
	);

	console.log(`db: ${resolvedDb}`);
	console.log(`sha256: ${dbSha256}`);
	console.log(
		`cliref fields: ${clirefFieldCounts.map((r) => `${r.manual_version}=${r.fields}`).join(", ")}`,
	);
	console.log(
		`inspect args: ${inspectArgCounts.map((r) => `${r.version}=${r.args}`).join(", ")}`,
	);
	console.log(`pilot cliref rows: ${pilotCliref.length}`);
	console.log(`standard rows: ${pilotStandard.length}`);
	console.log(`inspect node rows: ${pilotInspect.length}`);
	console.log(`strict identity-token hits: ${strictHits.length}`);
	console.log(`wrote ${join(outDir, "source-inventory.yaml")}`);
	console.log(`wrote ${join(outDir, "candidates.yaml")}`);
}

await main();
