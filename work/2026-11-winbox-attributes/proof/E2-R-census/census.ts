// E2-R read-only census: [20,1] + [20,37] row-shapes + [20,*] GETCOUNT sweep.
//
// Usage:
//   bun census.ts --quickchr <name> --out <dir> [--sweep] [--timeout <ms>]
//
// ZERO writes: bare/token GETALL, GETOBJ, and bare GETCOUNT only. No
// SET/ADD/REMOVE/MOVE, no centrs, no provisioning. Output is sanitized:
// capture timestamps are stripped; no hosts, ports, or secrets are
// written (addresses shown are synthetic lab data).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
	encU32,
	findEntry,
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

const CMD_GETCOUNT = 0xfe0015;

function usage(): never {
	console.error(
		"usage: census.ts --quickchr <name> --out <dir> [--sweep] [--timeout <ms>]",
	);
	process.exit(2);
}

function hex(n: number): string {
	return `0x${n.toString(16)}`;
}

function shapeOf(m: M2Message): unknown {
	return losslessMessage(m);
}

function summarizeGetCount(reply: M2Message): {
	count19: number | null;
	count14: number | null;
} {
	const c19 = findEntry(reply, 0xfe0019);
	const c14 = findEntry(reply, 0xfe0014);
	return {
		count19: typeof c19?.value === "number" ? c19.value : null,
		count14: typeof c14?.value === "number" ? c14.value : null,
	};
}

