// Phase C proof: /ip/address pilot — controlled change + inverse write.
//
// Experiment sequence per attribute-discovery-plan.md section C, pilot
// slice 2 (route [20,1]): baseline native reads, control-interface
// (centrs) add/set with distinctive values, reversal, discriminating
// controls (prefix-without-address, disabled, comment set/unset),
// inverse native SETOBJ with independent read-back, native ADDOBJ of
// a minimal row plus native REMOVEOBJ of that row (add/set/remove
// exercised separately), and restore with a native fallback.
// Every native message lands in a per-step JSONL manifest;
// every control call lands in a control-*.json file; inventory,
// verdicts, and restore proof land in report.yaml.
//
// PENDING BRIEF — NOT YET EXECUTED. Runs only after explicit batched
// approval. Mutations (control and native alike) require both
// --allow-mutations and --disposable; otherwise the script refuses
// before touching the router. Credentials come from quickchr/centrs
// resolution; nothing secret is printed or stored.
//
// Usage:
//   bun work/2026-11-winbox-attributes/harness/prove-ip-address.ts \
//     --quickchr twin3 \
//     --out-dir work/2026-11-winbox-attributes/proof/7.25-ip-address \
//     --allow-mutations --disposable
//
// Never runs in CI.
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify as yamlStringify } from "yaml";

import {
	type EncEntry,
	encStr,
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
const CMD_ADDOBJ = 0xfe0005;
const CMD_REMOVEOBJ = 0xfe0006;

const ROUTE_ADDRESS = [20, 1];
const ROUTE_IFACE = [20, 0];
// Field ids from the canonical map (gui-handlers.yaml ip-address).
// Every id below is shape-gated at runtime: no id is written unless a
// baseline native row carries it.
const F_ADDR = 1;
const F_NETMASK = 3;
const F_IFACE = 10;
const F_COMMENT = 0xfe0009;
const F_ROWID = 0xfe0001;
// [20,0] interface rows: namespace-1 field 6 = name (string).
const F_IFACE_NAME = 0x010006;

const SYN_COMMENT = "m2ir-addr-w1";
const NATIVE_ADD_COMMENT = "m2ir-native-add";
const ADDR_A = "198.51.100.10/24";
const ADDR_PREFIX_ONLY = "198.51.100.10/25";
const ADDR_ADDR_ONLY = "198.51.100.20/25";
const ADDR_NATIVE = "198.51.100.11";
const MASK_24 = "255.255.255.0";

/** Dotted quad -> octets, throwing on malformed input. */
function parseDotted(s: string): [number, number, number, number] {
	const parts = s.split(".").map(Number);
	if (
		parts.length !== 4 ||
		parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)
	) {
		throw new Error(`bad dotted quad: ${JSON.stringify(s)}`);
	}
	return parts as [number, number, number, number];
}

/**
 * be32 field encoder: IPv4 octets travel in network order inside a
 * tcode-0x08 payload (live precedent: 10.0.2.15 -> bytes 0a 00 02 0f).
 * encU32 would pick compact 0x09 for small magnitudes, so force 0x08.
 */
function encBe32(fullKey: number, dotted: string): EncEntry {
	const [a, b, c, d] = parseDotted(dotted);
	const v = (a | (b << 8) | (c << 16) | (d << 24)) >>> 0;
	return { fullKey, tcode: 0x08, value: v };
}

