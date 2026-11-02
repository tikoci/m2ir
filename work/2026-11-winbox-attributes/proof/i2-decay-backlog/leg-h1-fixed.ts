// cspell:ignore keepalives untimed
// H-decay-3 leg script: FIXED persistent-session ladder + timestamped reads.
// Derived from proof/H1-decay/leg-h1.ts (H1); read-only, no native write verb
// exists in this script (0w by construction).
//
// Fixes vs leg-h1.ts (both H1 defects, see H1 report idle-death-1):
//   F1 end-of-run flush loss: leg-h1.ts buffered every capture in memory and
//      flushed to --out only after the session closed, so a mid-run throw
//      (idle-session death in a >20s gap) discarded ALL rung rx bytes. This
//      script is WRITE-THROUGH: every captured record is appended to --out
//      the moment it is captured. A dead session loses nothing committed.
//   F2 silent rungs: leg-h1.ts never printed per-rung async counts (only the
//      final drain count), so a dead run left no rung-level async account.
//      This script prints [20,32] + async + record counts per rung to the
//      console AND to the timing ledger (rung-<id>-end events).
//   F3 idle death: gaps >20s kill the session (H1: death at ~24-30s idle, 2
//      samples). Inter-rung waits are sliced into <=15s slices with a
//      same-session single-GETCOUNT [20,32] keepalive between slices (zero
//      churn: no reconnect). Keepalive values print as K-samples (TIER 1
//      bonus rungs, denser dip-window coverage). --no-keepalive disables.
// Modes:
//   read   --out <jsonl>               session-per-read 4-leg shape (G3-comparable)
//   ladder --out <jsonl>               ONE session, rungs R0a/R0b/R1..R5 at fixed
//                                      t0 offsets, keepalive-sliced waits, then
//                                      a bounded drain, then close
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
//   bun work/2026-11-winbox-attributes/proof/i2-decay-backlog/leg-h1-fixed.ts --quickchr ws21 --allowed-version 7.25 --t0-ms <ms> read --out <step.jsonl> [--timing-out <t.jsonl>] [--drain-ms <ms>]
//   bun work/2026-11-winbox-attributes/proof/i2-decay-backlog/leg-h1-fixed.ts --quickchr ws21 --allowed-version 7.25 --t0-ms <ms> ladder --out <step.jsonl> [--timing-out <t.jsonl>] [--drain-ms <ms>] [--keepalive-ms <ms> | --no-keepalive]
//   bun work/2026-11-winbox-attributes/proof/i2-decay-backlog/leg-h1-fixed.ts --quickchr ws21 --allowed-version 7.25 --t0-ms <ms> watch --duration-ms <ms> --out <step.jsonl> [--timing-out <t.jsonl>]
//   bun work/2026-11-winbox-attributes/proof/i2-decay-backlog/leg-h1-fixed.ts --help
//   bun work/2026-11-winbox-attributes/proof/i2-decay-backlog/leg-h1-fixed.ts [--t0-ms <ms>] [--keepalive-ms <ms> | --no-keepalive] ladder --out <step.jsonl> --dry-run
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

