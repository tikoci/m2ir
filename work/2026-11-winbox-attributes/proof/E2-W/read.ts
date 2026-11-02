// E2-W native reader: paged GETALL [20,1] xN (reads only, zero writes).
//
// Usage:
//   bun read.ts --quickchr <name> --out <dir> --tag <tag> [--times <n>]
//
// Appends sanitized captures (ts stripped) to native-<name>.jsonl and
// writes step-<tag>.json with the per-read row shapes. Exits nonzero
// on any incomplete page chain or transport failure.
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { encU32, type M2Message } from "../../../2026-10-chr-extraction/ws3c/m2.ts";
import {
	buildRequest,
	CMD_GETALL,
} from "../../../2026-10-chr-extraction/ws3c/probe.ts";
import {
	type CaptureRecord,
	losslessMessage,
} from "../../harness/capture.ts";
import { correlatedRequest, nextReqId } from "../../harness/correlate.ts";
import { getAllPages, type PageFetchResult } from "../../harness/paging.ts";
import { openSession } from "../../harness/session.ts";
import { resolveLabTarget } from "../../harness/target.ts";

function usage(): never {
	console.error(
		"usage: read.ts --quickchr <name> --out <dir> --tag <tag> [--times <n>] [--timeout <ms>]",
	);
	process.exit(2);
}

async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	let machine = "";
	let outDir = "";
	let tag = "";
	let times = 1;
	let timeoutMs = 8000;
	for (let i = 0; i < argv.length; i++) {
		const t = argv[i] ?? "";
		if (t === "--quickchr") machine = argv[++i] ?? "";
		else if (t === "--out") outDir = argv[++i] ?? "";
		else if (t === "--tag") tag = argv[++i] ?? "";
		else if (t === "--times") times = Number(argv[++i] ?? "1");
		else if (t === "--timeout") timeoutMs = Number(argv[++i] ?? "8000");
		else usage();
	}
	if (!machine || !outDir || !tag || times < 1) usage();
	if (machine !== "ws20") throw new Error(`E2-W: refusing non-ws20 target ${machine}`);
	mkdirSync(outDir, { recursive: true });

	const target = resolveLabTarget(machine, { allowedVersions: ["7.25"] });
	console.log(`read: target=${machine} version=${target.version} tag=${tag} times=${times}`);

	const session = await openSession(target.host, target.port, target.user, target.pass, {
		timeoutMs,
	});
	let reqId = 1;
	const captures: CaptureRecord[] = [];
	const onCapture = (rec: CaptureRecord): void => {
		captures.push(rec);
	};

	const fetchPage = async (start: number | null): Promise<PageFetchResult> => {
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
			return { status: "error", page: res.reply, errno: res.errno, errstr: res.errstr };
		}
		throw new Error(`read: GETALL [20,1] page failed: ${res.status}`);
	};

	try {
		const reads: unknown[] = [];
		for (let n = 0; n < times; n++) {
			const paged = await getAllPages(fetchPage);
			if (!paged.complete) throw new Error(`read: incomplete chain: ${paged.cause}`);
			reads.push({
				rows: paged.rows.map((r: M2Message) => losslessMessage(r)),
				pages: paged.pages,
				complete: true,
			});
			console.log(`read: [20,1] #${n + 1} rows=${paged.rows.length} pages=${paged.pages}`);
		}
		let identical: boolean | null = null;
		if (reads.length > 1) {
			identical = reads.every((r) => JSON.stringify(r) === JSON.stringify(reads[0]));
			console.log(`read: volatility identical=${identical}`);
		}

		// Append sanitized captures with global seq numbering.
		const jsonlPath = join(outDir, `native-${machine}.jsonl`);
		let base = 0;
		if (existsSync(jsonlPath)) {
			const text = await Bun.file(jsonlPath).text();
			base = text.split("\n").filter((l) => l.length > 0).length;
		}
		const lines = captures.map((rec, i) => {
			const { ts: _ts, ...rest } = rec;
			return JSON.stringify({ ...rest, seq: base + i, tag });
		});
		appendFileSync(jsonlPath, `${lines.join("\n")}\n`, "utf8");

		writeFileSync(
			join(outDir, `step-${tag}.json`),
			`${JSON.stringify({ proof: "E2-W", machine, tag, reads, volatility_identical: identical }, null, 2)}\n`,
		);
		console.log(`read: wrote step-${tag}.json + ${captures.length} captures`);
	} finally {
		session.close();
	}
}

if (import.meta.main) {
	main().catch((e: unknown) => {
		console.error(`read: ${(e as Error).message}`);
		process.exit(1);
	});
}
