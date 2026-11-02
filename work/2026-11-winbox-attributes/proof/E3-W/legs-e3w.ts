// E3-W native write-leg helper (Phase E, worker E3-W, ws21/7.25 ONLY).
//
// Subcommands (read-only unless noted):
//   nat-read --out <jsonl>            paged GETALL [20,5], print decoded rows
//   move --row <B> --dest <A> --out <jsonl>   (WRITE) MOVEOBJ {0xfe0001=B,
//       0xfe0003=A} with before/after GETALL order read-back
//
// MOVEOBJ requires --allow-mutations --disposable. Credentials come from
// quickchr inspect; nothing secret is printed. Manifests are
// timestamp-redacted (ts dropped at write) but otherwise lossless.
//
// Usage:
//   bun work/2026-11-winbox-attributes/proof/E3-W/legs-e3w.ts nat-read \
//     --quickchr ws21 --out <jsonl>
import { unlinkSync } from "node:fs";

import { encU32, type M2Message } from "../../../2026-10-chr-extraction/ws3c/m2.ts";
import {
	buildRequest,
	CMD_GETALL,
} from "../../../2026-10-chr-extraction/ws3c/probe.ts";
import { appendCapture, type CaptureRecord, losslessMessage } from "../../harness/capture.ts";
import {
	type CorrelatedOk,
	type CorrelatedRouterError,
	correlatedRequest,
	nextReqId,
} from "../../harness/correlate.ts";
import { getAllPages, type PageFetchResult } from "../../harness/paging.ts";
import { openSession, type WinboxSession } from "../../harness/session.ts";
import { requireMutationGate, resolveLabTarget } from "../../harness/target.ts";

const CMD_MOVEOBJ = 0xfe0007;
const ROUTE_NAT = [20, 5];
const F_ROWID = 0xfe0001;
const F_START = 0xfe0003;

function usage(): never {
	console.error(
		"usage: legs-e3w.ts (nat-read --out <jsonl> | move --row <B> --dest <A> --out <jsonl>) " +
			"--quickchr <name> [--allow-mutations --disposable] [--timeout <ms>]",
	);
	process.exit(2);
}

function rowIdOf(row: M2Message): number | null {
	for (const e of losslessMessage(row)) {
		if (e.key === "0xfe0001" && typeof e.value === "number") return e.value;
	}
	return null;
}

function fieldStr(row: M2Message): string {
	return losslessMessage(row)
		.map((e) => `${e.key}=${JSON.stringify(e.value)}`)
		.join(" ");
}

function orderOf(rows: M2Message[]): string {
	return rows
		.map((r) => {
			const c =
				losslessMessage(r).find((e) => e.key === "0xfe0009")?.value ?? "";
			return `${c}#${rowIdOf(r)}`;
		})
		.join(",");
}

async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	const sub = argv[0] ?? "";
	if (sub !== "nat-read" && sub !== "move") usage();
	let machine = "";
	let out = "";
	let rowB = -1;
	let destA = -1;
	let allowMutations = false;
	let disposable = false;
	let timeoutMs = 8000;
	for (let i = 1; i < argv.length; i++) {
		const t = argv[i] ?? "";
		if (t === "--quickchr") machine = argv[++i] ?? "";
		else if (t === "--out") out = argv[++i] ?? "";
		else if (t === "--row") rowB = Number(argv[++i] ?? "-1");
		else if (t === "--dest") destA = Number(argv[++i] ?? "-1");
		else if (t === "--allow-mutations") allowMutations = true;
		else if (t === "--disposable") disposable = true;
		else if (t === "--timeout") timeoutMs = Number(argv[++i] ?? "8000");
		else usage();
	}
	if (!machine || !out) usage();
	if (machine !== "ws21") throw new Error(`E3-W runs on ws21 ONLY (got ${machine})`);
	if (sub === "move") {
		if (rowB < 0 || destA < 0) usage();
		requireMutationGate({ allowMutations, disposable }, "E3-W MOVEOBJ probe");
	}

	const target = resolveLabTarget(machine, { allowedVersions: ["7.25"] });
	const session: WinboxSession = await openSession(
		target.host,
		target.port,
		target.user,
		target.pass,
		{ timeoutMs },
	);
	let reqId = 1;
	const captures: CaptureRecord[] = [];
	const onCapture = (rec: CaptureRecord): void => {
		rec.seq = captures.length;
		captures.push(rec);
	};

	const nativeGetAll = async (label: string): Promise<M2Message[]> => {
		const paged = await getAllPages(
			async (start: number | null): Promise<PageFetchResult> => {
				reqId = nextReqId(reqId);
				const extra = start === null ? [] : [encU32(F_START, start)];
				const res = await correlatedRequest(
					session.transport,
					buildRequest(ROUTE_NAT, CMD_GETALL, session.sourceId, reqId, extra),
					reqId,
					{ timeoutMs, onCapture },
				);
				if (res.status === "ok") return { status: "ok", page: res.reply };
				throw new Error(`${label}: GETALL page failed: ${res.status}`);
			},
		);
		if (!paged.complete)
			throw new Error(`${label}: GETALL incomplete: ${paged.cause}`);
		return paged.rows as M2Message[];
	};

	try {
		if (sub === "nat-read") {
			const rows = await nativeGetAll("nat-read");
			console.log(`nat-read: rows=${rows.length}`);
			for (const r of rows) console.log(`  row: ${fieldStr(r)}`);
		} else {
			const before = await nativeGetAll("move-before");
			const beforeOrder = orderOf(before);
			console.log(`move: before order=${beforeOrder}`);
			reqId = nextReqId(reqId);
			const res = await correlatedRequest(
				session.transport,
				buildRequest(ROUTE_NAT, CMD_MOVEOBJ, session.sourceId, reqId, [
					encU32(F_ROWID, rowB),
					encU32(F_START, destA),
				]),
				reqId,
				{ timeoutMs, onCapture },
			);
			if (res.status !== "ok" && res.status !== "router-error") {
				throw new Error(`move: probe transport failed: ${res.status}`);
			}
			const probe = res as CorrelatedOk | CorrelatedRouterError;
			console.log(
				`move: probe status=${probe.status} errno=${probe.status === "router-error" ? probe.errno : "-"} errstr=${JSON.stringify(probe.errstr)}`,
			);
			const after = await nativeGetAll("move-after");
			const afterOrder = orderOf(after);
			console.log(`move: after order=${afterOrder}`);
			console.log(`move: order-changed=${afterOrder !== beforeOrder}`);
		}
	} finally {
		session.close();
	}
	try {
		unlinkSync(out);
	} catch {
		// Absent is fine.
	}
	for (const rec of captures) appendCapture(out, { ...rec, ts: "redacted" });
	console.log(`legs: manifest ${out} records=${captures.length}`);
}

if (import.meta.main) {
	main().catch((e: unknown) => {
		console.error(`legs: ${(e as Error).message}`);
		process.exit(1);
	});
}
