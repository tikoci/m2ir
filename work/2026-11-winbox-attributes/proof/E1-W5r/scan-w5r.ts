// W5r native scan helper (Phase E, worker W5r).
//
// Native WinBox reads ONLY: [16,0..32] GETCOUNT census + paged GETALL.
// No writes of any kind. Credentials from quickchr inspect; nothing secret printed.
//
// Usage:
//   bun work/2026-11-winbox-attributes/proof/E1-W5r/scan-w5r.ts \
//     --quickchr twin3 --tag baseline --census --routes 16,2 \
//     --out work/2026-11-winbox-attributes/proof/E1-W5r/step-baseline.jsonl \
//     --summary work/2026-11-winbox-attributes/proof/E1-W5r/census-baseline.json
//
// Prints one summary line per census cell and per GETALL route; writes
// lossless capture records to --out (timestamp-redacted at write: ts
// dropped, plaintextHex + entries kept) and the census/row summary to
// --summary (no hosts, ports, or secrets).
import { unlinkSync, writeFileSync } from "node:fs";

import {
	encU32,
	findEntry,
	type M2Message,
} from "../../../2026-10-chr-extraction/ws3c/m2.ts";
import {
	buildRequest,
	CMD_GETALL,
} from "../../../2026-10-chr-extraction/ws3c/probe.ts";
import {
	appendCapture,
	type CaptureRecord,
	losslessMessage,
} from "../../harness/capture.ts";
import { correlatedRequest, nextReqId } from "../../harness/correlate.ts";
import { getAllPages, type PageFetchResult } from "../../harness/paging.ts";
import { openSession } from "../../harness/session.ts";
import { resolveLabTarget } from "../../harness/target.ts";

const CMD_GETCOUNT = 0xfe0015;

function usage(): never {
	console.error(
		"usage: scan-w5r.ts --quickchr <name> --tag <tag> --out <step.jsonl> --summary <summary.json> [--census] [--routes <a,b;c,d>] [--timeout <ms>]",
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
			e.fullKey >= 0xfe0000 ? `0x${e.fullKey.toString(16)}` : `${e.fullKey & 0xffff}`;
		return `${key}=${fmtVal(e.value)}`;
	});
	return `{${parts.join(" ")}}`;
}

function hex(n: number): string {
	return `0x${n.toString(16)}`;
}

async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	let machine = "";
	let tag = "";
	let out = "";
	let summaryPath = "";
	let census = false;
	let routesRaw = "";
	let timeoutMs = 8000;
	for (let i = 0; i < argv.length; i++) {
		const t = argv[i] ?? "";
		if (t === "--quickchr") machine = argv[++i] ?? "";
		else if (t === "--tag") tag = argv[++i] ?? "";
		else if (t === "--out") out = argv[++i] ?? "";
		else if (t === "--summary") summaryPath = argv[++i] ?? "";
		else if (t === "--census") census = true;
		else if (t === "--routes") routesRaw = argv[++i] ?? "";
		else if (t === "--timeout") timeoutMs = Number(argv[++i] ?? "8000");
		else usage();
	}
	if (!machine || !tag || !out || !summaryPath) usage();
	if (machine !== "twin3") {
		throw new Error(`scan-w5r: refusing non-twin3 target ${machine}`);
	}
	const routes = routesRaw
		? routesRaw.split(";").map((r) => r.split(",").map(Number))
		: [];

	const target = resolveLabTarget(machine, { allowedVersions: ["7.25"] });
	console.log(`scan[${tag}]: target=${machine} version=${target.version}`);

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
	console.log(`scan[${tag}]: auth OK sourceId=${session.sourceId}`);

	const summary: Record<string, unknown> = {
		proof: "E1-W5r native scan",
		machine,
		routeros_version: target.version,
		tag,
		zero_writes: true,
	};
	try {
		let reqId = 1;
		if (census) {
			const cells: unknown[] = [];
			for (let h = 0; h <= 32; h++) {
				reqId = nextReqId(reqId);
				const res = await correlatedRequest(
					session.transport,
					buildRequest([16, h], CMD_GETCOUNT, session.sourceId, reqId, []),
					reqId,
					{ timeoutMs, onCapture },
				);
				if (res.status === "ok") {
					const c19 = findEntry(res.reply, 0xfe0019);
					const c14 = findEntry(res.reply, 0xfe0014);
					const count19 =
						typeof c19?.value === "number" ? c19.value : null;
					const count14 =
						typeof c14?.value === "number" ? c14.value : null;
					cells.push({ slot: h, status: "ok", count19, count14 });
					console.log(
						`scan[${tag}]: [16,${h}] ok c19=${count19} c14=${count14}`,
					);
				} else if (res.status === "router-error") {
					cells.push({
						slot: h,
						status: "router-error",
						errno: res.errno === null ? null : hex(res.errno),
						errstr: res.errstr,
					});
					console.log(
						`scan[${tag}]: [16,${h}] router-error errno=${res.errno === null ? null : hex(res.errno)} errstr=${JSON.stringify(res.errstr)}`,
					);
				} else {
					throw new Error(
						`scan[${tag}]: [16,${h}] GETCOUNT failed: ${res.status}`,
					);
				}
			}
			const okCount = cells.filter(
				(c) => (c as { status: string }).status === "ok",
			).length;
			const censusKey = "census_16_0_32";
			summary[censusKey] = { total_slots: 33, ok_slots: okCount, cells };
			console.log(`scan[${tag}]: census [16,0..32] ok=${okCount}/33`);
		}
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
						`scan[${tag}]: [${route}] page failed: ${res.status}`,
					);
				},
			);
			if (!paged.complete) {
				throw new Error(`scan[${tag}]: [${route}] incomplete: ${paged.cause}`);
			}
			console.log(
				`scan[${tag}]: [${route}] rows=${paged.rows.length} pages=${paged.pages}`,
			);
			for (const row of paged.rows) console.log(`  row: ${summarizeRow(row)}`);
			summary[`getall-${route.join("-")}`] = {
				rows: paged.rows.length,
				pages: paged.pages,
				complete: true,
				shapes: paged.rows.map((r) => losslessMessage(r)),
			};
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
	writeFileSync(summaryPath, `${JSON.stringify(summary, null, "\t")}\n`);
	console.log(
		`scan[${tag}]: manifest ${out} records=${captures.length} summary=${summaryPath}`,
	);
}

if (import.meta.main) {
	main().catch((e: unknown) => {
		console.error(`scan-w5r: ${(e as Error).message}`);
		process.exit(1);
	});
}
