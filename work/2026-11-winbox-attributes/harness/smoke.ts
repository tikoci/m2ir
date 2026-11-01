// Phase B live smoke (read-only): authenticate to a disposable 7.25 CHR,
// fetch complete identity + ip/address lists through the hardened path
// (capture + correlation + pagination), and write a JSONL manifest.
//
// Usage:
//   bun work/2026-11-winbox-attributes/harness/smoke.ts --quickchr twin3 --out /tmp/smoke.jsonl
//
// Never runs in CI. No mutations: GET and bare/token GETALL only.
// Credentials come from quickchr inspect; nothing secret is printed.
import { unlinkSync } from "node:fs";

import { encU32 } from "../../2026-10-chr-extraction/ws3c/m2.ts";
import {
	buildRequest,
	CMD_GET,
	CMD_GETALL,
} from "../../2026-10-chr-extraction/ws3c/probe.ts";
import { appendCapture, type CaptureRecord } from "./capture.ts";
import { correlatedRequest, nextReqId } from "./correlate.ts";
import { getAllPages, type PageFetchResult } from "./paging.ts";
import { openSession } from "./session.ts";
import { resolveLabTarget } from "./target.ts";

function usage(): never {
	console.error(
		"usage: smoke.ts --quickchr <name> --out <manifest.jsonl> [--timeout <ms>]",
	);
	process.exit(2);
}

async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	let machine = "";
	let out = "";
	let timeoutMs = 8000;
	for (let i = 0; i < argv.length; i++) {
		const t = argv[i] ?? "";
		if (t === "--quickchr") machine = argv[++i] ?? "";
		else if (t === "--out") out = argv[++i] ?? "";
		else if (t === "--timeout") timeoutMs = Number(argv[++i] ?? "8000");
		else usage();
	}
	if (!machine || !out) usage();

	const target = resolveLabTarget(machine, { allowedVersions: ["7.25"] });
	console.log(
		`smoke: target=${machine} version=${target.version} port=${target.port}`,
	);

	const captures: CaptureRecord[] = [];
	const onCapture = (rec: CaptureRecord): void => {
		rec.seq = captures.length;
		captures.push(rec);
	};

	const session = await openSession(
		target.host,
		target.port,
		target.user,
		target.pass,
		{
			timeoutMs,
		},
	);
	console.log(`smoke: auth OK sourceId=${session.sourceId}`);
	try {
		let reqId = 1;
		// 1. Identity GET_ONE [24,1].
		reqId = nextReqId(reqId);
		const getRes = await correlatedRequest(
			session.transport,
			buildRequest([24, 1], CMD_GET, session.sourceId, reqId, []),
			reqId,
			{ timeoutMs, onCapture },
		);
		if (getRes.status !== "ok") {
			throw new Error(`smoke: identity GET failed: ${getRes.status}`);
		}
		console.log(
			`smoke: identity fields=${getRes.reply.entries.length} statusWord=${getRes.statusWord ?? "absent"}`,
		);
		// 2. Paged GETALL [20,1].
		const paged = await getAllPages(
			async (start: number | null): Promise<PageFetchResult> => {
				reqId = nextReqId(reqId);
				const extra = start === null ? [] : [encU32(0xfe0003, start)];
				const res = await correlatedRequest(
					session.transport,
					buildRequest([20, 1], CMD_GETALL, session.sourceId, reqId, extra),
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
				throw new Error(`smoke: GETALL page failed: ${res.status}`);
			},
		);
		if (!paged.complete) {
			throw new Error(`smoke: GETALL incomplete: ${paged.cause}`);
		}
		console.log(
			`smoke: ip/address rows=${paged.rows.length} pages=${paged.pages}`,
		);
	} finally {
		session.close();
	}

	try {
		unlinkSync(out);
	} catch {
		// Absent manifest is fine; anything else surfaces on append.
	}
	for (const rec of captures) appendCapture(out, rec);
	console.log(`smoke: manifest ${out} records=${captures.length}`);
}

if (import.meta.main) {
	main().catch((e: unknown) => {
		console.error(`smoke: ${(e as Error).message}`);
		process.exit(1);
	});
}
