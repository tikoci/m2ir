// cspell:ignore webfig
/**
 * Download every .jg descriptor a router serves to WebFig.
 *
 *   bun jg-fetch.ts <http-base, e.g. http://127.0.0.1:9120> <out-dir>
 *
 * WebFig lists files at /webfig/list (one JS object per line: crc, size,
 * name, unique, version) and serves each at /webfig/<unique>. No login is
 * needed. WinBox receives the same files over its own session. The files are
 * MikroTik's: keep them in scratch or .scratch/, never commit them.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [base, outDir] = process.argv.slice(2) as [string, string];
if (!base || !outDir) {
	console.error("usage: bun jg-fetch.ts <http-base> <out-dir>");
	process.exit(2);
}
const res = await fetch(`${base}/webfig/list`);
if (!res.ok) throw new Error(`GET ${base}/webfig/list: HTTP ${res.status}`);
const list = await res.text();
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "list"), list);
const entries = [
	...list.matchAll(
		/name: "([^"]+\.jg)", unique: "([^"]+)"(?:, version: "([^"]+)")?/g,
	),
];
if (!entries.length) throw new Error(`no .jg entries in ${base}/webfig/list`);
for (const [, name, unique, version] of entries) {
	const r = await fetch(`${base}/webfig/${unique}`);
	if (!r.ok) throw new Error(`GET /webfig/${unique}: HTTP ${r.status}`);
	writeFileSync(join(outDir, name as string), await r.text());
	console.log(`${version ?? "?"} ${name} (${unique})`);
}
