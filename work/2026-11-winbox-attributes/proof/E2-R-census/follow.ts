// E2-R follow-up: bounded read-only row-shape probe of sweep-found slots.
// Usage: bun follow.ts --quickchr <name> --out <dir> --slots 28,38 [--timeout <ms>]
// Per slot: one paged GETALL (maxPages 5) + one GETOBJ obj=1. ZERO writes.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
	encU32,
	type M2Message,
} from "../../../2026-10-chr-extraction/ws3c/m2.ts";
import {
	buildRequest,
	CMD_GETALL,
	CMD_GETOBJ,
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
	console.error("usage: follow.ts --quickchr <name> --out <dir> --slots 28,38 [--timeout <ms>]");
	process.exit(2);
}

function hex(n: number): string {
	return `0x${n.toString(16)}`;
}

async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	let machine = "";
	let outDir = "";
	let slots: number[] = [];
	let timeoutMs = 8000;
	for (let i = 0; i < argv.length; i++) {
		const t = argv[i] ?? "";
		if (t === "--quickchr") machine = argv[++i] ?? "";
		else if (t === "--out") outDir = argv[++i] ?? "";
		else if (t === "--slots")
			slots = (argv[++i] ?? "").split(",").map(Number).filter(Number.isInteger);
		else if (t === "--timeout") timeoutMs = Number(argv[++i] ?? "8000");
		else usage();
	}
	if (!machine || !outDir || slots.length === 0) usage();
	mkdirSync(outDir, { recursive: true });

	const target = resolveLabTarget(machine);
	console.log(`follow: target=${machine} version=${target.version} slots=${slots.join(",")}`);

	const captures: CaptureRecord[] = [];
	const onCapture = (rec: CaptureRecord): void => {
		rec.seq = captures.length;
		captures.push(rec);
	};
	const session = await openSession(target.host, target.port, target.user, target.pass, {
		timeoutMs,
	});
	let reqId = 1;
	const out: Record<string, unknown> = {};
	try {
		for (const h of slots) {
			const to = [20, h];
			const paged = await getAllPages(
				async (start: number | null): Promise<PageFetchResult> => {
					reqId = nextReqId(reqId);
					const extra = start === null ? [] : [encU32(0xfe0003, start)];
					const res = await correlatedRequest(
						session.transport,
						buildRequest(to, CMD_GETALL, session.sourceId, reqId, extra),
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
					throw new Error(`follow: [${to}] page failed: ${res.status}`);
				},
				{ maxPages: 5 },
			);
			const entry: { getall: unknown; getobj?: unknown } = {
				getall: {
					complete: paged.complete,
					rows: paged.rows.map((r: M2Message) => losslessMessage(r)),
					pages: paged.pages,
					...(paged.complete ? {} : { cause: paged.cause }),
				},
			};
			reqId = nextReqId(reqId);
			const go = await correlatedRequest(
				session.transport,
				buildRequest(to, CMD_GETOBJ, session.sourceId, reqId, [encU32(0xfe0001, 1)]),
				reqId,
				{ timeoutMs, onCapture },
			);
			entry.getobj =
				go.status === "ok"
					? { status: "ok", row: losslessMessage(go.reply) }
					: go.status === "router-error"
						? {
								status: "router-error",
								errno: go.errno === null ? null : hex(go.errno),
								errstr: go.errstr,
							}
						: { status: go.status };
			out[`20-${h}`] = entry;
			console.log(
				`follow: [20,${h}] getall rows=${paged.rows.length} complete=${paged.complete} getobj=${(entry.getobj as { status: string }).status}`,
			);
		}
		const summary = {
			proof: "E2-R sweep follow-up",
			machine,
			routeros_version: target.version,
			zero_writes: true,
			slots: out,
		};
		writeFileSync(
			join(outDir, `follow-${machine}.json`),
			`${JSON.stringify(summary, null, 2)}\n`,
		);
		const strip = (rec: CaptureRecord): unknown => {
			const { ts: _ts, ...rest } = rec;
			return rest;
		};
		writeFileSync(
			join(outDir, `follow-${machine}.jsonl`),
			`${captures.map((r) => JSON.stringify(strip(r))).join("\n")}\n`,
		);
		console.log(`follow: wrote follow-${machine}.json(.jsonl ${captures.length})`);
	} finally {
		session.close();
	}
}

if (import.meta.main) {
	main().catch((e: unknown) => {
		console.error(`follow: ${(e as Error).message}`);
		process.exit(1);
	});
}