const HELP = `leg-h1-fixed.ts: timestamped reads + FIXED persistent-session ladder (read-only, 0w).
usage: leg-h1-fixed.ts --quickchr <name> --allowed-version <v> [--t0-ms <ms>] [--timing-out <jsonl>] [--timeout <ms>] [--drain-ms <ms>] [--keepalive-ms <ms> | --no-keepalive] (read --out <jsonl> | ladder --out <jsonl> | watch --duration-ms <ms> --out <jsonl>)
       leg-h1-fixed.ts --help
       leg-h1-fixed.ts [--t0-ms <ms>] [--keepalive-ms <ms> | --no-keepalive] ladder --out <jsonl> --dry-run
modes:
  read    one session-per-read 4-leg shape (GETCOUNT [20,3] + [20,32], GET [20,17], paged GETALL [20,3])
  ladder  ONE session, rungs R0a(immediate)/R0b(back-to-back)/R1(+10s)/R2(+30s)/R3(+60s)/R4(+120s)/R5(+300s),
          inter-rung waits sliced with same-session [20,32] keepalives (<=15s idle by default), then a bounded drain
  watch   negative control: open session, drain only for --duration-ms, no stimulus, close
flags:
  --t0-ms <ms>       control-add completion (host unix ms); record ts becomes "+<ms>ms" relative, else "redacted"
  --timing-out <f>   append the relative-offset event ledger (session/rung/keepalive/drain events)
  --timeout <ms>     per-request transport timeout (default 8000)
  --drain-ms <ms>    final bounded async drain budget (default 5000 on ladder/watch, 0 on read)
  --keepalive-ms <ms> max idle slice between rungs before a keepalive read (default 15000; must be < 20000)
  --no-keepalive     disable keepalives (waits are bare sleeps; gaps >20s WILL kill the session — repro/negative-control only)
  --dry-run          validate args and print the ladder schedule + keepalive plan WITHOUT contacting any router (ladder only)
  --help             print this text (no router contact)`;

function usage(): never {
	console.error(HELP);
	process.exit(2);
}

function help(): never {
	console.log(HELP);
	process.exit(0);
}

// Rung offsets from t0 (ms): R0a immediate, R0b back-to-back. Shared by
// --dry-run (no router) and the live ladder so the plan cannot drift.
const RUNGS: { id: string; atMs: number | null }[] = [
	{ id: "R0a", atMs: 0 },
	{ id: "R0b", atMs: null },
	{ id: "R1", atMs: 10_000 },
	{ id: "R2", atMs: 30_000 },
	{ id: "R3", atMs: 60_000 },
	{ id: "R4", atMs: 120_000 },
	{ id: "R5", atMs: 300_000 },
];

