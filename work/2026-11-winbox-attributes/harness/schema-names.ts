// Phase B harness: schema-derived names with numeric fallback.
//
// Loads the actual canonical YAML (sys-keys, std-keys, std-commands,
// gui-handlers pilot routes) and resolves display names for captured
// keys. Unknown keys report absent-coverage with a numeric fallback;
// tcode disagreements are reported, never papered over. Raw M2 decoding
// never depends on this module: capture first, name later.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

export interface KeyInfo {
	name: string;
	source: string;
	tcodes: number[];
}

export type NameResolution =
	| { name: string; source: string }
	| { name: null; reason: "absent-coverage"; fallback: string };

export type TcodeCheck =
	| { agree: true }
	| { agree: false; expected: string; detail: string }
	| { agree: null; reason: "absent-coverage" };

function repoFile(rel: string): string {
	const url = new URL(`../../../${rel}`, import.meta.url);
	return readFileSync(fileURLToPath(url), "utf8");
}

function parseNumKey(raw: string): number {
	const n = Number(raw);
	if (!Number.isInteger(n)) throw new Error(`schema-names: bad key ${raw}`);
	return n;
}

interface KeysDoc {
	keys?: Record<
		string,
		{ "canonical-name"?: string; physical?: { tcodes?: unknown[] } }
	>;
}

interface CommandsDoc {
	commands?: Record<string, { "canonical-name"?: string }>;
}

function loadKeysDoc(rel: string, table: Map<number, KeyInfo>): void {
	const doc = parse(repoFile(rel)) as KeysDoc;
	if (!doc || typeof doc !== "object" || !doc.keys) {
		throw new Error(`schema-names: ${rel} has no keys table`);
	}
	for (const [raw, entry] of Object.entries(doc.keys)) {
		const fullKey = parseNumKey(raw);
		const name = entry?.["canonical-name"];
		if (typeof name !== "string") continue;
		const tcodes: number[] = [];
		for (const t of entry.physical?.tcodes ?? []) {
			if (typeof t === "number") tcodes.push(t);
		}
		table.set(fullKey, { name, source: rel, tcodes });
	}
}

export interface NameTables {
	keys: Map<number, KeyInfo>;
	commands: Map<number, KeyInfo>;
	/** Route "pid,hid" -> fullKey -> info for pilot handler fields. */
	routes: Map<string, Map<number, KeyInfo>>;
}

function loadRouteFields(
	handlers: Record<string, unknown>,
	tables: NameTables,
): void {
	for (const [handlerName, raw] of Object.entries(handlers)) {
		if (typeof raw !== "object" || raw === null) continue;
		const h = raw as {
			"sys-to"?: unknown;
			fields?: {
				map?: unknown;
				"namespace-user"?: unknown;
				"namespace-session"?: unknown;
			};
		};
		const sysTo = h["sys-to"];
		if (!Array.isArray(sysTo) || !sysTo.every((x) => typeof x === "number")) {
			continue;
		}
		const routeKey = (sysTo as number[]).join(",");
		const f = h.fields;
		if (typeof f !== "object" || f === null) continue;
		const route = new Map<number, KeyInfo>();
		const takeMap = (node: unknown, byte2: number, nsLabel: string): void => {
			if (typeof node !== "object" || node === null) return;
			for (const [rawId, rawEntry] of Object.entries(
				node as Record<string, unknown>,
			)) {
				const keyId = Number(rawId);
				if (!Number.isInteger(keyId)) continue;
				const entry = rawEntry as { name?: unknown };
				const name = entry.name;
				if (typeof name !== "string") continue;
				route.set((byte2 << 16) | keyId, {
					name,
					source: `profiles/winbox-ipc/gui-handlers.yaml ${handlerName} ${nsLabel}`,
					tcodes: [],
				});
			}
		};
		// Singleton shape: fields: { namespace, map }.
		takeMap(f.map ?? null, 0x00, "user");
		// Row shape: fields: { namespace-user, namespace-session }.
		takeMap(f["namespace-user"], 0x00, "user");
		takeMap(f["namespace-session"], 0xfe, "session");
		if (route.size > 0) tables.routes.set(routeKey, route);
	}
}

