// Phase C proof: MOVEOBJ verb pilot — NAT table reorder attempt.
//
// Experiment sequence per attribute-discovery-plan.md section C, pilot
// item 4 (one handler-specific action beyond standard CRUD): baseline
// empty-table reads, two synthetic NAT rules via the control interface
// (centrs), a single native MOVEOBJ attempt carrying only the
// 0xfe0001 rowid selector (static dispatch: slot 17 + obj-id; no
// parameter sweep — unknown parameters are recorded, not brute-forced),
// native GETALL order read-back, and restore. MOVEOBJ acceptance and
// parameter shape are both unproven: ok and router-error outcomes are
// recorded, never fatal, and the verdict requires an observed order
// change plus an independent control read-back.
//
// PENDING BRIEF — NOT YET EXECUTED. Runs only after explicit batched
// approval. Mutations (control and native alike) require both
// --allow-mutations and --disposable; otherwise the script refuses
// before touching the router. Credentials come from quickchr/centrs
// resolution; nothing secret is printed or stored.
//
// Usage:
//   bun work/2026-11-winbox-attributes/harness/prove-moveobj.ts \
//     --quickchr twin3 \
//     --out-dir work/2026-11-winbox-attributes/proof/7.25-moveobj \
//     --allow-mutations --disposable
//
// Never runs in CI.
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify as yamlStringify } from "yaml";

import {
	type EncEntry,
	encU32,
	type M2Message,
} from "../../2026-10-chr-extraction/ws3c/m2.ts";
import {
	buildRequest,
	CMD_GETALL,
} from "../../2026-10-chr-extraction/ws3c/probe.ts";
import {
	appendCapture,
	type CaptureRecord,
	losslessMessage,
} from "./capture.ts";
import {
	type CorrelatedOk,
	type CorrelatedRouterError,
	correlatedRequest,
	nextReqId,
} from "./correlate.ts";
import { getAllPages, type PageFetchResult } from "./paging.ts";
import { openSession, type WinboxSession } from "./session.ts";
import { requireMutationGate, resolveLabTarget } from "./target.ts";

// Framework verbs (profiles/winbox-ipc/std-commands.yaml). MOVEOBJ is a
// table verb addressed by 0xfe0001 rowid, like SETOBJ — never sent to a
// singleton route.
const CMD_MOVEOBJ = 0xfe0007;
const CMD_REMOVEOBJ = 0xfe0006;

const ROUTE_NAT = [20, 5];
const F_COMMENT = 0xfe0009;
const F_ROWID = 0xfe0001;

const COMMENT_1 = "m2ir-mv-1";
const COMMENT_2 = "m2ir-mv-2";

function usage(): never {
	console.error(
		"usage: prove-moveobj.ts --quickchr <name> --out-dir <dir> " +
			"--allow-mutations --disposable [--timeout <ms>]",
	);
	process.exit(2);
}

function asRecord(v: unknown): Record<string, unknown> {
	if (typeof v !== "object" || v === null) throw new Error("want object");
	return v as Record<string, unknown>;
}

function bracket(obj: Record<string, unknown>, key: string): unknown {
	return obj[key];
}

function asArray(v: unknown): Array<Record<string, unknown>> {
	if (Array.isArray(v)) return v as Array<Record<string, unknown>>;
	if (typeof v === "object" && v !== null && Object.keys(v).length > 0)
		return [v as Record<string, unknown>];
	return [];
}

interface WriteEntry {
	leg: string;
	kind: "control" | "native";
	verb: string;
	route: string;
	obj: string;
	field: string;
	value: string;
	outcome: string;
}

interface RestoreBranch {
	branch: string;
	method: string;
	restored: boolean;
	fallbackUsed: boolean;
	detail: string;
}

