// W2r native GETALL helper (Phase E, worker W2r).
//
// Native WinBox reads ONLY: paged GETALL for the listed routes.
// No writes of any kind. Credentials from quickchr inspect; nothing secret printed.
//
// Usage:
//   bun work/2026-11-winbox-attributes/proof/E1-W2r/getall-w2r.ts \
//     --quickchr twin3 --tag cell-A --routes 16,13;16,2;20,0 \
//     --out work/2026-11-winbox-attributes/proof/E1-W2r/step-cell-A.jsonl
//
// Prints one summary line per route; writes lossless capture records to --out
// (timestamp-redacted at write: ts dropped, plaintextHex + entries kept).
import { unlinkSync } from "node:fs";

import {
	encU32,
	type M2Message,
} from "../../../2026-10-chr-extraction/ws3c/m2.ts";
import {
	buildRequest,
	CMD_GETALL,
} from "../../../2026-10-chr-extraction/ws3c/probe.ts";
import { appendCapture, type CaptureRecord } from "../../harness/capture.ts";
import { correlatedRequest, nextReqId } from "../../harness/correlate.ts";
import { getAllPages, type PageFetchResult } from "../../harness/paging.ts";
import { openSession } from "../../harness/session.ts";
import { resolveLabTarget } from "../../harness/target.ts";

function usage(): never {
	console.error(
		"usage: getall-w2r.ts --quickchr <name> --tag <tag> --routes <a,b;c,d> --out <step.jsonl> [--timeout <ms>]",
	);
	process.exit(2);
}

function fmtVal(v: unknown): string {
	if (Array.isArray(v)) return `[${v.map((x) => String(x)).join(",")}]`;
	if (typeof v === "string") return JSON.stringify(v);
	if (typeof v === "bigint") return `${v}n`;
	if (v instanceof Uint8Array) return `bytes:${Buffer.from(v).toString("hex")}`;
	return String(v);
}

function summarizeRow(m: M2Message): string {
	const parts = m.entries.map((e) => {
		const key =
			e.fullKey >= 0xfe0000
				? `0x${e.fullKey.toString(16)}`
				: `${e.fullKey & 0xffff}`;
		return `${key}=${fmtVal(e.value)}`;
	});
	return `{${parts.join(" ")}}`;
}

async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	let machine = "";
	let tag = "";
	let routesRaw = "";
	let out = "";
	let timeoutMs = 8000;
	for (let i = 0; i < argv.length; i++) {
		const t = argv[i] ?? "";
		if (t === "--quickchr") machine = argv[++i] ?? "";
		else if (t === "--tag") tag = argv[++i] ?? "";
		else if (t === "--routes") routesRaw = argv[++i] ?? "";
		else if (t === "--out") out = argv[++i] ?? "";
		else if (t === "--timeout") timeoutMs = Number(argv[++i] ?? "8000");
		else usage();
	}
	if (!machine || !tag || !routesRaw || !out) usage();
	const routes = routesRaw.split(";").map((r) => r.split(",").map(Number));

	const target = resolveLabTarget(machine, { allowedVersions: ["7.25"] });
	console.log(
		`getall[${tag}]: target=${machine} version=${target.version} winbox-port=${target.port}`,
	);

	const captures: CaptureRecord[] = [];
	const onCapture = (rec: CaptureRecord): void => {
		rec.seq = captures.length;
		// Redact wall-clock timestamps at write; keep bytes + decode.
		rec.ts = "";
		captures.push(rec);
	};

	const session = await openSession(
		target.host,
		target.port,
		target.user,
		target.pass,
		{ timeoutMs },
	);
	console.log(`getall[${tag}]: auth OK sourceId=${session.sourceId}`);
	try {
		let reqId = 1;
		for (const route of routes) {
			const paged = await getAllPages(
				async (start: number | null): Promise<PageFetchResult> => {
					reqId = nextReqId(reqId);
					const extra = start === null ? [] : [encU32(0xfe0003, start)];
					const res = await correlatedRequest(
						session.transport,
						buildRequest(route, CMD_GETALL, session.sourceId, reqId, extra),
						reqId,
						{ timeoutMs, onCapture },
					);
					if (res.status === "ok") return { status: "ok", page: res.reply };
					if (res.status === "router-error") {
						return {
							status: "error",
							page: res.reply,
							errno: res.errno,
							errstr: res.errstr,
						};
					}
					throw new Error(
						`getall[${tag}]: [${route}] page failed: ${res.status}`,
					);
				},
			);
			if (!paged.complete) {
				throw new Error(`getall[${tag}]: [${route}] incomplete: ${paged.cause}`);
			}
			console.log(
				`getall[${tag}]: [${route}] rows=${paged.rows.length} pages=${paged.pages}`,
			);
			for (const row of paged.rows) console.log(`  row: ${summarizeRow(row)}`);
		}
	} finally {
		session.close();
	}

	try {
		unlinkSync(out);
	} catch {
		// Absent manifest is fine.
	}
	for (const rec of captures) appendCapture(out, rec);
	console.log(`getall[${tag}]: manifest ${out} records=${captures.length}`);
}

if (import.meta.main) {
	main().catch((e: unknown) => {
		console.error(`getall: ${(e as Error).message}`);
		process.exit(1);
	});
}
