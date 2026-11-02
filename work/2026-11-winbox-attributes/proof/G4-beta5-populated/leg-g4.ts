// G4 leg script: native paged-GETALL reads for the beta5 populated-shapes leg.
//
// Reads ONLY (no mutation path): `read --out <jsonl>` runs paged GETALL on
// [16,2] (bridge ports), [16,13] (bridge vlans), [20,1] (addresses), and
// [20,0] (interfaces, for rowid resolution), appending lossless captures.
//
// Usage:
//   bun work/2026-11-winbox-attributes/proof/G4-beta5-populated/leg-g4.ts --quickchr g4beta5 --allowed-version 7.26beta5 read --out <step.jsonl>

import { encU32 } from "../../../2026-10-chr-extraction/ws3c/m2.ts";
import {
	buildRequest,
	CMD_GETALL,
} from "../../../2026-10-chr-extraction/ws3c/probe.ts";
import { appendCapture, type CaptureRecord } from "../../harness/capture.ts";
import {
	correlatedRequest,
	nextReqId,
} from "../../harness/correlate.ts";
import { getAllPages, type PageFetchResult } from "../../harness/paging.ts";
import { openSession, type WinboxSession } from "../../harness/session.ts";
import { resolveLabTarget } from "../../harness/target.ts";

const ROUTES: number[][] = [
	[16, 2],
	[16, 13],
	[20, 1],
	[20, 0],
];

function usage(): never {
	console.error(
		"usage: leg-g4.ts --quickchr <name> --allowed-version <v> read --out <jsonl>",
	);
	process.exit(2);
}

async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	let machine = "";
	let allowedVersion = "";
	let sub = "";
	let out = "";
	let timeoutMs = 8000;
	for (let i = 0; i < argv.length; i++) {
		const t = argv[i] ?? "";
		if (t === "--quickchr") machine = argv[++i] ?? "";
		else if (t === "--allowed-version") allowedVersion = argv[++i] ?? "";
		else if (t === "--out") out = argv[++i] ?? "";
		else if (t === "--timeout") timeoutMs = Number(argv[++i] ?? "8000");
		else if (t === "read") sub = t;
		else usage();
	}
	if (!machine || !allowedVersion || sub !== "read" || !out) usage();

	const target = resolveLabTarget(machine, {
		allowedVersions: [allowedVersion],
	});
	const captures: CaptureRecord[] = [];
	const onCapture = (rec: CaptureRecord): void => {
		rec.seq = captures.length;
		captures.push(rec);
	};
	const session: WinboxSession = await openSession(
		target.host,
		target.port,
		target.user,
		target.pass,
		{ timeoutMs },
	);
	let reqId = 1;
	const summary: string[] = [];
	try {
		for (const route of ROUTES) {
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
					throw new Error(`leg-g4 read: GETALL page failed: ${res.status}`);
				},
			);
			summary.push(
				`[${route}] rows=${paged.rows.length} pages=${paged.pages} complete=${paged.complete}`,
			);
		}
		console.log(`read: ${summary.join(" ")}`);
	} finally {
		session.close();
	}
	for (const rec of captures) {
		appendCapture(out, { ...rec, ts: "redacted" });
	}
	console.log(`leg-g4: read records=${captures.length} out=${out}`);
}

if (import.meta.main) {
	main().catch((e: unknown) => {
		console.error(`leg-g4: ${(e as Error).message}`);
		process.exit(1);
	});
}
