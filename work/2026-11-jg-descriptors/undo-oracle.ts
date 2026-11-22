// cspell:ignore quickchr restraml
/**
 * Plan step 4b: the [17] undo history as a REST/CLI -> M2 oracle.
 *
 *   bun undo-oracle.ts --quickchr <name> --out <dir> \
 *     --deep-inspect <restraml>/docs/<version>/deep-inspect.json \
 *     [--only /ip/dns,/snmp] --allow-mutations --disposable
 *
 * A native session subscribes to [17] (undo-lib.ts). For each menu of the
 * wave in undo-menus.ts, centrs (REST) makes no-op writes: every settable
 * property is SET, one at a time, to the value REST prints for it. Each
 * write records one history row whose m1 is the native request the
 * router built, so the typed keys in m1 belong to that one CLI property
 * (mapping by isolation; undo-report.ts confirms by value). `add` menus
 * first add a disabled row with documentation addresses and remove it at
 * the end; the remove's inverse (Sa, m2) carries the full record.
 *
 * Safety (undo-menus.ts): SKIP_MENUS are refused, SECRET_ARG and
 * SKIP_ARGS properties are never written. Values are unchanged, so the
 * configuration ends as it started; added rows are removed in a finally.
 *
 * Output (scratch, never committed raw): capture.jsonl (pump records with
 * mark = "<menu> <step>"), writes.jsonl (one line per write with its rows,
 * letter-decoded), meta.json.
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	requireMutationGate,
	resolveLabTarget,
} from "../2026-11-winbox-attributes/harness/target.ts";
import { centrsExec, restRows, UndoListener } from "./undo-lib.ts";
import {
	cliMenus,
	type MenuPlan,
	SECRET_ARG,
	SKIP_ARGS,
	SKIP_MENUS,
	WAVE1,
} from "./undo-menus.ts";

const argv = process.argv.slice(2);
const opt = (name: string) => {
	const i = argv.indexOf(name);
	return i >= 0 ? argv[i + 1] : undefined;
};
const machine = opt("--quickchr") ?? "";
const outDir = opt("--out") ?? "";
const deepInspect = opt("--deep-inspect") ?? "";
const only = opt("--only")?.split(",");
if (!machine || !outDir || !deepInspect) {
	console.error(
		"usage: undo-oracle.ts --quickchr <name> --out <dir> --deep-inspect <file> [--only a,b] --allow-mutations --disposable",
	);
	process.exit(2);
}
requireMutationGate(
	{
		allowMutations: argv.includes("--allow-mutations"),
		disposable: argv.includes("--disposable"),
	},
	"undo oracle",
);
mkdirSync(outDir, { recursive: true });
const target = resolveLabTarget(machine, {
	allowedVersions: ["7.25", "7.26beta4"],
});
const menus = cliMenus(deepInspect);
const plans = WAVE1.filter((p) => !only || only.includes(p.path));
const cap = join(outDir, "capture.jsonl");
const writesPath = join(outDir, "writes.jsonl");
writeFileSync(cap, "");
writeFileSync(writesPath, "");
writeFileSync(
	join(outDir, "meta.json"),
	`${JSON.stringify({ machine, routeros_version: target.version, wave: 1, menus: plans.map((p) => p.path), deep_inspect: deepInspect }, null, "\t")}\n`,
);

let mark = "open";
const a = await UndoListener.open(target, "A", cap, () => mark);
// The replay (first subscriber only) is not part of any write.
await a.rows(2500, 500);

type Write = {
	menu: string;
	how: MenuPlan["how"];
	step: string;
	arg?: string;
	value?: string;
	ok: boolean;
	error?: string;
	rows: unknown[];
};

async function write(
	p: MenuPlan,
	step: string,
	cli: string[],
	extra: Partial<Write> = {},
	/** Runs right after the router call, before any diagnostics can fail. */
	onResult?: (r: ReturnType<typeof centrsExec>) => void,
) {
	mark = `${p.path} ${step}`;
	const r = centrsExec(machine, cli);
	onResult?.(r);
	const rows = r.ok ? await a.rows(2000, 300) : [];
	const w: Write = {
		menu: p.path,
		how: p.how,
		step,
		ok: r.ok,
		rows,
		...extra,
		...(r.ok ? {} : { error: r.error }),
	};
	appendFileSync(writesPath, `${JSON.stringify(w)}\n`);
	return { r, w };
}

