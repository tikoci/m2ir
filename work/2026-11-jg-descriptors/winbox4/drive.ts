// cspell:ignore quickchr nextid
/**
 * Plan step 5: the scripted side of the WinBox 4 run. A person drives
 * WinBox through proxy.ts; this script makes the second-session edits
 * (REST via centrs), marks each UI action in the timeline, and reads the
 * [17] history for WinBox's own writes.
 *
 *   bun drive.ts --quickchr twin3 --out <dir> <command> [args]
 *
 * Commands:
 *   setup                       lab rows: bridge m2ir-br, VLANs m2ir-vl1/2 on
 *                               ether1, ports for both (comments m2ir-p1/p2)
 *   mark <label...>             UI action marker (wall clock)
 *   comment <1|2> <text>        set a port comment over REST (second session)
 *   move <n> <before-n>         REST move (fallback if WinBox cannot move)
 *   remove <n>                  remove port n over REST
 *   readd <n>                   add port n back (comment m2ir-p<n>, new id)
 *   drop <hold-s> [comment <n> <text>] [remove <n>]
 *                               close WinBox's connection at the proxy
 *                               (SIGUSR1), hold new logins for hold-s, and
 *                               make the given REST changes during the hold
 *   print                       REST port list: ids, comments, order
 *   history                     [17] rows with a winbox source in the router's
 *                               whole undo history (up to 100 rows, kept
 *                               across proxy runs: use a fresh CHR or check
 *                               the rows belong to this run)
 *   cleanup                     remove the lab rows
 *
 * Mutating commands need --allow-mutations --disposable. Every command
 * appends to <dir>/marks.jsonl ({wallMs, mark|action, ...}).
 */
import {
	appendFileSync,
	existsSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
	requireMutationGate,
	resolveLabTarget,
} from "../../2026-11-winbox-attributes/harness/target.ts";
import { centrsExec, restRows, UndoListener } from "../undo-lib.ts";
import type { LetterMsg } from "../webfig/m2-letters.ts";

const argv = process.argv.slice(2);
let machine = "";
let outDir = "";
let allowMutations = false;
let disposable = false;
const rest: string[] = [];
for (let i = 0; i < argv.length; i++) {
	const t = argv[i] ?? "";
	if (t === "--quickchr") machine = argv[++i] ?? "";
	else if (t === "--out") outDir = argv[++i] ?? "";
	else if (t === "--allow-mutations") allowMutations = true;
	else if (t === "--disposable") disposable = true;
	else rest.push(t);
}
const [cmd, ...args] = rest;
if (!machine || !outDir || !cmd) {
	console.error(
		"usage: drive.ts --quickchr <name> --out <dir> [--allow-mutations --disposable] <command> [args]",
	);
	process.exit(2);
}
const marksPath = join(outDir, "marks.jsonl");
const log = (o: object) =>
	appendFileSync(
		marksPath,
		`${JSON.stringify({ wallMs: Date.now(), ...o })}\n`,
	);
const gate = (what: string) =>
	requireMutationGate({ allowMutations, disposable }, what);

function exec(cli: string[]) {
	const r = centrsExec(machine, cli);
	if (!r.ok) throw new Error(`${cli.join(" ")}: ${r.error}`);
	return r.data;
}
const PORT = "/interface/bridge/port";
function ports() {
	return restRows(exec([`${PORT}/print`]))
		.filter((r) => (r["interface"] ?? "").startsWith("m2ir-vl"))
		.map((r) => ({
			id: r[".id"],
			interface: r["interface"],
			comment: r["comment"] ?? "",
			nextid: r[".nextid"],
		}));
}
const portId = (n: string) => {
	const p = ports().find((x) => x.interface === `m2ir-vl${n}`);
	if (!p?.id) throw new Error(`no port for m2ir-vl${n}`);
	return p.id;
};
function cleanup() {
	for (const [menu, key] of [
		[PORT, "interface"],
		["/interface/vlan", "name"],
		["/interface/bridge", "name"],
	] as const) {
		for (const r of restRows(exec([`${menu}/print`])))
			if ((r[key] ?? "").startsWith("m2ir-"))
				exec([`${menu}/remove`, `numbers=${r[".id"]}`]);
	}
}