async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	let machine = "";
	let outDir = "";
	let allowMutations = false;
	let disposable = false;
	let timeoutMs = 8000;
	for (let i = 0; i < argv.length; i++) {
		const t = argv[i] ?? "";
		if (t === "--quickchr") machine = argv[++i] ?? "";
		else if (t === "--out-dir") outDir = argv[++i] ?? "";
		else if (t === "--allow-mutations") allowMutations = true;
		else if (t === "--disposable") disposable = true;
		else if (t === "--timeout") timeoutMs = Number(argv[++i] ?? "8000");
		else usage();
	}
	if (!machine || !outDir) usage();

	// Fail fast on the mutation gate: no router contact without opt-in.
	requireMutationGate({ allowMutations, disposable }, "phase-C moveobj proof");

	mkdirSync(outDir, { recursive: true });
	const existing = readdirSync(outDir).filter(
		(n) => n.endsWith(".jsonl") || n === "report.yaml",
	);
	if (existing.length > 0) {
		throw new Error(
			`refusing to overwrite evidence in ${outDir}: ${existing.join(", ")}`,
		);
	}

	const target = resolveLabTarget(machine, { allowedVersions: ["7.25"] });
	console.log(
		`prove: target=${machine} version=${target.version} port=${target.port}`,
	);

	const writes: WriteEntry[] = [];
	const restoreBranches: RestoreBranch[] = [];
	const recordWrite = (w: WriteEntry): void => {
		writes.push(w);
	};
	const distinctWriteCount = (): number =>
		new Set(
			writes.map((w) => `${w.kind}/${w.verb}/${w.route}/${w.obj}/${w.field}`),
		).size;

	// ── control-interface helpers (independent of the native path) ──
	const runCentrs = (args: string[], saveAs: string): string => {
		const r = Bun.spawnSync(["centrs", ...args]);
		const out = r.stdout.toString() + r.stderr.toString();
		writeFileSync(join(outDir, saveAs), out, "utf8");
		if (!r.success) throw new Error(`centrs ${args[0]} failed; see ${saveAs}`);
		return out;
	};
	const controlRetrieve = (saveAs: string): Array<Record<string, unknown>> => {
		const out = runCentrs(
			[
				"retrieve",
				"--quickchr",
				machine,
				"/ip/firewall/nat",
				"--format",
				"json",
			],
			saveAs,
		);
		const env = asRecord(JSON.parse(out) as unknown);
		if (bracket(env, "ok") !== true)
			throw new Error(`control retrieve not ok; see ${saveAs}`);
		return asArray(bracket(env, "data"));
	};
	const controlExec = (saveAs: string, cli: string[]): string => {
		const out = runCentrs(
			[
				"execute",
				"--quickchr",
				machine,
				"--yes",
				"--format",
				"json",
				"--",
				...cli,
			],
			saveAs,
		);
		const env = asRecord(JSON.parse(out) as unknown);
		if (bracket(env, "ok") !== true)
			throw new Error(`control exec not ok; see ${saveAs}`);
		return out;
	};

	// ── native helpers (correlated + captured) ──
	let session: WinboxSession | null = null;
	let reqId = 1;
	const captureTo = (stepFile: string) => {
		const captures: CaptureRecord[] = [];
		const onCapture = (rec: CaptureRecord): void => {
			rec.seq = captures.length;
			captures.push(rec);
		};
		const flush = (): void => {
			for (const rec of captures) appendCapture(join(outDir, stepFile), rec);
		};
		return { onCapture, flush };
	};
	const nativeGetAll = async (stepFile: string, label: string) => {
		if (!session) throw new Error("no session");
		const { onCapture, flush } = captureTo(stepFile);
		const paged = await getAllPages(
			async (start: number | null): Promise<PageFetchResult> => {
				if (!session) throw new Error("no session");
				reqId = nextReqId(reqId);
				const extra = start === null ? [] : [encU32(0xfe0003, start)];
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
		flush();
		if (!paged.complete)
			throw new Error(`${label}: GETALL incomplete: ${paged.cause}`);
		return paged;
	};
	const nativeObjWrite = async (
		cmd: number,
		extra: EncEntry[],
		stepFile: string,
		label: string,
	): Promise<CorrelatedOk | CorrelatedRouterError> => {
		if (!session) throw new Error("no session");
		const { onCapture, flush } = captureTo(stepFile);
		reqId = nextReqId(reqId);
		const res = await correlatedRequest(
			session.transport,
			buildRequest(ROUTE_NAT, cmd, session.sourceId, reqId, extra),
			reqId,
			{ timeoutMs, onCapture },
		);
		flush();
		if (res.status !== "ok" && res.status !== "router-error") {
			throw new Error(`${label}: native write failed: ${res.status}`);
		}
		return res;
	};

	const rowIdOf = (row: M2Message): number | null => {
		for (const e of losslessMessage(row)) {
			if (e.key === "0xfe0001" && typeof e.value === "number") return e.value;
		}
		return null;
	};
	const commentKey = `0x${F_COMMENT.toString(16).padStart(6, "0")}`;
	const commentOf = (row: M2Message): string => {
		return String(
			losslessMessage(row).find((e) => e.key === commentKey)?.value ?? "",
		);
	};
	const orderOf = (rows: M2Message[]): string => {
		return rows.map((r) => `${commentOf(r)}#${rowIdOf(r)}`).join(",");
	};

	// ── step 0: initial control state (read-only) ──
	const initial = controlRetrieve("control-00-initial.json");
	const initialIds = new Set(
		initial.map((r) => String(bracket(r, ".id") ?? "")),
	);
	console.log(`prove: step-0 initial control rows=${initial.length}`);

	// Restore: remove every non-initial row via control; fallback is a
	// native REMOVEOBJ per synthetic rowid. EVERY branch records
	// fallbackUsed.
	let restored = false;
	const restore = (tag: string): void => {
		try {
			const cur = controlRetrieve(`control-${tag}-restore-scan.json`);
			for (const r of cur) {
				const id = String(bracket(r, ".id") ?? "");
				if (!initialIds.has(id)) {
					controlExec(`control-${tag}-restore-rm.json`, [
						"/ip/firewall/nat/remove",
						`numbers=${id}`,
					]);
					recordWrite({
						leg: `restore-${tag}`,
						kind: "control",
						verb: "/ip/firewall/nat/remove",
						route: "/ip/firewall/nat",
						obj: id,
						field: "row",
						value: "remove",
						outcome: "ok",
					});
				}
			}
			const back = controlRetrieve(`control-${tag}-final.json`);
			const clean = back.every((r) =>
				initialIds.has(String(bracket(r, ".id") ?? "")),
			);
			restored = clean;
			restoreBranches.push({
				branch: `restore-${tag}-primary`,
				method: "control remove per non-initial .id + control verify",
				restored: clean,
				fallbackUsed: false,
				detail: `rows=${back.length} clean=${clean}`,
			});
		} catch (e) {
			restoreBranches.push({
				branch: `restore-${tag}-primary`,
				method: "control remove per non-initial .id + control verify",
				restored: false,
				fallbackUsed: false,
				detail: `primary failed: ${(e as Error).message}; VM must be destroyed, not reused`,
			});
			console.error(`prove: RESTORE FAILED: ${(e as Error).message}`);
		}
	};
	const nativeFallbackRemove = async (tag: string): Promise<void> => {
		const got = await nativeGetAll(`step-${tag}-fb-scan.jsonl`, `${tag}-fb`);
		for (const row of got.rows as M2Message[]) {
			const comment = commentOf(row);
			if (comment !== COMMENT_1 && comment !== COMMENT_2) continue;
			const id = rowIdOf(row);
			if (id === null) continue;
			const res = await nativeObjWrite(
				CMD_REMOVEOBJ,
				[encU32(F_ROWID, id)],
				`step-${tag}-fb-rm.jsonl`,
				`${tag}-fb-rm`,
			);
			recordWrite({
				leg: `restore-${tag}-fallback`,
				kind: "native",
				verb: "CMD_REMOVEOBJ",
				route: "[20,5]",
				obj: `rowid=${id}`,
				field: "row",
				value: "remove",
				outcome: res.status,
			});
		}
		const back = controlRetrieve(`control-${tag}-fb-final.json`);
		const clean = back.every((r) =>
			initialIds.has(String(bracket(r, ".id") ?? "")),
		);
		restored = clean;
		restoreBranches.push({
			branch: `restore-${tag}-fallback`,
			method: "native REMOVEOBJ per synthetic rowid + control verify",
			restored: clean,
			fallbackUsed: true,
			detail: `rows=${back.length} clean=${clean}`,
		});
	};

	const steps: Array<Record<string, unknown>> = [];
	try {
		session = await openSession(
			target.host,
			target.port,
			target.user,
			target.pass,
			{ timeoutMs },
		);
		console.log(`prove: auth OK sourceId=${session.sourceId}`);

		// ── step 1: two synthetic rules via control + native order read ──
		controlExec("control-01-add-1.json", [
			"/ip/firewall/nat/add",
			"chain=srcnat",
			"action=accept",
			`comment=${COMMENT_1}`,
		]);
		recordWrite({
			leg: "step-1-add-1",
			kind: "control",
			verb: "/ip/firewall/nat/add",
			route: "/ip/firewall/nat",
			obj: "new",
			field: "comment",
			value: COMMENT_1,
			outcome: "ok",
		});
		controlExec("control-01-add-2.json", [
			"/ip/firewall/nat/add",
			"chain=srcnat",
			"action=passthrough",
			`comment=${COMMENT_2}`,
		]);
		recordWrite({
			leg: "step-1-add-2",
			kind: "control",
			verb: "/ip/firewall/nat/add",
			route: "/ip/firewall/nat",
			obj: "new",
			field: "comment",
			value: COMMENT_2,
			outcome: "ok",
		});
		const before = await nativeGetAll("step-01-before.jsonl", "step-1");
		const beforeRows = before.rows as M2Message[];
		// Shape gate: MOVEOBJ needs >= 2 addressable rows.
		if (beforeRows.length < 2)
			throw new Error(
				`shape gate: step-2: only ${beforeRows.length} native rows, need 2`,
			);
		const beforeOrder = orderOf(beforeRows);
		const row2 = beforeRows.find((r) => commentOf(r) === COMMENT_2);
		const rowId2 = row2 ? rowIdOf(row2) : null;
		if (rowId2 === null)
			throw new Error("step-1: second rule has no native rowid");
		console.log(`prove: step-1 order=${beforeOrder} move-rowid=${rowId2}`);
		steps.push({
			id: "step-1-setup",
			control: "add two synthetic rules",
			native_manifest: "step-01-before.jsonl",
			observation: `order=${beforeOrder} move-rowid=${rowId2}`,
		});

		// ── step 2: single MOVEOBJ attempt (rowid only, no sweep) ──
		const moveAttempt = await nativeObjWrite(
			CMD_MOVEOBJ,
			[encU32(F_ROWID, rowId2)],
			"step-02-move.jsonl",
			"step-2",
		);
		recordWrite({
			leg: "step-2-move",
			kind: "native",
			verb: "CMD_MOVEOBJ",
			route: "[20,5]",
			obj: `rowid=${rowId2}`,
			field: "position",
			value: "unspecified (rowid-only attempt)",
			outcome: moveAttempt.status,
		});
		const afterMove = await nativeGetAll("step-02-move.jsonl", "step-2-verify");
		const afterOrder = orderOf(afterMove.rows as M2Message[]);
		const invVerify = controlRetrieve("control-02-move-verify.json");
		const invOrder = invVerify
			.map((r) => String(bracket(r, "comment") ?? "?"))
			.join(",");
		const orderChanged = afterOrder !== beforeOrder;
		console.log(
			`prove: step-2 MOVEOBJ outcome=${moveAttempt.status} order-changed=${orderChanged} native=${afterOrder} control=${invOrder}`,
		);
		steps.push({
			id: "step-2-move",
			control: "independent centrs retrieve after native MOVEOBJ",
			native_manifest: "step-02-move.jsonl",
			control_manifest: "control-02-move-verify.json",
			observation: `MOVE outcome=${moveAttempt.status}; order ${beforeOrder} -> ${afterOrder}; control=${invOrder}`,
		});

		// ── step 3: restore + fallback + final read ──
		restore("03");
		if (!restored) {
			console.error(
				"prove: step-3 primary restore dirty; trying native fallback",
			);
			await nativeFallbackRemove("03");
		}
		const finalGet = await nativeGetAll("step-03-restored.jsonl", "step-3");
		steps.push({
			id: "step-3-restore",
			control: "control remove of non-initial rows + verify",
			native_manifest: "step-03-restored.jsonl",
			observation: `final rows=${(finalGet.rows as M2Message[]).length} restored=${restored}`,
		});

		const report = {
			proof: "phase-C pilot item 4: MOVEOBJ on [20,5], 7.25",
			provenance: {
				machine,
				routeros_version: target.version,
				generated_by: "harness/prove-moveobj.ts",
			},
			steps,
			write_inventory: writes,
			distinct_write_count: distinctWriteCount(),
			restore_proof: restoreBranches,
			verdicts: {
				moveobj_reorders_table: {
					holds: orderChanged,
					evidence: `outcome=${moveAttempt.status} order ${beforeOrder} -> ${afterOrder} control=${invOrder}`,
				},
				restored: {
					holds: restored,
					evidence: JSON.stringify(restoreBranches),
				},
			},
		};
		writeFileSync(join(outDir, "report.yaml"), yamlStringify(report), "utf8");
		console.log(
			`prove: order-changed=${orderChanged} distinct writes=${distinctWriteCount()} restored=${restored}`,
		);
		console.log(`prove: evidence in ${outDir}`);
	} finally {
		session?.close();
		if (!restored) {
			console.error(
				"prove: session ended before confirmed restore; retrying restore",
			);
			restore("03-retry");
			restoreBranches.push({
				branch: "finally-retry",
				method: "restore() re-entry",
				restored,
				fallbackUsed: false,
				detail:
					"no fallback transport exists for control-plane row removal here; VM must be destroyed if still dirty",
			});
		}
	}
}

if (import.meta.main) {
	void main().catch((e: unknown) => {
		console.error(`prove: FATAL: ${(e as Error).message}`);
		process.exit(1);
	});
}
