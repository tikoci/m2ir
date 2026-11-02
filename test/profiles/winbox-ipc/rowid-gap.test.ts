// H3 rowid-gap pin: a rejected bare-tarpit add consumes exactly one rowid —
// the accept after one rejection lands *2/rowid 2 on a verified-empty table,
// explaining G1's 4-gap as 4 attempts at 1:1.
//
// The schema notes under test live in
// profiles/winbox-ipc/gui-handlers.yaml (filter-20-3). The evidence is the
// committed H3 control/native files (ws21 7.25, 2w+0r); no fixture needed —
// the claim is control-plane (.id allocation), pinned directly.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { loadYamlDoc, repoPath, required } from "./m2-replay";

interface GuiHandlersDoc {
	handlers: Record<string, { notes?: string }>;
}

const H3 = "work/2026-11-winbox-attributes/proof/H3-rowid-gap";

interface ControlEnvelope {
	ok?: unknown;
	data?: { ret?: unknown };
	meta?: { operation?: { objectCount?: unknown } };
}

function controlJson(name: string): ControlEnvelope {
	return JSON.parse(
		readFileSync(repoPath(`${H3}/${name}`), "utf8"),
	) as ControlEnvelope;
}

describe("H3 rowid-gap replay", () => {
	test("schema carries the H3 consume-one-rowid notes", () => {
		const gui = loadYamlDoc<GuiHandlersDoc>(
			"profiles/winbox-ipc/gui-handlers.yaml",
		);
		const filter = required(gui.handlers["filter-20-3"], "filter-20-3");
		expect(required(filter.notes, "filter notes")).toContain(
			"H3 rowid-gap micro-leg",
		);
		expect(required(filter.notes, "filter notes")).toContain(
			"EXACTLY ONE rowid",
		);
	});

	test("promoted evidence references resolve to tracked files", () => {
		for (const rel of [
			`${H3}/report.yaml`,
			`${H3}/fragment.yaml`,
			`${H3}/control-reject.json`,
			`${H3}/control-accept-add.json`,
			`${H3}/step-gap.jsonl`,
		]) {
			expect(existsSync(repoPath(rel))).toBe(true);
		}
	});

	test("bare tarpit rejected, accept lands *2 on the empty table", () => {
		const reject = controlJson("control-reject.json");
		expect(reject.ok).toBe(false);
		const base = controlJson("control-base-firewall-filter.json");
		expect(base.meta?.operation?.objectCount).toBe(0);
		const accept = controlJson("control-accept-add.json");
		expect(accept.ok).toBe(true);
		expect(accept.data?.ret).toBe("*2");
	});

	test("native row agrees: rowid 2 with count 1", () => {
		const lines = readFileSync(repoPath(`${H3}/step-gap.jsonl`), "utf8")
			.trim()
			.split("\n");
		let count: number | null = null;
		let rowid: number | null = null;
		for (const line of lines) {
			const r = JSON.parse(line) as {
				direction: string;
				from: [number, number] | null;
				decode?: { entries?: { key: string; value: unknown }[] };
			};
			if (r.direction !== "rx" || r.from?.[0] !== 20 || r.from?.[1] !== 3)
				continue;
			for (const e of r.decode?.entries ?? []) {
				if (e.key === "0xfe0019" && typeof e.value === "number")
					count = e.value;
				if (e.key === "0xfe0002" && Array.isArray(e.value)) {
					const rows = e.value as { key: string; value: unknown }[][];
					if (rows.length === 1) {
						const hit = required(rows[0], "row").find(
							(f) => f.key === "0xfe0001",
						);
						if (typeof hit?.value === "number") rowid = hit.value;
					}
				}
			}
		}
		expect(count).toBe(1);
		expect(rowid).toBe(2);
	});
});
