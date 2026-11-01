// Phase C proof: /system/identity pilot — controlled change + inverse write.
//
// Experiment sequence per attribute-discovery-plan.md §C, pilot slice 1
// (route [24,1]): baseline native reads, control-interface (centrs)
// mutations with distinctive values, reversal, a read-only discriminating
// probe of field 13, an inverse native SET of field 12, independent
// read-back, and restore. Every native message lands in a per-step JSONL
// manifest (lossless capture); every control call lands in a control-*.json
// file; step-07 diffs and verdicts land in report.yaml.
//
// Usage:
//   bun work/2026-11-winbox-attributes/harness/prove-identity.ts \
//     --quickchr twin3 \
//     --out-dir work/2026-11-winbox-attributes/proof/7.25-identity \
//     --allow-mutations --disposable
//
// Never runs in CI. Mutations (control and native alike) require both
// --allow-mutations and --disposable; otherwise the script refuses before
// touching the router. Credentials come from quickchr/centrs resolution;
// nothing secret is printed or stored.
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify as yamlStringify } from "yaml";

import {
	type EncEntry,
	encStr,
	type M2Message,
} from "../../2026-10-chr-extraction/ws3c/m2.ts";
import {
	buildRequest,
	CMD_GET,
	CMD_SET,
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
import { openSession, type WinboxSession } from "./session.ts";
import { requireMutationGate, resolveLabTarget } from "./target.ts";

const ROUTE_IDENTITY = [24, 1];
const FIELD_NAME = 12;
const FIELD_VERSION = 13;

function usage(): never {
	console.error(
		"usage: prove-identity.ts --quickchr <name> --out-dir <dir> " +
			"--allow-mutations --disposable [--timeout <ms>] " +
			"[--value-a <n>] [--value-b <n>] [--value-native <n>]",
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

interface StepDiff {
	from: string;
	to: string;
	changed: Array<{
		key: string;
		tcode: string;
		from: unknown;
		to: unknown;
	}>;
}

/** Flatten one decoded GET reply to key -> rendered value for diffing. */
function snapshotEntries(
	msg: M2Message,
): Map<string, { tcode: string; value: unknown }> {
	const out = new Map<string, { tcode: string; value: unknown }>();
	for (const e of losslessMessage(msg)) {
		out.set(e.key, { tcode: e.tcode, value: e.value });
	}
	return out;
}

function diffSnapshots(
	fromLabel: string,
	from: Map<string, { tcode: string; value: unknown }>,
	toLabel: string,
	to: Map<string, { tcode: string; value: unknown }>,
): StepDiff {
	const changed: StepDiff["changed"] = [];
	for (const [key, f] of from) {
		const t = to.get(key);
		const fJson = JSON.stringify({ tcode: f.tcode, value: f.value });
		const tJson = t
			? JSON.stringify({ tcode: t.tcode, value: t.value })
			: "<absent>";
		if (fJson !== tJson) {
			changed.push({
				key,
				tcode: f.tcode,
				from: f.value,
				to: t ? t.value : "<absent>",
			});
		}
	}
	for (const [key, t] of to) {
		if (!from.has(key)) {
			changed.push({
				key,
				tcode: t.tcode,
				from: "<absent>",
				to: t.value,
			});
		}
	}
	return { from: fromLabel, to: toLabel, changed };
}

/** User-namespace changes only: sys (0xff) and command (0xfe) keys are transport echo. */
function userChanged(d: StepDiff | undefined): StepDiff["changed"] {
	if (!d) return [];
	return d.changed.filter(
		(c) => !c.key.startsWith("0xff") && !c.key.startsWith("0xfe"),
	);
}

async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	let machine = "";
	let outDir = "";
	let allowMutations = false;
	let disposable = false;
	let timeoutMs = 8000;
	let valueA = "m2ir-proof-a";
	let valueB = "m2ir-proof-b";
	let valueNative = "m2ir-native-w1";
	for (let i = 0; i < argv.length; i++) {
		const t = argv[i] ?? "";
		if (t === "--quickchr") machine = argv[++i] ?? "";
		else if (t === "--out-dir") outDir = argv[++i] ?? "";
		else if (t === "--allow-mutations") allowMutations = true;
		else if (t === "--disposable") disposable = true;
		else if (t === "--timeout") timeoutMs = Number(argv[++i] ?? "8000");
		else if (t === "--value-a") valueA = argv[++i] ?? valueA;
		else if (t === "--value-b") valueB = argv[++i] ?? valueB;
		else if (t === "--value-native") valueNative = argv[++i] ?? valueNative;
		else usage();
	}
	if (!machine || !outDir) usage();

	// Fail fast on the mutation gate: no router contact without opt-in.
	requireMutationGate({ allowMutations, disposable }, "phase-C identity proof");

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

	// ── control-interface helpers (independent of the native path) ──
	const runCentrs = (args: string[], saveAs: string): string => {
		const r = Bun.spawnSync(["centrs", ...args]);
		const out = r.stdout.toString() + r.stderr.toString();
		writeFileSync(join(outDir, saveAs), out, "utf8");
		if (!r.success) throw new Error(`centrs ${args[0]} failed; see ${saveAs}`);
		return out;
	};
	const controlRetrieve = (saveAs: string): string => {
		const out = runCentrs(
			[
				"retrieve",
				"--quickchr",
				machine,
				"/system/identity",
				"--format",
				"json",
			],
			saveAs,
		);
		const env = asRecord(JSON.parse(out) as unknown);
		if (bracket(env, "ok") !== true) {
			throw new Error(`control retrieve not ok; see ${saveAs}`);
		}
		const data = asRecord(bracket(env, "data") as unknown);
		const name = bracket(data, "name");
		if (typeof name !== "string") throw new Error("control retrieve: no name");
		return name;
	};
	const controlSet = (name: string, saveAs: string): void => {
		const out = runCentrs(
			[
				"execute",
				"--quickchr",
				machine,
				"--yes",
				"--format",
				"json",
				"--",
				"/system/identity/set",
				`name=${name}`,
			],
			saveAs,
		);
		const env = asRecord(JSON.parse(out) as unknown);
		if (bracket(env, "ok") !== true) {
			throw new Error(`control set ${name} not ok; see ${saveAs}`);
		}
	};

	// ── native helpers (correlated + captured) ──
	let session: WinboxSession | null = null;
	let reqId = 1;
	const nativeGet = async (
		stepFile: string,
		label: string,
	): Promise<{
		reply: M2Message;
		statusWord: number | null;
		rawHex: string;
	}> => {
		if (!session) throw new Error("no session");
		const captures: CaptureRecord[] = [];
		reqId = nextReqId(reqId);
		const res = await correlatedRequest(
			session.transport,
			buildRequest(ROUTE_IDENTITY, CMD_GET, session.sourceId, reqId, []),
			reqId,
			{
				timeoutMs,
				onCapture: (rec) => {
					rec.seq = captures.length;
					captures.push(rec);
				},
			},
		);
		for (const rec of captures) appendCapture(join(outDir, stepFile), rec);
		if (res.status !== "ok") {
			throw new Error(`${label}: native GET failed: ${res.status}`);
		}
		return { reply: res.reply, statusWord: res.statusWord, rawHex: res.rawHex };
	};
	const nativeSet = async (
		extra: EncEntry[],
		stepFile: string,
		label: string,
	): Promise<CorrelatedOk | CorrelatedRouterError> => {
		if (!session) throw new Error("no session");
		const captures: CaptureRecord[] = [];
		reqId = nextReqId(reqId);
		const res = await correlatedRequest(
			session.transport,
			buildRequest(ROUTE_IDENTITY, CMD_SET, session.sourceId, reqId, extra),
			reqId,
			{
				timeoutMs,
				onCapture: (rec) => {
					rec.seq = captures.length;
					captures.push(rec);
				},
			},
		);
		for (const rec of captures) appendCapture(join(outDir, stepFile), rec);
		if (res.status !== "ok" && res.status !== "router-error") {
			throw new Error(`${label}: native SET failed: ${res.status}`);
		}
		return res;
	};

	// ── step 0: initial control state (read-only) ──
	const originalName = controlRetrieve("control-00-initial.json");
	console.log(
		`prove: step-0 initial control name=${JSON.stringify(originalName)}`,
	);

	let restored = false;
	const restore = (): void => {
		try {
			controlSet(originalName, "control-07-restore.json");
			const back = controlRetrieve("control-07-final.json");
			restored = back === originalName;
			console.log(`prove: restore name=${JSON.stringify(back)} ok=${restored}`);
		} catch (e) {
			console.error(`prove: RESTORE FAILED: ${(e as Error).message}`);
		}
	};

	const diffs: StepDiff[] = [];
	const steps: Array<Record<string, unknown>> = [];
	try {
		session = await openSession(
			target.host,
			target.port,
			target.user,
			target.pass,
			{
				timeoutMs,
			},
		);
		console.log(`prove: auth OK sourceId=${session.sourceId}`);

		// ── step 1: two baseline native reads (volatile check) ──
		const base1 = await nativeGet("step-01-baseline.jsonl", "step-1a");
		const base2 = await nativeGet("step-01-baseline.jsonl", "step-1b");
		const snapBase1 = snapshotEntries(base1.reply);
		const snapBase2 = snapshotEntries(base2.reply);
		const volatileDiff = diffSnapshots(
			"baseline-read-1",
			snapBase1,
			"baseline-read-2",
			snapBase2,
		);
		diffs.push(volatileDiff);
		console.log(
			`prove: step-1 baseline reads: fields=${snapBase1.size} ` +
				`volatile-changes=${volatileDiff.changed.length} ` +
				`statusWord=${base1.statusWord ?? "absent"}`,
		);
		steps.push({
			id: "step-1-baseline",
			control: "none (two unchanged native reads)",
			native_manifest: "step-01-baseline.jsonl",
			observation: `two GET [24,1] replies; ${volatileDiff.changed.length} differing entries`,
		});

		// ── steps 2-4: control mutations A, B, reverse-to-A ──
		controlSet(valueA, "control-02-set-a.json");
		const afterA = await nativeGet("step-02-after-a.jsonl", "step-2");
		const snapA = snapshotEntries(afterA.reply);
		diffs.push(
			diffSnapshots("baseline", snapBase1, `control=${valueA}`, snapA),
		);
		console.log(`prove: step-2 control set ${valueA}: native GET captured`);

		controlSet(valueB, "control-03-set-b.json");
		const afterB = await nativeGet("step-03-after-b.jsonl", "step-3");
		const snapB = snapshotEntries(afterB.reply);
		diffs.push(
			diffSnapshots(`control=${valueA}`, snapA, `control=${valueB}`, snapB),
		);
		console.log(`prove: step-3 control set ${valueB}: native GET captured`);

		controlSet(valueA, "control-04-reverse-a.json");
		const afterRev = await nativeGet("step-04-after-reverse.jsonl", "step-4");
		const snapRev = snapshotEntries(afterRev.reply);
		diffs.push(
			diffSnapshots(`control=${valueB}`, snapB, `reverse=${valueA}`, snapRev),
		);
		console.log(`prove: step-4 reverse to ${valueA}: native GET captured`);
		steps.push(
			{
				id: "step-2-set-a",
				control: `centrs set name=${valueA}`,
				control_manifest: "control-02-set-a.json",
				native_manifest: "step-02-after-a.jsonl",
			},
			{
				id: "step-3-set-b",
				control: `centrs set name=${valueB}`,
				control_manifest: "control-03-set-b.json",
				native_manifest: "step-03-after-b.jsonl",
			},
			{
				id: "step-4-reverse-a",
				control: `centrs set name=${valueA} (reversal)`,
				control_manifest: "control-04-reverse-a.json",
				native_manifest: "step-04-after-reverse.jsonl",
			},
		);

		// ── step 5: read-only discriminating probe (field 13 = version) ──
		const roAttempt = await nativeSet(
			[encStr(FIELD_VERSION, "9.99-proof")],
			"step-05-ro-probe.jsonl",
			"step-5",
		);
		const afterRo = await nativeGet("step-05-ro-probe.jsonl", "step-5-verify");
		const snapRo = snapshotEntries(afterRo.reply);
		diffs.push(
			diffSnapshots(`reverse=${valueA}`, snapRev, "after-ro-probe", snapRo),
		);
		const roVerifyName = controlRetrieve("control-05-ro-verify.json");
		const roReplyEntries = losslessMessage(roAttempt.reply);
		console.log(
			`prove: step-5 native SET field-13 outcome=${roAttempt.status} ` +
				`errno=${roAttempt.errno ?? "null"} errstr=${JSON.stringify(roAttempt.errstr)} ` +
				`control-name=${JSON.stringify(roVerifyName)}`,
		);
		steps.push({
			id: "step-5-ro-probe",
			control:
				"none (native SET field 13 to 9.99-proof, then GET + control read)",
			native_manifest: "step-05-ro-probe.jsonl",
			control_manifest: "control-05-ro-verify.json",
			observation:
				`SET outcome=${roAttempt.status} errno=${roAttempt.errno ?? "null"}; ` +
				`reply=${JSON.stringify(roReplyEntries)}`,
		});

		// ── step 6: inverse native write (field 12) + independent read ──
		const invAttempt = await nativeSet(
			[encStr(FIELD_NAME, valueNative)],
			"step-06-native-set.jsonl",
			"step-6",
		);
		const afterInv = await nativeGet(
			"step-06-native-set.jsonl",
			"step-6-verify",
		);
		const snapInv = snapshotEntries(afterInv.reply);
		diffs.push(
			diffSnapshots("after-ro-probe", snapRo, `native=${valueNative}`, snapInv),
		);
		const invVerifyName = controlRetrieve("control-06-native-verify.json");
		const invReplyEntries = losslessMessage(invAttempt.reply);
		console.log(
			`prove: step-6 native SET field-12=${valueNative} outcome=${invAttempt.status} ` +
				`independent-read=${JSON.stringify(invVerifyName)}`,
		);
		steps.push({
			id: "step-6-inverse-write",
			control: `independent centrs retrieve after native SET (want ${valueNative})`,
			native_manifest: "step-06-native-set.jsonl",
			control_manifest: "control-06-native-verify.json",
			observation:
				`SET outcome=${invAttempt.status} statusWord=${invAttempt.status === "ok" ? (invAttempt.statusWord ?? "absent") : "n/a"}; ` +
				`reply=${JSON.stringify(invReplyEntries)}; independent name=${JSON.stringify(invVerifyName)}`,
		});

		// ── step 7: restore via control interface + final native read ──
		restore();
		const finalGet = await nativeGet("step-07-restored.jsonl", "step-7");
		const snapFinal = snapshotEntries(finalGet.reply);
		diffs.push(
			diffSnapshots(
				`native=${valueNative}`,
				snapInv,
				`restored=${originalName}`,
				snapFinal,
			),
		);
		steps.push({
			id: "step-7-restore",
			control: `centrs set name=${originalName} (restore)`,
			control_manifest: "control-07-restore.json + control-07-final.json",
			native_manifest: "step-07-restored.jsonl",
		});

		// ── verdicts (computed, not assumed) ──
		const userKey = (n: number): string =>
			`0x${n.toString(16).padStart(6, "0")}`;
		const nameKey = userKey(FIELD_NAME);
		const versionKey = userKey(FIELD_VERSION);
		const nameFollowsControl =
			snapA.get(nameKey)?.value === valueA &&
			snapB.get(nameKey)?.value === valueB &&
			snapRev.get(nameKey)?.value === valueA;
		const u1 = userChanged(diffs[1]);
		const u2 = userChanged(diffs[2]);
		const u3 = userChanged(diffs[3]);
		const onlyNameMoved =
			u1.length === 1 &&
			u1[0]?.key === nameKey &&
			u2.length === 1 &&
			u2[0]?.key === nameKey &&
			u3.length === 1 &&
			u3[0]?.key === nameKey;
		const versionStable =
			snapBase1.get(versionKey)?.value === "7.25" &&
			snapRo.get(versionKey)?.value === "7.25";
		const inverseConfirmed = invVerifyName === valueNative;
		const verdicts = {
			field_12_is_writable_name: {
				holds: nameFollowsControl && onlyNameMoved && inverseConfirmed,
				evidence: `control A/B/reverse move only ${nameKey}; native SET ${nameKey}=${valueNative} reads back ${JSON.stringify(invVerifyName)} via independent control`,
			},
			field_13_is_readonly_version: {
				holds: versionStable,
				evidence: `version stays "7.25" across control renames and native SET attempt (outcome=${roAttempt.status}); control name after probe=${JSON.stringify(roVerifyName)}`,
			},
			volatile_baseline: {
				changed_entries: volatileDiff.changed.length,
				user_changed_entries: userChanged(volatileDiff).length,
				detail: volatileDiff.changed,
			},
		};

		const report = {
			proof: "phase-C pilot slice 1: /system/identity route [24,1] on 7.25",
			provenance: {
				machine,
				routeros_version: target.version,
				original_name: originalName,
				values: { a: valueA, b: valueB, native: valueNative },
				generated_by: "harness/prove-identity.ts",
			},
			steps,
			diffs,
			verdicts,
		};
		writeFileSync(join(outDir, "report.yaml"), yamlStringify(report), "utf8");
		console.log(`prove: verdicts ${JSON.stringify(verdicts, null, 0)}`);
		console.log(`prove: evidence in ${outDir}`);
	} finally {
		session?.close();
		if (!restored) {
			console.error(
				"prove: session ended before confirmed restore; retrying restore",
			);
			restore();
		}
	}
}

void main().catch((e: unknown) => {
	console.error(`prove: FATAL: ${(e as Error).message}`);
	process.exit(1);
});