async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	let machine = "";
	let outDir = "";
	let sweep = false;
	let timeoutMs = 8000;
	for (let i = 0; i < argv.length; i++) {
		const t = argv[i] ?? "";
		if (t === "--quickchr") machine = argv[++i] ?? "";
		else if (t === "--out") outDir = argv[++i] ?? "";
		else if (t === "--sweep") sweep = true;
		else if (t === "--timeout") timeoutMs = Number(argv[++i] ?? "8000");
		else usage();
	}
	if (!machine || !outDir) usage();
	mkdirSync(outDir, { recursive: true });

	let target: { host: string; port: number; user: string; pass: string; version: string };
	try {
		target = resolveLabTarget(machine);
	} catch (e) {
		// v6 boot-only VMs have no rest-api.auth; resolve the WinBox
		// port from `quickchr list` and credentials from native-api.auth.
		if ((e as Error).message !== "quickchr: no rest-api auth") throw e;
		const listRaw = Bun.spawnSync(["quickchr", "list", "--json"]);
		if (!listRaw.success) throw new Error("quickchr list failed");
		const list = JSON.parse(listRaw.stdout.toString()) as Array<{
			name?: unknown;
			version?: unknown;
			ports?: { winbox?: { host?: unknown } };
		}>;
		const hit = list.find((x) => x.name === machine);
		const wb = hit?.ports?.winbox?.host;
		if (typeof wb !== "number") throw new Error("quickchr: no winbox port");
		const inspRaw = Bun.spawnSync(["quickchr", "inspect", machine, "--json"]);
		if (!inspRaw.success) throw new Error("quickchr inspect failed");
		const insp = JSON.parse(inspRaw.stdout.toString()) as {
			// biome-ignore lint/complexity/useLiteralKeys: dashed key requires bracket access
			services?: { ["native-api"]?: { auth?: { username?: unknown; password?: unknown } } };
		};
		const auth = insp.services?.["native-api"]?.auth;
		if (typeof auth?.username !== "string" || typeof auth?.password !== "string") {
			throw new Error("quickchr: no native-api auth");
		}
		target = {
			host: "127.0.0.1",
			port: wb,
			user: auth.username,
			pass: auth.password,
			version: typeof hit?.version === "string" ? hit.version : "unknown",
		};
		console.log(`census: v6 fallback resolution for ${machine}`);
	}
	console.log(`census: target=${machine} version=${target.version}`);

	const captures: CaptureRecord[] = [];
	const sweepCaptures: CaptureRecord[] = [];
	const onCapture = (rec: CaptureRecord): void => {
		rec.seq = captures.length;
		captures.push(rec);
	};
	const onSweepCapture = (rec: CaptureRecord): void => {
		rec.seq = sweepCaptures.length;
		sweepCaptures.push(rec);
	};

	const session = await openSession(
		target.host,
		target.port,
		target.user,
		target.pass,
		{ timeoutMs },
	);
	console.log(`census: auth OK sourceId=${session.sourceId}`);

	type Step =
		| { kind: "getall"; rows: unknown; pages: number; complete: boolean; cause?: string }
		| { kind: "getobj"; row: unknown; status: string; errno?: string | null }
		| { kind: "getcount"; status: string; count19: number | null; count14: number | null; errno?: string | null };
	const steps: Record<string, Step> = {};

	let reqId = 1;
	const fetchPage = (to: number[]) =>
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
			throw new Error(`census: GETALL [${to}] page failed: ${res.status}`);
		};

	async function getObj(
		to: number[],
		obj: number,
	): Promise<{ status: string; row: unknown; errno: string | null }> {
		reqId = nextReqId(reqId);
		const res = await correlatedRequest(
			session.transport,
			buildRequest(to, CMD_GETOBJ, session.sourceId, reqId, [
				encU32(0xfe0001, obj),
			]),
			reqId,
			{ timeoutMs, onCapture },
		);
		if (res.status === "ok") {
			return { status: "ok", row: shapeOf(res.reply), errno: null };
		}
		if (res.status === "router-error") {
			return {
				status: "router-error",
				row: shapeOf(res.reply),
				errno: res.errno === null ? null : hex(res.errno),
			};
		}
		return { status: res.status, row: null, errno: null };
	}

	async function getCount(
		to: number[],
		sink: (rec: CaptureRecord) => void,
	): Promise<{
		status: string;
		count19: number | null;
		count14: number | null;
		errno: string | null;
		errstr: string | null;
	}> {
		reqId = nextReqId(reqId);
		const res = await correlatedRequest(
			session.transport,
			buildRequest(to, CMD_GETCOUNT, session.sourceId, reqId, []),
			reqId,
			{ timeoutMs, onCapture: sink },
		);
		if (res.status === "ok") {
			const { count19, count14 } = summarizeGetCount(res.reply);
			return { status: "ok", count19, count14, errno: null, errstr: null };
		}
		if (res.status === "router-error") {
			const { count19, count14 } = summarizeGetCount(res.reply);
			return {
				status: "router-error",
				count19,
				count14,
				errno: res.errno === null ? null : hex(res.errno),
				errstr: res.errstr,
			};
		}
		return {
			status: res.status,
			count19: null,
			count14: null,
			errno: null,
			errstr: null,
		};
	}

	try {
		// [20,1] two unchanged GETALL reads (volatility) + GETOBJ + GETCOUNT.
		for (const tag of ["read1", "read2"]) {
			const paged = await getAllPages(fetchPage([20, 1]));
			steps[`getall-20-1-${tag}`] = paged.complete
				? {
						kind: "getall",
						rows: paged.rows.map(shapeOf),
						pages: paged.pages,
						complete: true,
					}
				: {
						kind: "getall",
						rows: paged.rows.map(shapeOf),
						pages: paged.pages,
						complete: false,
						cause: paged.cause,
					};
			console.log(
				`census: [20,1] ${tag} rows=${paged.rows.length} pages=${paged.pages} complete=${paged.complete}`,
			);
		}
		const o1 = await getObj([20, 1], 1);
		steps["getobj-20-1-1"] = {
			kind: "getobj",
			row: o1.row,
			status: o1.status,
			errno: o1.errno,
		};
		console.log(`census: [20,1] getobj=1 status=${o1.status}`);
		const c1 = await getCount([20, 1], onCapture);
		steps["getcount-20-1"] = { kind: "getcount", ...c1 };
		console.log(
			`census: [20,1] getcount status=${c1.status} c19=${c1.count19} c14=${c1.count14}`,
		);

		// [20,37] two unchanged GETALL reads + GETOBJ + GETCOUNT.
		for (const tag of ["read1", "read2"]) {
			const paged = await getAllPages(fetchPage([20, 37]));
			steps[`getall-20-37-${tag}`] = paged.complete
				? {
						kind: "getall",
						rows: paged.rows.map(shapeOf),
						pages: paged.pages,
						complete: true,
					}
				: {
						kind: "getall",
						rows: paged.rows.map(shapeOf),
						pages: paged.pages,
						complete: false,
						cause: paged.cause,
					};
			console.log(
				`census: [20,37] ${tag} rows=${paged.rows.length} pages=${paged.pages} complete=${paged.complete}`,
			);
		}
		const o37 = await getObj([20, 37], 1);
		steps["getobj-20-37-1"] = {
			kind: "getobj",
			row: o37.row,
			status: o37.status,
			errno: o37.errno,
		};
		console.log(`census: [20,37] getobj=1 status=${o37.status}`);
		const c37 = await getCount([20, 37], onCapture);
		steps["getcount-20-37"] = { kind: "getcount", ...c37 };
		console.log(
			`census: [20,37] getcount status=${c37.status} c19=${c37.count19} c14=${c37.count14}`,
		);

		// Optional [20,*] GETCOUNT discovery sweep.
		let sweepOut: unknown = null;
		if (sweep) {
			const slots: unknown[] = [];
			for (let h = 0; h <= 255; h++) {
				const r = await getCount([20, h], onSweepCapture);
				slots.push({ slot: h, ...r });
			}
			const ok = slots.filter(
				(s) => (s as { status: string }).status === "ok",
			).length;
			sweepOut = { total_slots: 256, ok_slots: ok, slots };
			console.log(`census: sweep [20,0..255] ok=${ok}/256`);
		}

		// Volatility: read1 vs read2 identical?
		const v201 =
			JSON.stringify(steps["getall-20-1-read1"]) ===
			JSON.stringify(steps["getall-20-1-read2"]);
		const v2037 =
			JSON.stringify(steps["getall-20-37-read1"]) ===
			JSON.stringify(steps["getall-20-37-read2"]);
		console.log(`census: volatility [20,1] identical=${v201} [20,37] identical=${v2037}`);

		const summary = {
			proof: "E2-R census",
			machine,
			routeros_version: target.version,
			zero_writes: true,
			volatility: { "20-1-identical": v201, "20-37-identical": v2037 },
			steps,
			sweep_20_star: sweepOut,
		};
		writeFileSync(
			join(outDir, `shape-${machine}.json`),
			`${JSON.stringify(summary, null, 2)}\n`,
		);

		const strip = (rec: CaptureRecord): unknown => {
			const { ts: _ts, ...rest } = rec;
			return rest;
		};
		writeFileSync(
			join(outDir, `native-${machine}.jsonl`),
			`${captures.map((r) => JSON.stringify(strip(r))).join("\n")}\n`,
		);
		if (sweep) {
			writeFileSync(
				join(outDir, `sweep-${machine}.jsonl`),
				`${sweepCaptures.map((r) => JSON.stringify(strip(r))).join("\n")}\n`,
			);
		}
		console.log(
			`census: wrote shape-${machine}.json native-${machine}.jsonl(${captures.length})` +
				(sweep ? ` sweep-${machine}.jsonl(${sweepCaptures.length})` : ""),
		);
	} finally {
		session.close();
	}
}

if (import.meta.main) {
	main().catch((e: unknown) => {
		console.error(`census: ${(e as Error).message}`);
		process.exit(1);
	});
}
