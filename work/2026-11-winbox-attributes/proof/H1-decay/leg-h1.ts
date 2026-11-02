// H1 leg script: timestamped reads + persistent-session ladder + passive async
// drain for the [20,32] decay-mechanism leg (ws21/7.25). Read-only: no native
// write verb exists in this script (0w by construction).
//
// Modes:
//   read   --out <jsonl>               session-per-read 4-leg shape (G3-comparable)
//   ladder --out <jsonl>               ONE session, rungs R0a/R0b/R1..R5 at fixed
//                                      t0 offsets, then a bounded drain, then close
//   watch  --out <jsonl> --duration-ms <ms>
//                                      negative control: open session, drain only,
//                                      no stimulus, close
//
// Timing (H0a U-h0a-tooling-timestamp): --t0-ms <unix-ms> stamps every record
// ts as "+<ms>ms" relative to t0 (control-add completion, host clock).
// Absolute times are never persisted. Without --t0-ms, ts is "redacted"
// (G3-compatible). --timing-out <jsonl> appends a relative-offset event
// ledger (session open/close, rung starts, drain windows): the churn ledger.
//
// Async (H0a design c): async picked up during a rung is tagged async@<rung>
// with pickup ts; true arrival lies in (prev-rung-end, pickup]. The final
// bounded drain (--drain-ms, default 5000 on ladder/watch, 0 on read)
// catches stragglers before close. No background drain exists: transport
// recv has a single consumer by design.
//
// Usage:
//   bun work/2026-11-winbox-attributes/proof/H1-decay/leg-h1.ts --quickchr ws21 --allowed-version 7.25 --t0-ms <ms> read --out <step.jsonl> [--timing-out <t.jsonl>] [--drain-ms <ms>]
//   bun work/2026-11-winbox-attributes/proof/H1-decay/leg-h1.ts --quickchr ws21 --allowed-version 7.25 --t0-ms <ms> ladder --out <step.jsonl> [--timing-out <t.jsonl>] [--drain-ms <ms>]
//   bun work/2026-11-winbox-attributes/proof/H1-decay/leg-h1.ts --quickchr ws21 --allowed-version 7.25 --t0-ms <ms> watch --duration-ms <ms> --out <step.jsonl> [--timing-out <t.jsonl>]
import {
	encU32,
	type M2Message,
} from "../../../2026-10-chr-extraction/ws3c/m2.ts";
import {
	buildRequest,
	CMD_GET,
	CMD_GETALL,
} from "../../../2026-10-chr-extraction/ws3c/probe.ts";
import {
	appendCapture,
	type CaptureRecord,
	captureMessage,
} from "../../harness/capture.ts";
import type { CorrelatedTransport } from "../../harness/correlate.ts";
import {
	type CorrelatedOutcome,
	correlatedRequest,
	nextReqId,
} from "../../harness/correlate.ts";
import { getAllPages, type PageFetchResult } from "../../harness/paging.ts";
import { openSession, type WinboxSession } from "../../harness/session.ts";
import { resolveLabTarget } from "../../harness/target.ts";

const CMD_GETCOUNT = 0xfe0015;

interface TimingEvent {
	event: string;
	tRelMs: number;
	detail?: string;
}

