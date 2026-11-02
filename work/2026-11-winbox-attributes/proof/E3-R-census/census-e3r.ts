// E3-R read-only firewall/services census (Phase E, worker E3-R).
//
// Native WinBox reads ONLY: GET / GETALL (paged) / GETOBJ / GETCOUNT.
// No SET/ADD/REMOVE/MOVE, no centrs writes, no provisioning changes.
//
// Usage:
//   bun work/2026-11-winbox-attributes/proof/E3-R-census/census-e3r.ts \
//     --quickchr ws21 --allowed-version 7.25 \
//     --out work/2026-11-winbox-attributes/proof/E3-R-census/step-7.25-census.jsonl \
//     --summary work/2026-11-winbox-attributes/proof/E3-R-census/summary-7.25.json
//
// Credentials come from quickchr inspect; nothing secret is printed.
// Committed manifests are timestamp-redacted (ts dropped at write) but
// otherwise lossless: full plaintextHex + decoded entries preserved.
import { unlinkSync } from "node:fs";

import { encStr, encU32, type M2Message } from "../../../2026-10-chr-extraction/ws3c/m2.ts";
import {
	buildRequest,
	CMD_GET,
	CMD_GETALL,
	CMD_GETOBJ,
} from "../../../2026-10-chr-extraction/ws3c/probe.ts";
import { appendCapture, type CaptureRecord } from "../../harness/capture.ts";
import {
	type CorrelatedOutcome,
	correlatedRequest,
	nextReqId,
} from "../../harness/correlate.ts";
import { getAllPages, type PageFetchResult } from "../../harness/paging.ts";
import { openSession, type WinboxSession } from "../../harness/session.ts";
import { resolveLabTarget } from "../../harness/target.ts";

const CMD_GETCOUNT = 0xfe0015;
const F_ROWID = 0xfe0001;

const ERR_NAMES: Record<number, string> = Object.fromEntries([
	[0xfe0001, "ERROR_UNKNOWN"],
	[0xfe0002, "ERROR_BRKPATH"],
	[0xfe0003, "ERROR_NOTIMP"],
	[0xfe0004, "ERROR_UNKNOWNID"],
	[0xfe0005, "ERROR_MISSING"],
	[0xfe0006, "ERROR_FAILED"],
]);

function usage(): never {
	console.error(
		"usage: census-e3r.ts --quickchr <name> --allowed-version <v> --out <manifest.jsonl> --summary <summary.json> [--timeout <ms>] [--sweep-max <n>]",
	);
	process.exit(2);
}

interface LegResult {
	leg: string;
	route: number[];
	cmd: string;
	status: string;
	errno: number | null;
	errnoName: string | null;
	errstr: string | null;
	from: number[] | null;
	// ok-shape details
	rowCount?: number;
	pages?: number;
	complete?: boolean;
	countSlot?: string | null;
	countValue?: number | null;
	fieldKeys?: string[];
	note?: string;
	seqStart: number;
	seqEnd: number;
}

function entryVal(m: M2Message, fullKey: number): unknown {
	const e = m.entries.find((x) => x.fullKey === fullKey);
	return e?.value;
}

function numArr(v: unknown): number[] | null {
	if (!Array.isArray(v)) return null;
	if (!v.every((x) => typeof x === "number")) return null;
	return v as number[];
}