function dryRun(
	out: string,
	t0Ms: number,
	keepaliveMs: number,
	noKeepalive: boolean,
): never {
	const gaps: { from: string; to: string; gapMs: number; slices: number }[] =
		[];
	const timed = RUNGS.filter((r) => r.atMs !== null);
	for (let i = 1; i < timed.length; i++) {
		const prev = timed[i - 1];
		const cur = timed[i];
		if (prev?.atMs === undefined || prev.atMs === null || cur?.atMs == null)
			continue;
		const gapMs = cur.atMs - prev.atMs;
		const slices =
			noKeepalive || gapMs <= keepaliveMs
				? 1
				: Math.ceil(gapMs / keepaliveMs);
		gaps.push({
			from: prev.id ?? "?",
			to: cur.id ?? "?",
			gapMs,
			slices,
		});
	}
	const maxIdle = noKeepalive
		? Math.max(...gaps.map((g) => g.gapMs))
		: keepaliveMs;
	console.log(
		JSON.stringify(
			{
				mode: "ladder",
				dryRun: true,
				out,
				t0: t0Ms === 0 ? "redacted untimed (rungs back-to-back)" : "timed",
				rungs: RUNGS.map((r) => ({
					id: r.id,
					atMs: r.atMs,
				})),
				keepalive: noKeepalive
					? { enabled: false }
					: { enabled: true, everyMs: keepaliveMs, verb: "GETCOUNT [20,32]" },
				gaps,
				maxIdleMs: maxIdle,
				idleDeathBoundMs: "session dies ~24000-30000 idle (H1, 2 samples)",
				verdict:
					maxIdle < 20000
						? "OK: all idle slices <20s"
						: "UNSAFE: idle >20s will kill the session (H1 idle-death-1)",
			},
			null,
			2,
		),
	);
	process.exit(maxIdle < 20000 ? 0 : 1);
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
	let keepaliveMs = 15000;
	let noKeepalive = false;
	let dryRunFlag = false;
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
		else if (t === "--keepalive-ms")
			keepaliveMs = Number(argv[++i] ?? "15000");
		else if (t === "--no-keepalive") noKeepalive = true;
		else if (t === "--dry-run") dryRunFlag = true;
		else if (t === "--help" || t === "-h") help();
		else if (t === "read" || t === "ladder" || t === "watch") sub = t;
		else usage();
	}
	if (dryRunFlag) {
		if (sub !== "ladder" || !out) usage();
		if (t0Ms !== 0 && (!Number.isFinite(t0Ms) || t0Ms <= 0)) usage();
		if (!noKeepalive && (!Number.isFinite(keepaliveMs) || keepaliveMs <= 0))
			usage();
		// No resolveLabTarget, no session: zero router contact by construction.
		dryRun(out, t0Ms, keepaliveMs, noKeepalive);
	}
	if (!machine || !allowedVersion || !sub || !out) usage();
	if (t0Ms !== 0 && (!Number.isFinite(t0Ms) || t0Ms <= 0)) usage();
	if (sub === "watch" && (!Number.isFinite(durationMs) || durationMs <= 0))
		usage();
	if (!noKeepalive && (!Number.isFinite(keepaliveMs) || keepaliveMs <= 0))
		usage();
	if (!noKeepalive && keepaliveMs >= 20000) {
		console.error(
			`leg-h1-fixed: --keepalive-ms ${keepaliveMs} >= 20000: idle slices must stay <20s (H1 idle death ~24-30s)`,
		);
		process.exit(2);
	}
	// G1 (blind reviewer): eager-create (truncate) --out so a zero-record
	// run (e.g. watch with no async) still leaves its evidence file behind
	// instead of nothing. Runs after the --dry-run early exit above, so
	// dry runs still create no files.
	await Bun.write(out, "");
	if (drainMs < 0) drainMs = sub === "read" ? 0 : 5000;

	const target = resolveLabTarget(machine, {
		allowedVersions: [allowedVersion],
	});
	// F1 write-through: every captured record is appended to --out the
	// moment it is captured (ts relativized at write). A mid-run throw
	// (idle death, timeout) loses nothing already committed. The in-memory
	// array survives only for seq numbering and the end-of-run summary.
	const captures: CaptureRecord[] = [];
	const stampTs = (rec: CaptureRecord): CaptureRecord => {
		const ts = t0Ms === 0 ? "redacted" : `+${Date.parse(rec.ts) - t0Ms}ms`;
		return { ...rec, ts };
	};
	const onCapture = (rec: CaptureRecord): void => {
		rec.seq = captures.length;
		captures.push(rec);
		appendCapture(out, stampTs(rec));
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
	const val = (m: M2Message, k: number): unknown =>
		m.entries.find((x) => x.fullKey === k)?.value;
	// One 4-leg read shape (G3-comparable): GETCOUNT [20,3] + [20,32],
	// GET [20,17], paged GETALL [20,3]. Returns the [20,32] value (or
	// null), the async count picked up during this read, and the record
	// count appended. F2: the caller prints + ledgers all three per rung.
	const fourLeg = async (
		tag: string,
	): Promise<{ v32: number | null; asyncN: number; records: number }> => {
		const before = captures.length;
		let asyncN = 0;
		const markAsync = (o: CorrelatedOutcome): void => {
			for (const rec of o.asyncSeen) rec.note = `async@${tag}`;
			asyncN += o.asyncSeen.length;
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
				throw new Error(
					`leg-h1-fixed ${tag}: GETALL page failed: ${res.status}`,
				);
			},
		);
		const j = (o: CorrelatedOutcome): string =>
			o.status === "ok" || o.status === "router-error"
				? `${o.status} count=${String(val(o.reply, 0xfe0019))}`
				: o.status;
		const v32 =
			c32.status === "ok" ? (val(c32.reply, 0xfe0019) as number) : null;
		const records = captures.length - before;
		console.log(
			`${tag}: [20,3]=${j(c3)} [20,32]=${j(c32)} [20,17]=${g17.status} getall203 rows=${paged.rows.length} pages=${paged.pages} complete=${paged.complete} async=${asyncN} records=${records}`,
		);
		return { v32, asyncN, records };
	};
	// F3 keepalive: one single-GETCOUNT [20,32] on the SAME session (zero
	// churn, no reconnect). Reads do not consume the value (H-decay-2
	// dead), so the keepalive doubles as a TIER 1 bonus sample (K-sample)
	// of the decay curve. Any traffic resets the idle clock.
	let keepaliveN = 0;
	const keepalive = async (): Promise<void> => {
		keepaliveN++;
		const tag = `keepalive-K${keepaliveN}`;
		const o = await oneShot([20, 32], CMD_GETCOUNT, []);
		for (const rec of o.asyncSeen) rec.note = `async@${tag}`;
		const v =
			o.status === "ok" ? String(val(o.reply, 0xfe0019)) : o.status;
		console.log(
			`${tag}: [20,32]=${v} async=${o.asyncSeen.length} (idle-reset)`,
		);
		ledger(tag, `v32=${v} async=${o.asyncSeen.length}`);
	};
	// Sleep until targetMs (host clock), slicing the wait so no idle gap
	// exceeds keepaliveMs. With keepalives disabled this is a bare sleep
	// (gaps >20s will kill the session: --no-keepalive is repro-only).
	const slicedWait = async (targetMs: number): Promise<void> => {
		for (;;) {
			const wait = targetMs - Date.now();
			if (wait <= 0) return;
			if (noKeepalive || wait <= keepaliveMs) {
				await sleep(wait);
				return;
			}
			await sleep(keepaliveMs);
			if (Date.now() >= targetMs) return;
			await keepalive();
		}
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
			const r = await fourLeg("read");
			ledger(
				"read-end",
				`v32=${String(r.v32)} async=${r.asyncN} records=${r.records}`,
			);
		} else if (sub === "ladder") {
			// Per-rung try/catch: a rung that throws (idle death despite
			// keepalives, transport timeout) is recorded as rung-<id>-failed
			// with everything so far already committed (F1 write-through);
			// the run stops WITHOUT attempting a reconnect (a reconnect is
			// session churn and would confound the H-decay-3 async account).
			// Later rungs fall back to session-per-read `read` invocations.
			for (const rung of RUNGS) {
				ledger(`rung-${rung.id}-start`);
				try {
					// G2 (blind reviewer): the keepalive-sliced wait runs
					// INSIDE the per-rung try so a keepalive throw writes
					// rung-*-failed (L6 invariant) instead of escaping it.
					if (rung.atMs !== null && t0Ms !== 0) {
						const wait = t0Ms + rung.atMs - Date.now();
						if (wait > 0) await slicedWait(t0Ms + rung.atMs);
						else
							ledger(`rung-${rung.id}-late`, `schedule skew ${-wait}ms`);
					}
					const r = await fourLeg(`rung-${rung.id}`);
					ledger(
						`rung-${rung.id}-end`,
						`v32=${String(r.v32)} async=${r.asyncN} records=${r.records}`,
					);
				} catch (e) {
					ledger(
						`rung-${rung.id}-failed`,
						`${(e as Error).message} (committed so far: ${captures.length} records, keepalives ${keepaliveN})`,
					);
					throw e;
				}
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
	// No end-of-run flush: every record was already appended by onCapture
	// (F1). This summary only reports the committed count.
	console.log(
		`leg-h1-fixed: ${sub} records=${captures.length} keepalives=${keepaliveN} out=${out}`,
	);
}

if (import.meta.main) {
	main().catch((e: unknown) => {
		console.error(`leg-h1-fixed: ${(e as Error).message}`);
		process.exit(1);
	});
}