switch (cmd) {
	case "mark": {
		const label = args.join(" ");
		log({ mark: label });
		console.log(`mark: ${label}`);
		break;
	}
	case "setup": {
		gate("step 5 setup");
		cleanup();
		exec(["/interface/bridge/add", "name=m2ir-br"]);
		for (const n of [1, 2])
			exec([
				"/interface/vlan/add",
				`name=m2ir-vl${n}`,
				`vlan-id=${3990 + n}`,
				"interface=ether1",
			]);
		for (const n of [1, 2])
			exec([
				`${PORT}/add`,
				"bridge=m2ir-br",
				`interface=m2ir-vl${n}`,
				`comment=m2ir-p${n}`,
			]);
		const p = ports();
		log({ action: "setup", ports: p });
		console.log(JSON.stringify(p));
		break;
	}
	case "comment": {
		gate("step 5 comment");
		const [n, ...words] = args;
		const text = words.join(" ");
		if (!n || !text.startsWith("m2ir")) throw new Error("comment <n> m2ir...");
		const id = portId(n);
		exec([`${PORT}/set`, `numbers=${id}`, `comment=${text}`]);
		log({ action: "comment", port: n, id, comment: text });
		console.log(`comment: port ${n} (${id}) = ${text}`);
		break;
	}
	case "move": {
		gate("step 5 move");
		const [n, before] = args;
		if (!n || !before) throw new Error("move <n> <before-n>");
		const id = portId(n);
		const dest = portId(before);
		exec([`${PORT}/move`, `numbers=${id}`, `destination=${dest}`]);
		log({ action: "rest-move", id, before: dest });
		break;
	}
	case "remove": {
		gate("step 5 remove");
		const [n] = args;
		if (!n) throw new Error("remove <n>");
		const id = portId(n);
		exec([`${PORT}/remove`, `numbers=${id}`]);
		log({ action: "remove", port: n, id });
		console.log(`remove: port ${n} (${id})`);
		break;
	}
	case "readd": {
		gate("step 5 readd");
		const [n] = args;
		if (!n) throw new Error("readd <n>");
		exec([
			`${PORT}/add`,
			"bridge=m2ir-br",
			`interface=m2ir-vl${n}`,
			`comment=m2ir-p${n}`,
		]);
		const id = portId(n);
		log({ action: "readd", port: n, id });
		console.log(`readd: port ${n} (${id})`);
		break;
	}
	case "drop": {
		const [hold, ...rest2] = args;
		const holdMs = Math.round(Number(hold) * 1000);
		if (!Number.isFinite(holdMs) || holdMs < 0)
			throw new Error("drop <hold-s> [comment <n> <text>] [remove <n>]");
		const plan: Array<[string, string[]]> = [];
		for (let i = 0; i < rest2.length; ) {
			const verb = rest2[i];
			if (verb === "comment") {
				plan.push(["comment", [rest2[i + 1] ?? "", rest2[i + 2] ?? ""]]);
				i += 3;
			} else if (verb === "remove") {
				plan.push(["remove", [rest2[i + 1] ?? ""]]);
				i += 2;
			} else throw new Error(`drop: unknown action ${verb}`);
		}
		if (plan.length) gate("step 5 drop with changes");
		for (const [verb, a] of plan)
			if (!a[0] || (verb === "comment" && !a[1]?.startsWith("m2ir")))
				throw new Error(`drop: bad ${verb} ${a.join(" ")}`);
		// Resolve ids before the drop so the hold is spent on writes only.
		const ids = plan.map(([, a]) => portId(a[0] as string));
		writeFileSync(join(outDir, "drop.json"), JSON.stringify({ holdMs }));
		const pid = Number(readFileSync(join(outDir, "proxy.pid"), "utf8"));
		const signalled = Date.now();
		process.kill(pid, "SIGUSR1");
		log({ action: "drop", holdMs });
		console.log(`drop: proxy ${pid}, hold ${holdMs} ms`);
		await Bun.sleep(300);
		// Record per edit whether it finished inside the proxy's hold (the
		// proxy starts the hold when the signal arrives, about now).
		const when = () =>
			Date.now() - signalled < holdMs ? "drop-hold" : "after-hold";
		plan.forEach(([verb, a], i) => {
			const id = ids[i] as string;
			if (verb === "comment") {
				exec([`${PORT}/set`, `numbers=${id}`, `comment=${a[1]}`]);
				const during = when();
				log({ action: "comment", port: a[0], id, comment: a[1], during });
				console.log(`drop: comment port ${a[0]} (${id}) = ${a[1]} [${during}]`);
			} else {
				exec([`${PORT}/remove`, `numbers=${id}`]);
				const during = when();
				log({ action: "remove", port: a[0], id, during });
				console.log(`drop: remove port ${a[0]} (${id}) [${during}]`);
			}
		});
		break;
	}
	case "print": {
		const p = ports();
		log({ action: "print", ports: p });
		console.log(JSON.stringify(p, null, 1));
		break;
	}
	case "history": {
		// SUBSCRIBE [17] replays the whole history; keep the WinBox rows.
		const target = resolveLabTarget(machine, {
			allowedVersions: ["7.25", "7.26beta4"],
		});
		const capPath = join(outDir, "history-capture.jsonl");
		if (existsSync(capPath))
			throw new Error(`refusing to overwrite ${capPath}`);
		const l = await UndoListener.open(target, "H", capPath, () => "history");
		const rows: LetterMsg[] = await l.rows(3000, 500);
		await l.stop();
		const winbox = rows.filter((r) => String(r["s8"] ?? "").includes("winbox"));
		log({ action: "history", total: rows.length, winbox: winbox.length });
		for (const r of winbox)
			console.log(
				`${r["ufe0001"]} ${r["s8"]} ${r["S9"]} m1=${JSON.stringify(r["m1"])}`,
			);
		break;
	}
	case "cleanup": {
		gate("step 5 cleanup");
		cleanup();
		log({ action: "cleanup" });
		break;
	}
	default:
		throw new Error(`unknown command ${cmd}`);
}