async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	let machine = "";
	let allowedVersion = "";
	let out = "";
	let summaryPath = "";
	let timeoutMs = 8000;
	let sweepMax = 140;
	for (let i = 0; i < argv.length; i++) {
		const t = argv[i] ?? "";
		if (t === "--quickchr") machine = argv[++i] ?? "";
		else if (t === "--allowed-version") allowedVersion = argv[++i] ?? "";
		else if (t === "--out") out = argv[++i] ?? "";
		else if (t === "--summary") summaryPath = argv[++i] ?? "";
		else if (t === "--timeout") timeoutMs = Number(argv[++i] ?? "8000");
		else if (t === "--sweep-max") sweepMax = Number(argv[++i] ?? "140");
		else usage();
	}
	if (!machine || !allowedVersion || !out || !summaryPath) usage();

	const target = resolveLabTarget(machine, {
		allowedVersions: [allowedVersion],
	});
	console.log(
		`census: target=${machine} version=${target.version} winbox-port=${target.port}`,
	);

	const captures: CaptureRecord[] = [];
	const onCapture = (rec: CaptureRecord): void => {
		rec.seq = captures.length;
		captures.push(rec);
	};
	const legs: LegResult[] = [];

	const session: WinboxSession = await openSession(
		target.host,
		target.port,
		target.user,
		target.pass,
		{ timeoutMs },
	);
	console.log(`census: auth OK sourceId=${session.sourceId}`);
	let reqId = 1;

	const oneShot = async (
		leg: string,
		route: number[],
		cmd: number,
		cmdName: string,
		extra: Parameters<typeof buildRequest>[4],
		note?: string,
	): Promise<CorrelatedOutcome> => {
		reqId = nextReqId(reqId);
		const seqStart = captures.length;
		const res = await correlatedRequest(
			session.transport,
			buildRequest(route, cmd, session.sourceId, reqId, extra),
			reqId,
			{ timeoutMs, onCapture },
		);
		const seqEnd = captures.length - 1;
		if (res.status === "ok" || res.status === "router-error") {
			const errno =
				res.status === "router-error"
					? res.errno
					: (entryVal(res.reply, 0xff0008) as number | undefined ?? null);
			const from = numArr(entryVal(res.reply, 0xff0002));
			const keys = res.reply.entries.map(
				(e) => `0x${e.fullKey.toString(16).padStart(6, "0")}/0x${e.tcode.toString(16)}`,
			);
			// GETCOUNT count slot: 7.x 0xfe0019, v6 0xfe0014.
			let countSlot: string | null = null;
			let countValue: number | null = null;
			for (const k of [0xfe0019, 0xfe0014]) {
				const v = entryVal(res.reply, k);
				if (typeof v === "number") {
					countSlot = `0x${k.toString(16)}`;
					countValue = v;
				}
			}
			legs.push({
				leg,
				route,
				cmd: cmdName,
				status: res.status,
				errno,
				errnoName:
					errno !== null ? (ERR_NAMES[errno] ?? "unnamed") : null,
				errstr: res.errstr,
				from,
				countSlot,
				countValue,
				fieldKeys: keys,
				note,
				seqStart,
				seqEnd,
			});
		} else {
			legs.push({
				leg,
				route,
				cmd: cmdName,
				status: res.status,
				errno: null,
				errnoName: null,
				errstr: null,
				from: null,
				fieldKeys: [],
				note: `transport-level: ${res.status}`,
				seqStart,
				seqEnd,
			});
		}
		return res;
	};

	const pagedGetAll = async (
		leg: string,
		route: number[],
		note?: string,
	): Promise<void> => {
		const seqStart = captures.length;
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
				throw new Error(`census: ${leg} page failed: ${res.status}`);
			},
		);
		const seqEnd = captures.length - 1;
		const first = paged.rows[0];
		legs.push({
			leg,
			route,
			cmd: "CMD_GETALL",
			status: paged.complete ? "ok" : `incomplete:${paged.cause ?? "?"}`,
			errno: null,
			errnoName: null,
			errstr: null,
			from: route,
			rowCount: paged.rows.length,
			pages: paged.pages,
			complete: paged.complete,
			fieldKeys: first
				? first.entries.map(
						(e) =>
							`0x${e.fullKey.toString(16).padStart(6, "0")}/0x${e.tcode.toString(16)}`,
					)
				: [],
			note:
				note ??
				(paged.rows.length === 0
					? "empty table: 0 rows"
					: `first-row keys listed; rows=${paged.rows.length}`),
			seqStart,
			seqEnd,
		});
	};

	try {
		// Leg group 1: empty-table shapes on [20,5] / [20,87] / [20,39].
		for (const hid of [5, 87, 39]) {
			await pagedGetAll(`getall-20-${hid}`, [20, hid]);
			await oneShot(`getcount-20-${hid}`, [20, hid], CMD_GETCOUNT, "CMD_GETCOUNT", []);
			await oneShot(`getobj-20-${hid}-1`, [20, hid], CMD_GETOBJ, "CMD_GETOBJ", [
				encU32(F_ROWID, 1),
			]);
			await oneShot(`getobj-20-${hid}-999`, [20, hid], CMD_GETOBJ, "CMD_GETOBJ", [
				encU32(F_ROWID, 999),
			]);
		}
		// Leg group 2: [20,*] GETCOUNT discovery sweep (filter-table hunt).
		for (let hid = 0; hid <= sweepMax; hid++) {
			await oneShot(`sweep-getcount-20-${hid}`, [20, hid], CMD_GETCOUNT, "CMD_GETCOUNT", []);
		}
		// Leg group 3: services-context row shapes.
		await pagedGetAll("getall-20-13", [20, 13]);
		await oneShot("getcount-20-13", [20, 13], CMD_GETCOUNT, "CMD_GETCOUNT", []);
		await pagedGetAll("getall-20-14", [20, 14]);
		await oneShot("getcount-20-14", [20, 14], CMD_GETCOUNT, "CMD_GETCOUNT", []);
		await oneShot("get-20-17", [20, 17], CMD_GET, "CMD_GET", []);
		await oneShot("getcount-20-17", [20, 17], CMD_GETCOUNT, "CMD_GETCOUNT", []);
		// Leg group 4: [20,61] negative-control GETs ONLY.
		await oneShot("get-20-61-bare", [20, 61], CMD_GET, "CMD_GET", [], "negative control");
		await oneShot("get-20-61-f7-lte1", [20, 61], CMD_GET, "CMD_GET", [encStr(7, "lte1")], "negative control");
		await oneShot("get-20-61-f7-foo", [20, 61], CMD_GET, "CMD_GET", [encStr(7, "foo")], "negative control");
	} finally {
		session.close();
	}

	// Sanitized write: drop wall-clock ts (seq preserves order); bytes lossless.
	for (const f of [out, summaryPath]) {
		try {
			unlinkSync(f);
		} catch {
			// Absent is fine.
		}
	}
	for (const rec of captures) {
		appendCapture(out, { ...rec, ts: "redacted" });
	}
	const summary = {
		proof: "E3-R read-only firewall/services census",
		target: machine,
		routeros_version: target.version,
		winbox_port: "redacted",
		sweep_max: sweepMax,
		legs,
	};
	await Bun.write(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
	console.log(
		`census: manifest ${out} records=${captures.length} legs=${legs.length} summary=${summaryPath}`,
	);
}

if (import.meta.main) {
	main().catch((e: unknown) => {
		console.error(`census: ${(e as Error).message}`);
		process.exit(1);
	});
}
