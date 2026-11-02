// F-jump leg script: native reads + inverse SETOBJ for the jump-value leg (ws21/7.25).
//
// Reads (no gate): `read --out <jsonl>` runs GETCOUNT [20,3], GETCOUNT [20,32],
// GET [20,17], and paged GETALL [20,3], appending lossless captures.
// Write (gated): `setobj --rowid <n> --field <id> --as u32|str --value <v>`
// sends ONE native CMD_SETOBJ {0xfe0001=rowid, field=value}; requires
// --allow-mutations --disposable or the script refuses before connecting.
//
// Usage:
//   bun work/2026-11-winbox-attributes/proof/F-jump/leg-jump.ts --quickchr ws21 --allowed-version 7.25 read --out <step.jsonl>
//   bun work/2026-11-winbox-attributes/proof/F-jump/leg-jump.ts --quickchr ws21 --allowed-version 7.25 setobj --rowid 1 --field 40 --as u32 --value 0 --allow-mutations --disposable --out <step.jsonl>
import {
	encStr,
	encU32,
	type M2Message,
} from "../../../2026-10-chr-extraction/ws3c/m2.ts";
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
import {
	requireMutationGate,
	resolveLabTarget,
} from "../../harness/target.ts";

const CMD_GETCOUNT = 0xfe0015;
const CMD_SETOBJ = 0xfe0003;
const F_ROWID = 0xfe0001;

function usage(): never {
	console.error(
		"usage: leg-jump.ts --quickchr <name> --allowed-version <v> read --out <jsonl> | setobj --rowid <n> --field <id> --as u32|str --value <v> --allow-mutations --disposable --out <jsonl>",
	);
	process.exit(2);
}

async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	let machine = "";
	let allowedVersion = "";
	let sub = "";
	let out = "";
	let rowid = 0;
	let field = 0;
	let as = "";
	let value = "";
	let allowMutations = false;
	let disposable = false;
	let timeoutMs = 8000;
	for (let i = 0; i < argv.length; i++) {
		const t = argv[i] ?? "";
		if (t === "--quickchr") machine = argv[++i] ?? "";
		else if (t === "--allowed-version") allowedVersion = argv[++i] ?? "";
		else if (t === "--out") out = argv[++i] ?? "";
		else if (t === "--rowid") rowid = Number(argv[++i] ?? "0");
		else if (t === "--field") field = Number(argv[++i] ?? "0");
		else if (t === "--as") as = argv[++i] ?? "";
		else if (t === "--value") value = argv[++i] ?? "";
		else if (t === "--allow-mutations") allowMutations = true;
		else if (t === "--disposable") disposable = true;
		else if (t === "--timeout") timeoutMs = Number(argv[++i] ?? "8000");
		else if (t === "read" || t === "setobj") sub = t;
		else usage();
	}
	if (!machine || !allowedVersion || !sub || !out) usage();
	if (sub === "setobj") {
		requireMutationGate({ allowMutations, disposable }, "native SETOBJ");
		if (!rowid || !field || (as !== "u32" && as !== "str") || value === "")
			usage();
	}

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
	try {
		if (sub === "read") {
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
			const c3 = await oneShot([20, 3], CMD_GETCOUNT, []);
			const c32 = await oneShot([20, 32], CMD_GETCOUNT, []);
			const g17 = await oneShot([20, 17], CMD_GET, []);
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
					if (res.status === "ok") return { status: "ok", page: res.reply };
					if (res.status === "router-error") {
						return {
							status: "error",
							page: res.reply,
							errno: res.errno,
							errstr: res.errstr,
						};
					}
					throw new Error(`leg-jump read: GETALL page failed: ${res.status}`);
				},
			);
			const val = (m: M2Message, k: number): unknown =>
				m.entries.find((x) => x.fullKey === k)?.value;
			const j = (o: CorrelatedOutcome): string =>
				o.status === "ok" || o.status === "router-error"
					? `${o.status} count=${String(val(o.reply, 0xfe0019))}`
					: o.status;
			console.log(
				`read: [20,3]=${j(c3)} [20,32]=${j(c32)} [20,17]=${g17.status} getall203 rows=${paged.rows.length} pages=${paged.pages} complete=${paged.complete}`,
			);
		} else {
			reqId = nextReqId(reqId);
			const extra =
				as === "u32"
					? [encU32(F_ROWID, rowid), encU32(field, Number(value))]
					: [encU32(F_ROWID, rowid), encStr(field, value)];
			const res = await correlatedRequest(
				session.transport,
				buildRequest([20, 3], CMD_SETOBJ, session.sourceId, reqId, extra),
				reqId,
				{ timeoutMs, onCapture },
			);
			console.log(
				`setobj: status=${res.status}${res.status === "router-error" ? ` errno=${res.errno} errstr=${res.errstr ?? ""}` : ""}`,
			);
		}
	} finally {
		session.close();
	}
	for (const rec of captures) {
		appendCapture(out, { ...rec, ts: "redacted" });
	}
	console.log(`leg-jump: ${sub} records=${captures.length} out=${out}`);
	// Silence unused import if paging path untouched.
	void CMD_GETOBJ;
}

if (import.meta.main) {
	main().catch((e: unknown) => {
		console.error(`leg-jump: ${(e as Error).message}`);
		process.exit(1);
	});
}
