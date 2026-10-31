// WS-3B: emit per-version process-ID maps from loader .x3 files.
// Usage: bun work/2026-10-chr-extraction/process-map.ts
// Reads extracted trees from ~/.local/share/m2ir/extractions/ (kept OUT of
// the repo: the trees contain absolute symlinks such as var/tmp -> /tmp that
// send repo-wide tool traversal into /tmp and OOM `bun test`. Never extract
// under work/ — see README.md).
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { parseX3 } from "./x3parse.ts";

const EXTR = join(homedir(), ".local/share/m2ir/extractions");

function collectX3(roots: string[], sub: string): string[] {
	const files: string[] = [];
	const walk = (d: string) => {
		for (const e of readdirSync(d, { withFileTypes: true })) {
			const p = join(d, e.name);
			if (e.isDirectory()) walk(p);
			else if (p.includes(sub) && p.endsWith(".x3")) files.push(p);
		}
	};
	for (const r of roots) walk(r);
	return files.sort();
}

interface ProcEntry {
	id: number;
	path: string | null;
	on_disk: boolean;
	flags: Record<string, unknown>;
	src: string;
}

function buildMap(
	version: string,
	loaderRoots: string[],
	binDir: string,
	out: string,
): void {
	const disk = new Set(readdirSync(binDir));
	const map: ProcEntry[] = [];
	for (const f of loaderRoots) {
		const r = parseX3(new Uint8Array(readFileSync(f)), f);
		if (!r.ok || !r.root) {
			console.log(`FAIL ${f}: ${r.errs.slice(0, 2).join("; ")}`);
			continue;
		}
		for (const k of r.root.kids) {
			const g = (id: number) => k.attrs.find((a) => a.id === id);
			const id = g(4)?.vals[0] ?? -1;
			const path = g(7)?.text ?? null;
			const base = path?.split("/").pop();
			const flags: Record<string, unknown> = {};
			for (const a of k.attrs) {
				if (a.id === 4 || a.id === 7) continue;
				flags[a.id] =
					a.vals.length === 1 && String(a.vals[0]) === a.text
						? a.vals[0]
						: { vals: a.vals, text: a.text };
			}
			map.push({
				id,
				path,
				on_disk: base ? disk.has(base) : false,
				flags,
				src: f.replace(`${EXTR}/`, "extractions/"),
			});
		}
	}
	map.sort((a, b) => a.id - b.id);
	writeFileSync(out, `${JSON.stringify(map, null, 1)}\n`);
	console.log(`${version}: ${map.length} entries -> ${out}`);
}

const R6 = join(EXTR, "root-6.49.23");
const DUDE = join(EXTR, "dude-6.49.23");
buildMap(
	"6.49.23",
	[
		...collectX3([join(R6, "bndl"), DUDE], "/loader/"),
		join(R6, "nova/etc/loader/system.x3"),
	],
	join(R6, "nova/bin"),
	"work/2026-10-chr-extraction/process-map-6.49.23.json",
);
