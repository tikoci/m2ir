// Phase C proof: NAT action-enum pilot — rule matrix + inverse write.
//
// Experiment sequence per attribute-discovery-plan.md section C, pilot
// slice 3 (route [20,5], field 40 `action`, tcode u32): baseline
// empty-table reads, a control-interface (centrs) rule matrix that adds
// one minimal rule per action value with a distinctive comment,
// native GETALL f40 read-back after each, an inverse native SETOBJ of
// f40 with independent read-back, and restore. Pure value-moves only:
// no jump targets, no custom chains, no packet flow depends on these
// rules. Every native message lands in a per-step JSONL manifest;
// every control call lands in a control-*.json file; the action->f40
// map, inventory, verdicts, and restore proof land in report.yaml.
//
// PENDING BRIEF — NOT YET EXECUTED. Runs only after explicit batched
// approval. Mutations (control and native alike) require both
// --allow-mutations and --disposable; otherwise the script refuses
// before touching the router. Credentials come from quickchr/centrs
// resolution; nothing secret is printed or stored.
//
// Usage:
//   bun work/2026-11-winbox-attributes/harness/prove-nat-action.ts \
//     --quickchr twin3 \
//     --out-dir work/2026-11-winbox-attributes/proof/7.25-nat-action \
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

// Framework verbs (profiles/winbox-ipc/std-commands.yaml). Table writes
// use CMD_SETOBJ with a 0xfe0001 rowid selector — never CMD_SET on a
// table route, never SETOBJ on a singleton route.
const CMD_SETOBJ = 0xfe0003;
const CMD_REMOVEOBJ = 0xfe0006;
const CMD_GETCOUNT = 0xfe0015;

const ROUTE_NAT = [20, 5];
// Field ids from the canonical map (gui-handlers.yaml nat-20-5).
// Shape-gated at runtime: no id is written unless a baseline native
// row carries it.
const F_ACTION = 40;
const F_COMMENT = 0xfe0009;
const F_ROWID = 0xfe0001;

const COMMENT_PREFIX = "m2ir-act-";

// One minimal rule per action value. Actions needing an address target
// carry to-addresses; jump/same stay out of matrix v1 (they need extra
// objects: custom chains / same-* parameters) and are follow-up legs.
const MATRIX: Array<{ action: string; chain: string; extra: string[] }> = [
	{ action: "accept", chain: "srcnat", extra: [] },
	{ action: "drop", chain: "srcnat", extra: [] },
	{ action: "passthrough", chain: "srcnat", extra: [] },
	{ action: "return", chain: "srcnat", extra: [] },
	{ action: "log", chain: "srcnat", extra: [] },
	{
		action: "add-src-to-address-list",
		chain: "srcnat",
		extra: ["address-list=m2ir-probe"],
	},
	{ action: "src-nat", chain: "srcnat", extra: ["to-addresses=198.51.100.99"] },
	{ action: "masquerade", chain: "srcnat", extra: [] },
	{
		action: "netmap",
		chain: "srcnat",
		extra: ["to-addresses=198.51.100.0/24"],
	},
	{ action: "accept", chain: "dstnat", extra: [] },
	{ action: "drop", chain: "dstnat", extra: [] },
	{ action: "dst-nat", chain: "dstnat", extra: ["to-addresses=198.51.100.99"] },
	{ action: "redirect", chain: "dstnat", extra: ["to-ports=8080"] },
	{
		action: "add-dst-to-address-list",
		chain: "dstnat",
		extra: ["address-list=m2ir-probe"],
	},
];