function usage(): never {
	console.error(
		"usage: leg-h1.ts --quickchr <name> --allowed-version <v> [--t0-ms <ms>] [--timing-out <jsonl>] [--timeout <ms>] [--drain-ms <ms>] (read --out <jsonl> | ladder --out <jsonl> | watch --duration-ms <ms> --out <jsonl>)",
	);
	process.exit(2);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	let machine = "";
	let allowedVersion = "";
	let sub = "";
	let out = "";
	let t0Ms = 0;
	let timingOut = "";
	let timeoutMs = 8000;
	let drainMs = -1;
	let durationMs = 0;
	for (let i = 0; i < argv.length; i++) {
		const t = argv[i] ?? "";
		if (t === "--quickchr") machine = argv[++i] ?? "";
		else if (t === "--allowed-version") allowedVersion = argv[++i] ?? "";
		else if (t === "--out") out = argv[++i] ?? "";
		else if (t === "--t0-ms") t0Ms = Number(argv[++i] ?? "0");
		else if (t === "--timing-out") timingOut = argv[++i] ?? "";
		else if (t === "--timeout") timeoutMs = Number(argv[++i] ?? "8000");
		else if (t === "--drain-ms") drainMs = Number(argv[++i] ?? "-1");
		else if (t === "--duration-ms") durationMs = Number(argv[++i] ?? "0");
		else if (t === "read" || t === "ladder" || t === "watch") sub = t;
		else usage();
	}
	if (!machine || !allowedVersion || !sub || !out) usage();
	if (t0Ms !== 0 && (!Number.isFinite(t0Ms) || t0Ms <= 0)) usage();
	if (sub === "watch" && (!Number.isFinite(durationMs) || durationMs <= 0))
		usage();
	if (drainMs < 0) drainMs = sub === "read" ? 0 : 5000;

	const target = resolveLabTarget(machine, {
		allowedVersions: [allowedVersion],
	});
	const captures: CaptureRecord[] = [];
	const onCapture = (rec: CaptureRecord): void => {
		rec.seq = captures.length;
		captures.push(rec);
	};
	const ledger = (event: string, detail?: string): void => {
		if (!timingOut) return;
		const ev: TimingEvent = {
			event,
			tRelMs: t0Ms === 0 ? -1 : Date.now() - t0Ms,
		};
		if (detail !== undefined) ev.detail = detail;
		appendCapture(timingOut, ev as unknown as CaptureRecord);
	};

	const session: WinboxSession = await openSession(
		target.host,
		target.port,
		target.user,
		target.pass,
		{ timeoutMs },
	);
	ledger("session-open");
	let reqId = 1;
	// One 4-leg read shape (G3-comparable): GETCOUNT [20,3] + [20,32],
	// GET [20,17], paged GETALL [20,3]. Returns the [20,32] value or null.
	const fourLeg = async (tag: string): Promise<number | null> => {
		const oneShot = async (
			route: number[],
			cmd: number,
			extra: Parameters<typeof buildRequest>[4],
		): Promise<CorrelatedOutcome> => {
			reqId = nextReqId(reqId);
			return correlatedRequest(
				session.transport,
				buildRequest(route, cmd, session.sourceId, reqId, extra),
				reqId,
				{ timeoutMs, onCapture },
			);
		};
		const markAsync = (o: CorrelatedOutcome): void => {
			for (const rec of o.asyncSeen) rec.note = `async@${tag}`;
		};
		const c3 = await oneShot([20, 3], CMD_GETCOUNT, []);
		markAsync(c3);
		const c32 = await oneShot([20, 32], CMD_GETCOUNT, []);
		markAsync(c32);
		const g17 = await oneShot([20, 17], CMD_GET, []);
		markAsync(g17);
		const paged = await getAllPages(
			async (start: number | null): Promise<PageFetchResult> => {
				reqId = nextReqId(reqId);
				const extra = start === null ? [] : [encU32(0xfe0003, start)];
				const res = await correlatedRequest(
					session.transport,
					buildRequest([20, 3], CMD_GETALL, session.sourceId, reqId, extra),
					reqId,
					{ timeoutMs, onCapture },
				);
				markAsync(res);
				if (res.status === "ok") return { status: "ok", page: res.reply };
				if (res.status === "router-error") {
					return {
						status: "error",
						page: res.reply,
						errno: res.errno,
						errstr: res.errstr,
					};
				}
				throw new Error(`leg-h1 ${tag}: GETALL page failed: ${res.status}`);
			},
		);
		const val = (m: M2Message, k: number): unknown =>
			m.entries.find((x) => x.fullKey === k)?.value;
		const j = (o: CorrelatedOutcome): string =>
			o.status === "ok" || o.status === "router-error"
				? `${o.status} count=${String(val(o.reply, 0xfe0019))}`
				: o.status;
		const v32 =
			c32.status === "ok" ? (val(c32.reply, 0xfe0019) as number) : null;
		console.log(
			`${tag}: [20,3]=${j(c3)} [20,32]=${j(c32)} [20,17]=${g17.status} getall203 rows=${paged.rows.length} pages=${paged.pages} complete=${paged.complete}`,
		);
		return v32;
	};
	// Bounded single-consumer async drain: race recv against 1s slices
	// until the budget ends. Returns the count picked up.
	const drainAsync = async (
		transport: CorrelatedTransport,
		budgetMs: number,
		tag: string,
	): Promise<number> => {
		const end = Date.now() + budgetMs;
		let n = 0;
		for (;;) {
			const remaining = end - Date.now();
			if (remaining <= 0) break;
			const rx = await Promise.race([
				transport.recv().then((b) => ({ bytes: b as Uint8Array | null })),
				sleep(Math.min(remaining, 1000)).then(() => ({ bytes: null })),
			]);
			if (rx.bytes === null) continue;
			const rec = captureMessage(0, "rx", rx.bytes);
			rec.note = `drain@${tag}`;
			onCapture(rec);
			n++;
		}
		return n;
	};

	try {
		if (sub === "read") {
			ledger("read-start");
			await fourLeg("read");
		} else if (sub === "ladder") {
			// Rung offsets from t0 (ms): R0a immediate, R0b back-to-back.
			const rungs: { id: string; atMs: number | null }[] = [
				{ id: "R0a", atMs: 0 },
				{ id: "R0b", atMs: null },
				{ id: "R1", atMs: 10_000 },
				{ id: "R2", atMs: 30_000 },
				{ id: "R3", atMs: 60_000 },
				{ id: "R4", atMs: 120_000 },
				{ id: "R5", atMs: 300_000 },
			];
			for (const rung of rungs) {
				if (rung.atMs !== null && t0Ms !== 0) {
					const wait = t0Ms + rung.atMs - Date.now();
					if (wait > 0) await sleep(wait);
					else
						ledger(`rung-${rung.id}-late`, `schedule skew ${-wait}ms`);
				}
				ledger(`rung-${rung.id}-start`);
				await fourLeg(`rung-${rung.id}`);
			}
		} else {
			ledger("watch-start", `duration ${durationMs}ms`);
			const n = await drainAsync(session.transport, durationMs, "watch");
			console.log(`watch: async=${n} durationMs=${durationMs}`);
		}
		if (drainMs > 0 && sub !== "watch") {
			ledger("drain-start", `budget ${drainMs}ms`);
			const n = await drainAsync(session.transport, drainMs, "final");
			ledger("drain-end", `picked up ${n}`);
			console.log(`drain: async=${n} budgetMs=${drainMs}`);
		}
	} finally {
		session.close();
		ledger("session-close");
	}
	for (const rec of captures) {
		const ts =
			t0Ms === 0
				? "redacted"
				: `+${Date.parse(rec.ts) - t0Ms}ms`;
		appendCapture(out, { ...rec, ts });
	}
	console.log(`leg-h1: ${sub} records=${captures.length} out=${out}`);
}

if (import.meta.main) {
	main().catch((e: unknown) => {
		console.error(`leg-h1: ${(e as Error).message}`);
		process.exit(1);
	});
}