function pickRow(
	p: MenuPlan,
	rows: Array<Record<string, string>>,
	id?: string,
): Record<string, string> | undefined {
	if (id) return rows.find((x) => x[".id"] === id);
	if (p.find) {
		const [k, v] = p.find.split("=") as [string, string];
		return rows.find((x) => x[k] === v);
	}
	return rows.find((x) => x["dynamic"] !== "true" && x["builtin"] !== "true");
}

const summary: Array<Record<string, unknown>> = [];
try {
	for (const p of plans) {
		if (SKIP_MENUS[p.path])
			throw new Error(`${p.path} is on the skip list: ${SKIP_MENUS[p.path]}`);
		const m = menus.get(p.path);
		if (!m) throw new Error(`${p.path}: not a settable menu in ${deepInspect}`);
		// A remove inverse carries the whole record, secrets included.
		if (p.how === "add" && m.secretArgs.length)
			throw new Error(
				`${p.path}: add plan on a menu with secret properties (${m.secretArgs.join(", ")})`,
			);
		let added: string | undefined;
		let writes = 0;
		let rowsSeen = 0;
		try {
			if (p.how === "add") {
				// Take the new row id before collecting rows or appending the
				// diagnostics, so the finally block can always remove it.
				const retOf = (x: ReturnType<typeof centrsExec>) =>
					x.ok ? (x.data as { ret?: string } | null)?.ret : undefined;
				const { r } = await write(
					p,
					"add",
					[`${p.path}/add`, ...(p.add ?? [])],
					{},
					(x) => {
						added = retOf(x);
					},
				);
				const ret = retOf(r);
				if (!r.ok || !ret) {
					console.log(`oracle: ${p.path}: add failed, skipping (${r.error})`);
					summary.push({ menu: p.path, error: "add failed" });
					continue;
				}
			}
			const printed = centrsExec(machine, [`${p.path}/print`]);
			const row =
				p.how === "singleton"
					? (printed.data as Record<string, string>)
					: pickRow(p, restRows(printed.data), added);
			if (!row) {
				summary.push({ menu: p.path, error: "no target row" });
				continue;
			}
			const selector = p.how === "singleton" ? [] : [`numbers=${row[".id"]}`];
			for (const arg of m.setArgs) {
				if (SKIP_ARGS.test(arg) || SECRET_ARG.test(arg)) continue;
				const printedValue = row[arg];
				if (printedValue === undefined) continue;
				// REST prints booleans as true/false; the CLI parser wants yes/no.
				// Only for arguments the CLI declares boolean (completions yes
				// and no): a string property holding "true" stays as it is.
				const c = m.completions[arg] ?? [];
				const isBool = c.includes("yes") && c.includes("no");
				const value =
					isBool && printedValue === "true"
						? "yes"
						: isBool && printedValue === "false"
							? "no"
							: printedValue;
				const { w } = await write(
					p,
					`set:${arg}`,
					[`${p.path}/set`, ...selector, `${arg}=${value}`],
					{ arg, value },
				);
				writes++;
				rowsSeen += w.rows.length;
			}
		} finally {
			if (added) {
				const { w } = await write(p, "remove", [
					`${p.path}/remove`,
					`numbers=${added}`,
				]);
				if (!w.ok) console.error(`oracle: REMOVE FAILED ${p.path} ${added}`);
			}
		}
		console.log(`oracle: ${p.path}: ${writes} writes, ${rowsSeen} rows`);
		summary.push({ menu: p.path, writes, rows: rowsSeen });
	}
} finally {
	await a.stop();
}
writeFileSync(
	join(outDir, "summary.json"),
	`${JSON.stringify(summary, null, "\t")}\n`,
);