/** Load name tables from the canonical YAML. Throws on missing files. */
export function loadNameTables(): NameTables {
	const tables: NameTables = {
		keys: new Map(),
		commands: new Map(),
		routes: new Map(),
	};
	loadKeysDoc("profiles/winbox-ipc/sys-keys.yaml", tables.keys);
	const stdKeys = new Map<number, KeyInfo>();
	loadKeysDoc("profiles/winbox-ipc/std-keys.yaml", stdKeys);
	for (const [k, v] of stdKeys) tables.keys.set(k, v);
	const cmdsDoc = parse(
		repoFile("profiles/winbox-ipc/std-commands.yaml"),
	) as CommandsDoc;
	if (!cmdsDoc || typeof cmdsDoc !== "object" || !cmdsDoc.commands) {
		throw new Error("schema-names: std-commands.yaml has no commands table");
	}
	for (const [raw, entry] of Object.entries(cmdsDoc.commands)) {
		const name = entry?.["canonical-name"];
		if (typeof name !== "string") continue;
		tables.commands.set(parseNumKey(raw), {
			name,
			source: "profiles/winbox-ipc/std-commands.yaml",
			tcodes: [],
		});
	}
	const handlersDoc = parse(
		repoFile("profiles/winbox-ipc/gui-handlers.yaml"),
	) as { handlers?: Record<string, unknown> };
	if (
		!handlersDoc ||
		typeof handlersDoc !== "object" ||
		!handlersDoc.handlers
	) {
		throw new Error("schema-names: gui-handlers.yaml has no handlers table");
	}
	loadRouteFields(handlersDoc.handlers, tables);
	return tables;
}

let cached: NameTables | null = null;

export function nameTables(): NameTables {
	if (!cached) cached = loadNameTables();
	return cached;
}

export function fallbackKey(fullKey: number): string {
	return `key_0x${fullKey.toString(16).padStart(6, "0")}`;
}

/** Resolve a global (sys/std) key name, with numeric fallback. */
export function resolveKeyName(fullKey: number): NameResolution {
	const hit = nameTables().keys.get(fullKey);
	if (!hit)
		return {
			name: null,
			reason: "absent-coverage",
			fallback: fallbackKey(fullKey),
		};
	return { name: hit.name, source: hit.source };
}

/** Resolve a std command number, with numeric fallback. */
export function resolveCommandName(cmd: number): NameResolution {
	const hit = nameTables().commands.get(cmd);
	if (!hit) {
		return {
			name: null,
			reason: "absent-coverage",
			fallback: `cmd_0x${cmd.toString(16)}`,
		};
	}
	return { name: hit.name, source: hit.source };
}

/**
 * Resolve a handler-route-scoped field (user/session namespaces).
 * Falls back to the global tables, then to numeric fallback.
 */
export function resolveRouteField(
	route: number[],
	fullKey: number,
): NameResolution {
	const routeHit = nameTables().routes.get(route.join(","))?.get(fullKey);
	if (routeHit) return { name: routeHit.name, source: routeHit.source };
	return resolveKeyName(fullKey);
}

/** Check an observed tcode against the schema's physical list. */
export function checkTcode(fullKey: number, tcode: number): TcodeCheck {
	const hit = nameTables().keys.get(fullKey);
	if (!hit) return { agree: null, reason: "absent-coverage" };
	if (hit.tcodes.length === 0)
		return { agree: null, reason: "absent-coverage" };
	if (hit.tcodes.includes(tcode)) return { agree: true };
	return {
		agree: false,
		expected: hit.tcodes.map((t) => `0x${t.toString(16)}`).join(","),
		detail:
			`${hit.name} (0x${fullKey.toString(16)}) observed tcode ` +
			`0x${tcode.toString(16)}, schema lists a different set (${hit.source})`,
	};
}