function usage(): never {
	console.error(
		"usage: prove-nat-action.ts --quickchr <name> --out-dir <dir> " +
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
	requireMutationGate(
		{ allowMutations, disposable },
		"phase-C nat-action proof",
	);

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
	const nativeGetCount = async (
		stepFile: string,
		label: string,
	): Promise<number | null> => {
		if (!session) throw new Error("no session");
		const { onCapture, flush } = captureTo(stepFile);
		reqId = nextReqId(reqId);
		const res = await correlatedRequest(
			session.transport,
			buildRequest(ROUTE_NAT, CMD_GETCOUNT, session.sourceId, reqId, []),
			reqId,
			{ timeoutMs, onCapture },
		);
		flush();
		if (res.status !== "ok")
			throw new Error(`${label}: GETCOUNT: ${res.status}`);
		for (const e of losslessMessage(res.reply)) {
			if (
				(e.key === "0xfe0019" || e.key === "0xfe0014") &&
				typeof e.value === "number"
			)
				return e.value;
		}
		return null;
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

	/** Shape gate: refuse to write a field no observed row carries. */
	const shapeGate = (rows: M2Message[], field: number, what: string): void => {
		const key = `0x${field.toString(16).padStart(6, "0")}`;
		const seen = rows.some((row) =>
			losslessMessage(row).some((e) => e.key === key),
		);
		if (!seen)
			throw new Error(
				`shape gate: ${what}: field ${key} absent from observed rows`,
			);
	};

	const rowIdOf = (row: M2Message): number | null => {
		for (const e of losslessMessage(row)) {
			if (e.key === "0xfe0001" && typeof e.value === "number") return e.value;
		}
		return null;
	};
	const actionOf = (row: M2Message): number | null => {
		const key = `0x${F_ACTION.toString(16).padStart(6, "0")}`;
		for (const e of losslessMessage(row)) {
			if (e.key === key && typeof e.value === "number") return e.value;
		}
		return null;
	};
	const findRowByComment = (
		rows: M2Message[],
		comment: string,
	): M2Message | null => {
		for (const row of rows) {
			for (const e of losslessMessage(row)) {
				if (e.key === "0xfe0009" && e.value === comment) return row;
			}
		}
		return null;
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
			const comment = String(
				losslessMessage(row).find((e) => e.key === "0xfe0009")?.value ?? "",
			);
			if (!comment.startsWith(COMMENT_PREFIX)) continue;
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
	const actionMap: Record<string, number> = {};
	try {
		session = await openSession(
			target.host,
			target.port,
			target.user,
			target.pass,
			{ timeoutMs },
		);
		console.log(`prove: auth OK sourceId=${session.sourceId}`);

		// ── step 1: baseline native reads (empty-table shape) ──
		const base = await nativeGetAll("step-01-baseline.jsonl", "step-1");
		const baseCount = await nativeGetCount("step-01-baseline.jsonl", "step-1c");
		console.log(
			`prove: step-1 baseline rows=${(base.rows as M2Message[]).length} count=${baseCount}`,
		);
		steps.push({
			id: "step-1-baseline",
			control: "none (native GETALL + GETCOUNT)",
			native_manifest: "step-01-baseline.jsonl",
			observation: `rows=${(base.rows as M2Message[]).length} count=${baseCount}`,
		});

		// ── step 2: rule matrix — one add/read/remove per action value ──
		let n = 0;
		for (const leg of MATRIX) {
			n += 1;
			const tag = `02-${String(n).padStart(2, "0")}`;
			const comment = `${COMMENT_PREFIX}${leg.chain}-${leg.action}`;
			try {
				controlExec(`control-${tag}-add.json`, [
					"/ip/firewall/nat/add",
					`chain=${leg.chain}`,
					`action=${leg.action}`,
					...leg.extra,
					`comment=${comment}`,
				]);
			} catch (e) {
				// Matrix legs are hypothesis legs: an action the control
				// plane rejects is a recorded negative, not a fatal error.
				steps.push({
					id: `step-2-${leg.chain}-${leg.action}`,
					control: "add rejected by control plane",
					observation: `control-add failed: ${(e as Error).message}`,
				});
				continue;
			}
			recordWrite({
				leg: `step-2-${leg.chain}-${leg.action}`,
				kind: "control",
				verb: "/ip/firewall/nat/add",
				route: "/ip/firewall/nat",
				obj: "new",
				field: "action",
				value: `${leg.chain}/${leg.action}`,
				outcome: "ok",
			});
			const got = await nativeGetAll(`step-${tag}-matrix.jsonl`, tag);
			const row = findRowByComment(got.rows as M2Message[], comment);
			const f40 = row ? actionOf(row) : null;
			if (f40 !== null) actionMap[`${leg.chain}/${leg.action}`] = f40;
			const idRow = controlRetrieve(`control-${tag}-scan.json`).find(
				(r) => String(bracket(r, "comment") ?? "") === comment,
			);
			const num = String(idRow ? bracket(idRow, ".id") : "");
			if (num)
				controlExec(`control-${tag}-rm.json`, [
					"/ip/firewall/nat/remove",
					`numbers=${num}`,
				]);
			recordWrite({
				leg: `step-2-${leg.chain}-${leg.action}-cleanup`,
				kind: "control",
				verb: "/ip/firewall/nat/remove",
				route: "/ip/firewall/nat",
				obj: num || "missing",
				field: "row",
				value: "remove",
				outcome: num ? "ok" : "skipped",
			});
			console.log(`prove: matrix ${leg.chain}/${leg.action}: f40=${f40}`);
			steps.push({
				id: `step-2-${leg.chain}-${leg.action}`,
				control: `add + remove rule action=${leg.action}`,
				native_manifest: `step-${tag}-matrix.jsonl`,
				observation: `f40=${f40}`,
			});
		}

		// ── step 3: inverse native SETOBJ f40 + read-back + independent read ──
		const acceptVal = actionMap["srcnat/accept"];
		const dropVal = actionMap["srcnat/drop"];
		let inverseHolds = false;
		if (acceptVal === undefined || dropVal === undefined) {
			steps.push({
				id: "step-3-inverse-write",
				control: "skipped: matrix lacks srcnat accept/drop f40 values",
				observation: `accept=${acceptVal} drop=${dropVal}`,
			});
		} else {
			const comment = `${COMMENT_PREFIX}inverse`;
			controlExec("control-03-add.json", [
				"/ip/firewall/nat/add",
				"chain=srcnat",
				"action=accept",
				`comment=${comment}`,
			]);
			recordWrite({
				leg: "step-3-add",
				kind: "control",
				verb: "/ip/firewall/nat/add",
				route: "/ip/firewall/nat",
				obj: "new",
				field: "action",
				value: "srcnat/accept",
				outcome: "ok",
			});
			const got = await nativeGetAll("step-03-inverse.jsonl", "step-3");
			const row = findRowByComment(got.rows as M2Message[], comment);
			if (!row)
				throw new Error("step-3: inverse rule missing from native GETALL");
			shapeGate([row], F_ACTION, "step-3");
			shapeGate([row], F_COMMENT, "step-3");
			const rowId = rowIdOf(row);
			if (rowId === null) throw new Error("step-3: inverse rule has no rowid");
			const setAttempt = await nativeObjWrite(
				CMD_SETOBJ,
				[encU32(F_ROWID, rowId), encU32(F_ACTION, dropVal)],
				"step-03-inverse.jsonl",
				"step-3-set",
			);
			recordWrite({
				leg: "step-3-set",
				kind: "native",
				verb: "CMD_SETOBJ",
				route: "[20,5]",
				obj: `rowid=${rowId}`,
				field: "0x000028",
				value: String(dropVal),
				outcome: setAttempt.status,
			});
			const afterNative = await nativeGetAll(
				"step-03-inverse.jsonl",
				"step-3-verify",
			);
			const nativeRow = findRowByComment(
				afterNative.rows as M2Message[],
				comment,
			);
			const nativeF40 = nativeRow ? actionOf(nativeRow) : null;
			const invVerify = controlRetrieve("control-03-native-verify.json").find(
				(r) => String(bracket(r, "comment") ?? "") === comment,
			);
			const invAction = String(
				invVerify ? bracket(invVerify, "action") : "<absent>",
			);
			inverseHolds = nativeF40 === dropVal && invAction === "drop";
			console.log(
				`prove: step-3 SETOBJ f40=${dropVal} outcome=${setAttempt.status} native=${nativeF40} control=${JSON.stringify(invAction)}`,
			);
			steps.push({
				id: "step-3-inverse-write",
				control: "independent centrs retrieve after native SETOBJ",
				native_manifest: "step-03-inverse.jsonl",
				control_manifest: "control-03-native-verify.json",
				observation: `SET outcome=${setAttempt.status}; native=${nativeF40}; control=${JSON.stringify(invAction)}`,
			});
		}

		// ── step 4: restore + fallback + final read ──
		restore("04");
		if (!restored) {
			console.error(
				"prove: step-4 primary restore dirty; trying native fallback",
			);
			await nativeFallbackRemove("04");
		}
		const finalGet = await nativeGetAll("step-04-restored.jsonl", "step-4");
		const finalCount = await nativeGetCount(
			"step-04-restored.jsonl",
			"step-4c",
		);
		steps.push({
			id: "step-4-restore",
			control: "control remove of non-initial rows + verify",
			native_manifest: "step-04-restored.jsonl",
			observation: `final rows=${(finalGet.rows as M2Message[]).length} count=${finalCount} restored=${restored}`,
		});

		const report = {
			proof: "phase-C pilot slice 3: NAT action enum on [20,5] f40, 7.25",
			provenance: {
				machine,
				routeros_version: target.version,
				generated_by: "harness/prove-nat-action.ts",
			},
			steps,
			action_f40_map: actionMap,
			write_inventory: writes,
			distinct_write_count: distinctWriteCount(),
			restore_proof: restoreBranches,
			verdicts: {
				action_enum_mapped: {
					holds: Object.keys(actionMap).length >= 2,
					evidence: JSON.stringify(actionMap),
				},
				native_setobj_f40_effective: {
					holds: inverseHolds,
					evidence: `accept=${acceptVal} drop=${dropVal} inverse=${inverseHolds}`,
				},
				restored: {
					holds: restored,
					evidence: JSON.stringify(restoreBranches),
				},
			},
		};
		writeFileSync(join(outDir, "report.yaml"), yamlStringify(report), "utf8");
		console.log(
			`prove: mapped=${Object.keys(actionMap).length} distinct writes=${distinctWriteCount()} restored=${restored}`,
		);
		console.log(`prove: evidence in ${outDir}`);
	} finally {
		session?.close();
		if (!restored) {
			console.error(
				"prove: session ended before confirmed restore; retrying restore",
			);
			restore("04-retry");
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