function usage(): never {
	console.error(
		"usage: prove-ip-address.ts --quickchr <name> --out-dir <dir> " +
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
		"phase-C ip-address proof",
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
			["retrieve", "--quickchr", machine, "/ip/address", "--format", "json"],
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
					buildRequest(
						ROUTE_ADDRESS,
						CMD_GETALL,
						session.sourceId,
						reqId,
						extra,
					),
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
			buildRequest(ROUTE_ADDRESS, cmd, session.sourceId, reqId, extra),
			reqId,
			{ timeoutMs, onCapture },
		);
		flush();
		if (res.status !== "ok" && res.status !== "router-error") {
			throw new Error(`${label}: native write failed: ${res.status}`);
		}
		return res;
	};

	/** Shape gate: refuse to write a field no baseline row carries. */
	const shapeGate = (
		rows: M2Message[][],
		field: number,
		what: string,
	): void => {
		const key = `0x${field.toString(16).padStart(6, "0")}`;
		const seen = rows.some((page) =>
			page.some((row) => losslessMessage(row).some((e) => e.key === key)),
		);
		if (!seen)
			throw new Error(
				`shape gate: ${what}: field ${key} absent from baseline rows`,
			);
	};

	const rowIdOf = (row: M2Message): number | null => {
		for (const e of losslessMessage(row)) {
			if (e.key === "0xfe0001" && typeof e.value === "number") return e.value;
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
	/** Resolve the ether1 [20,0] rowid for the F_IFACE reference. */
	const ether1RowId = async (): Promise<number> => {
		if (!session) throw new Error("no session");
		const { onCapture, flush } = captureTo("step-06b-iface-scan.jsonl");
		const paged = await getAllPages(
			async (start: number | null): Promise<PageFetchResult> => {
				if (!session) throw new Error("no session");
				reqId = nextReqId(reqId);
				const extra = start === null ? [] : [encU32(0xfe0003, start)];
				const res = await correlatedRequest(
					session.transport,
					buildRequest(ROUTE_IFACE, CMD_GETALL, session.sourceId, reqId, extra),
					reqId,
					{ timeoutMs, onCapture },
				);
				if (res.status === "ok") return { status: "ok", page: res.reply };
				throw new Error(`iface scan: GETALL page failed: ${res.status}`);
			},
		);
		flush();
		if (!paged.complete) throw new Error("iface scan: GETALL incomplete");
		for (const row of paged.rows as M2Message[]) {
			const entries = losslessMessage(row);
			const name = entries.find(
				(e) => e.key === `0x${F_IFACE_NAME.toString(16).padStart(6, "0")}`,
			)?.value;
			if (name === "ether1") {
				const id = rowIdOf(row);
				if (id === null) throw new Error("iface scan: ether1 row has no rowid");
				return id;
			}
		}
		throw new Error("iface scan: no ether1 row in [20,0]");
	};
	/**
	 * Fallback row removal via native REMOVEOBJ for synthetic rows the
	 * control plane failed to remove. Matches by comment/address only;
	 * never touches rows outside the synthetic set.
	 */
	const nativeFallbackRemove = async (tag: string): Promise<void> => {
		const got = await nativeGetAll(`step-${tag}-fb-scan.jsonl`, `${tag}-fb`);
		for (const row of got.rows as M2Message[]) {
			const entries = losslessMessage(row);
			const comment = String(
				entries.find((e) => e.key === "0xfe0009")?.value ?? "",
			);
			if (comment !== SYN_COMMENT && comment !== NATIVE_ADD_COMMENT) continue;
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
				route: "[20,1]",
				obj: `rowid=${id}`,
				field: "row",
				value: "remove",
				outcome: res.status,
			});
		}
		const back = controlRetrieve(`control-${tag}-fb-final.json`);
		const clean = back.every((r) => initialIds.has(String(r[".id"] ?? "")));
		restored = clean;
		restoreBranches.push({
			branch: `restore-${tag}-fallback`,
			method: "native REMOVEOBJ per synthetic rowid + control verify",
			restored: clean,
			fallbackUsed: true,
			detail: `rows=${back.length} clean=${clean}`,
		});
	};

	// ── step 0: initial control state (read-only) ──
	const initial = controlRetrieve("control-00-initial.json");
	const initialIds = new Set(initial.map((r) => String(r[".id"] ?? "")));
	console.log(`prove: step-0 initial control rows=${initial.length}`);

	// Restore: remove every non-initial row via control; fallback is a
	// native REMOVEOBJ per rowid. EVERY branch records fallbackUsed.
	let restored = false;
	const restore = (tag: string): void => {
		try {
			const cur = controlRetrieve(`control-${tag}-restore-scan.json`);
			for (const r of cur) {
				const id = String(r[".id"] ?? "");
				if (!initialIds.has(id)) {
					controlExec(`control-${tag}-restore-rm.json`, [
						"/ip/address/remove",
						`numbers=${id}`,
					]);
					recordWrite({
						leg: `restore-${tag}`,
						kind: "control",
						verb: "/ip/address/remove",
						route: "/ip/address",
						obj: id,
						field: "row",
						value: "remove",
						outcome: "ok",
					});
				}
			}
			const back = controlRetrieve(`control-${tag}-final.json`);
			const clean = back.every((r) => initialIds.has(String(r[".id"] ?? "")));
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

		// ── step 1: two baseline native reads (volatile check) ──
		const base1 = await nativeGetAll("step-01-baseline.jsonl", "step-1a");
		const base2 = await nativeGetAll("step-01-baseline.jsonl", "step-1b");
		const baseRows = base1.rows as M2Message[];
		shapeGate([baseRows], F_ADDR, "baseline");
		steps.push({
			id: "step-1-baseline",
			control: "none (two unchanged native GETALL)",
			native_manifest: "step-01-baseline.jsonl",
			observation: `reads rows=${baseRows.length}/${(base2.rows as M2Message[]).length}`,
		});

		// ── step 2: control add A + native read-back; capture stable rowid ──
		controlExec("control-02-add-a.json", [
			"/ip/address/add",
			"interface=ether1",
			`address=${ADDR_A}`,
			`comment=${SYN_COMMENT}`,
		]);
		recordWrite({
			leg: "step-2",
			kind: "control",
			verb: "/ip/address/add",
			route: "/ip/address",
			obj: "new",
			field: "address",
			value: ADDR_A,
			outcome: "ok",
		});
		const afterA = await nativeGetAll("step-02-after-a.jsonl", "step-2");
		const rowA = findRowByComment(afterA.rows as M2Message[], SYN_COMMENT);
		if (!rowA)
			throw new Error("step-2: synthetic row missing from native GETALL");
		const rowIdA = rowIdOf(rowA);
		if (rowIdA === null)
			throw new Error("step-2: synthetic row has no 0xfe0001 rowid");
		console.log(`prove: step-2 synthetic rowid=${rowIdA}`);

		// ── step 3: prefix-only change, then address-only change ──
		const idA = controlRetrieve("control-03-scan.json").find(
			(r) => String(bracket(r, "comment") ?? "") === SYN_COMMENT,
		);
		const numA = String(idA?.[".id"] ?? "");
		if (!numA)
			throw new Error("step-3: synthetic row missing from control read");
		controlExec("control-03-prefix.json", [
			"/ip/address/set",
			`numbers=${numA}`,
			`address=${ADDR_PREFIX_ONLY}`,
		]);
		recordWrite({
			leg: "step-3a",
			kind: "control",
			verb: "/ip/address/set",
			route: "/ip/address",
			obj: numA,
			field: "address",
			value: ADDR_PREFIX_ONLY,
			outcome: "ok",
		});
		await nativeGetAll("step-03-after-prefix.jsonl", "step-3a");
		controlExec("control-03-addr.json", [
			"/ip/address/set",
			`numbers=${numA}`,
			`address=${ADDR_ADDR_ONLY}`,
		]);
		recordWrite({
			leg: "step-3b",
			kind: "control",
			verb: "/ip/address/set",
			route: "/ip/address",
			obj: numA,
			field: "address",
			value: ADDR_ADDR_ONLY,
			outcome: "ok",
		});
		await nativeGetAll("step-03-after-addr.jsonl", "step-3b");

		// ── step 4: reverse to A + repeat read ──
		controlExec("control-04-reverse.json", [
			"/ip/address/set",
			`numbers=${numA}`,
			`address=${ADDR_A}`,
		]);
		recordWrite({
			leg: "step-4",
			kind: "control",
			verb: "/ip/address/set",
			route: "/ip/address",
			obj: numA,
			field: "address",
			value: ADDR_A,
			outcome: "ok",
		});
		await nativeGetAll("step-04-after-reverse.jsonl", "step-4");

		// ── step 5: disabled toggle + comment unset (discriminating controls) ──
		controlExec("control-05-disable.json", [
			"/ip/address/set",
			`numbers=${numA}`,
			"disabled=yes",
		]);
		recordWrite({
			leg: "step-5a",
			kind: "control",
			verb: "/ip/address/set",
			route: "/ip/address",
			obj: numA,
			field: "disabled",
			value: "yes",
			outcome: "ok",
		});
		await nativeGetAll("step-05-after-disable.jsonl", "step-5a");
		controlExec("control-05-enable.json", [
			"/ip/address/set",
			`numbers=${numA}`,
			"disabled=no",
		]);
		recordWrite({
			leg: "step-5b",
			kind: "control",
			verb: "/ip/address/set",
			route: "/ip/address",
			obj: numA,
			field: "disabled",
			value: "no",
			outcome: "ok",
		});
		await nativeGetAll("step-05-after-enable.jsonl", "step-5b");
		controlExec("control-05-uncomment.json", [
			"/ip/address/set",
			`numbers=${numA}`,
			"comment=",
		]);
		recordWrite({
			leg: "step-5c",
			kind: "control",
			verb: "/ip/address/set",
			route: "/ip/address",
			obj: numA,
			field: "comment",
			value: "unset",
			outcome: "ok",
		});
		const afterUnset = await nativeGetAll(
			"step-05-after-unset.jsonl",
			"step-5c",
		);
		steps.push({
			id: "step-5-controls",
			control: "disabled yes/no + comment unset on synthetic row",
			observation: `unset rows=${(afterUnset.rows as M2Message[]).length}`,
		});

		// ── step 6: inverse native SETOBJ (comment) + read-back + independent read ──
		shapeGate([afterA.rows as M2Message[]], F_COMMENT, "step-6");
		const setAttempt = await nativeObjWrite(
			CMD_SETOBJ,
			[encU32(F_ROWID, rowIdA), encStr(F_COMMENT, "m2ir-native-w1")],
			"step-06-native-set.jsonl",
			"step-6",
		);
		recordWrite({
			leg: "step-6",
			kind: "native",
			verb: "CMD_SETOBJ",
			route: "[20,1]",
			obj: `rowid=${rowIdA}`,
			field: "0xfe0009",
			value: "m2ir-native-w1",
			outcome: setAttempt.status,
		});
		const afterNative = await nativeGetAll(
			"step-06-native-set.jsonl",
			"step-6-verify",
		);
		const nativeRow = (afterNative.rows as M2Message[]).find(
			(r) => rowIdOf(r) === rowIdA,
		);
		const nativeComment = nativeRow
			? (losslessMessage(nativeRow).find((e) => e.key === "0xfe0009")?.value ??
				"<absent>")
			: "<row-absent>";
		const invVerify = controlRetrieve("control-06-native-verify.json").find(
			(r) => String(r[".id"] ?? "") === numA,
		);
		const invComment = String(
			invVerify ? bracket(invVerify, "comment") : "<absent>",
		);
		console.log(
			`prove: step-6 SETOBJ outcome=${setAttempt.status} native=${JSON.stringify(nativeComment)} control=${JSON.stringify(invComment)}`,
		);
		steps.push({
			id: "step-6-inverse-write",
			control: "independent centrs retrieve after native SETOBJ",
			native_manifest: "step-06-native-set.jsonl",
			control_manifest: "control-06-native-verify.json",
			observation: `SET outcome=${setAttempt.status}; native=${JSON.stringify(nativeComment)}; control=${JSON.stringify(invComment)}`,
		});

		// ── step 6b: native ADDOBJ (minimal row) + read-back + independent read ──
		// Hypothesis leg: [20,1] ADD acceptance is unproven. Router-error
		// outcomes are recorded, not fatal; the verdict requires an
		// independent control read-back.
		shapeGate([afterA.rows as M2Message[]], F_NETMASK, "step-6b");
		shapeGate([afterA.rows as M2Message[]], F_IFACE, "step-6b");
		const etherRow = await ether1RowId();
		const addAttempt = await nativeObjWrite(
			CMD_ADDOBJ,
			[
				encBe32(F_ADDR, ADDR_NATIVE),
				encBe32(F_NETMASK, MASK_24),
				encU32(F_IFACE, etherRow),
				encStr(F_COMMENT, NATIVE_ADD_COMMENT),
			],
			"step-06b-native-add.jsonl",
			"step-6b",
		);
		recordWrite({
			leg: "step-6b",
			kind: "native",
			verb: "CMD_ADDOBJ",
			route: "[20,1]",
			obj: "new",
			field: "row",
			value: `${ADDR_NATIVE}/24`,
			outcome: addAttempt.status,
		});
		const afterAdd = await nativeGetAll(
			"step-06b-native-add.jsonl",
			"step-6b-verify",
		);
		const addedRow = findRowByComment(
			afterAdd.rows as M2Message[],
			NATIVE_ADD_COMMENT,
		);
		const addedRowId = addedRow ? rowIdOf(addedRow) : null;
		const addVerify = controlRetrieve("control-06b-native-verify.json").filter(
			(r) => String(bracket(r, "comment") ?? "") === NATIVE_ADD_COMMENT,
		);
		console.log(
			`prove: step-6b ADDOBJ outcome=${addAttempt.status} native-rowid=${addedRowId} control-rows=${addVerify.length}`,
		);
		steps.push({
			id: "step-6b-native-add",
			control: "independent centrs retrieve after native ADDOBJ",
			native_manifest: "step-06b-native-add.jsonl",
			control_manifest: "control-06b-native-verify.json",
			observation: `ADD outcome=${addAttempt.status}; native-rowid=${addedRowId}; control-rows=${addVerify.length}`,
		});

		// ── step 6c: native REMOVEOBJ of the added row (if created) ──
		let removedNative = false;
		if (addedRowId !== null) {
			const rmAttempt = await nativeObjWrite(
				CMD_REMOVEOBJ,
				[encU32(F_ROWID, addedRowId)],
				"step-06c-native-remove.jsonl",
				"step-6c",
			);
			recordWrite({
				leg: "step-6c",
				kind: "native",
				verb: "CMD_REMOVEOBJ",
				route: "[20,1]",
				obj: `rowid=${addedRowId}`,
				field: "row",
				value: "remove",
				outcome: rmAttempt.status,
			});
			const afterRm = await nativeGetAll(
				"step-06c-native-remove.jsonl",
				"step-6c-verify",
			);
			const stillThere = findRowByComment(
				afterRm.rows as M2Message[],
				NATIVE_ADD_COMMENT,
			);
			const rmVerify = controlRetrieve("control-06c-native-verify.json").filter(
				(r) => String(bracket(r, "comment") ?? "") === NATIVE_ADD_COMMENT,
			);
			removedNative = stillThere === null && rmVerify.length === 0;
			console.log(
				`prove: step-6c REMOVEOBJ outcome=${rmAttempt.status} removed=${removedNative}`,
			);
			steps.push({
				id: "step-6c-native-remove",
				control: "independent centrs retrieve after native REMOVEOBJ",
				native_manifest: "step-06c-native-remove.jsonl",
				control_manifest: "control-06c-native-verify.json",
				observation: `REMOVE outcome=${rmAttempt.status}; removed=${removedNative}`,
			});
		} else {
			steps.push({
				id: "step-6c-native-remove",
				control: "skipped: no native-added row exists",
				observation: "ADDOBJ created no row; nothing to remove natively",
			});
		}

		// ── step 7: restore + fallback + final read ──
		restore("07");
		if (!restored) {
			console.error(
				"prove: step-7 primary restore dirty; trying native fallback",
			);
			await nativeFallbackRemove("07");
		}
		const finalGet = await nativeGetAll("step-07-restored.jsonl", "step-7");
		steps.push({
			id: "step-7-restore",
			control: "control remove of non-initial rows + verify",
			native_manifest: "step-07-restored.jsonl",
			observation: `final rows=${(finalGet.rows as M2Message[]).length} restored=${restored}`,
		});

		const report = {
			proof: "phase-C pilot slice 2: /ip/address route [20,1] on 7.25",
			provenance: {
				machine,
				routeros_version: target.version,
				synthetic_rowid: rowIdA,
				values: {
					a: ADDR_A,
					prefix_only: ADDR_PREFIX_ONLY,
					addr_only: ADDR_ADDR_ONLY,
				},
				generated_by: "harness/prove-ip-address.ts",
			},
			steps,
			write_inventory: writes,
			distinct_write_count: distinctWriteCount(),
			restore_proof: restoreBranches,
			verdicts: {
				synthetic_row_tracked_by_rowid: {
					holds: rowIdA !== null,
					evidence: `rowid=${rowIdA}`,
				},
				native_setobj_comment_effective: {
					holds: invComment === "m2ir-native-w1",
					evidence: `native=${JSON.stringify(nativeComment)} control=${JSON.stringify(invComment)}`,
				},
				native_addobj_effective: {
					holds: addedRowId !== null && addVerify.length === 1,
					evidence: `outcome=${addAttempt.status} rowid=${addedRowId} control-rows=${addVerify.length}`,
				},
				native_removeobj_effective: {
					holds: addedRowId === null ? true : removedNative,
					evidence:
						addedRowId === null
							? "no native row existed; vacuous"
							: `removed=${removedNative}`,
				},
				restored: {
					holds: restored,
					evidence: JSON.stringify(restoreBranches),
				},
			},
		};
		writeFileSync(join(outDir, "report.yaml"), yamlStringify(report), "utf8");
		console.log(
			`prove: distinct writes=${distinctWriteCount()} restored=${restored}`,
		);
		console.log(`prove: evidence in ${outDir}`);
	} finally {
		session?.close();
		if (!restored) {
			console.error(
				"prove: session ended before confirmed restore; retrying restore",
			);
			restore("07-retry");
			restoreBranches.push({
				branch: "finally-retry",
				method: "restore() re-entry",
				restored,
				fallbackUsed: false,
				detail:
					"no fallback transport exists for control-plane row removal; VM must be destroyed if still dirty",
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
