// WS-1A verdict generator: schema ID<->name entries vs WinBox 3.43 client evidence.
// Evidence sources (all first-party, winbox64.exe unless noted):
//  E1 oracle fn 0x428593: (ff0007,feXXXX)->CMD_*; (ff0008,*)->ERROR_*;
//     (ff0003,*): TYPE_REQUEST/TYPE_REPLY; (ff0004,*): STATUS_OK/STATUS_ERROR.
//  E2 u32 byte occurrences (aligned + unaligned scan).
//  E3 exact ASCII name in binary strings.
import { readFileSync, writeFileSync } from "node:fs";

const ORACLE_CMDS = new Map(
	Object.entries({
		16646144: "CMD_NOOP",
		16646145: "CMD_GETPOLICIES",
		16646146: "CMD_GETOBJ",
		16646147: "CMD_SETOBJ",
		16646148: "CMD_GETALL",
		16646149: "CMD_ADDOBJ",
		16646150: "CMD_REMOVEOBJ",
		16646151: "CMD_MOVEOBJ",
		16646152: "CMD_SETFORM",
		16646155: "CMD_NOTIFY",
		16646157: "CMD_GET",
		16646158: "CMD_SET",
		16646159: "CMD_START",
		16646160: "CMD_POLL",
		16646161: "CMD_CANCEL",
		16646162: "CMD_SUBSCRIBE",
		16646163: "CMD_UNSUBSCRIBE",
		16646164: "CMD_DISCONNECTED",
		16646165: "CMD_GETCOUNT",
		16646166: "CMD_RESET",
	}).map(([k, v]) => [Number(k), v]),
);
const ORACLE_ERRORS = new Map(
	Object.entries({
		0: "ERROR_OK",
		16646145: "ERROR_UNKNOWN",
		16646146: "ERROR_BRKPATH",
		16646147: "ERROR_NOTIMP",
		16646148: "ERROR_UNKNOWNID",
		16646149: "ERROR_MISSING",
		16646150: "ERROR_FAILED",
		16646151: "ERROR_EXISTS",
		16646153: "ERROR_NOTALLOWED",
		16646154: "ERROR_TOOBIG",
		16646155: "ERROR_UNKNOWNNEXTID",
		16646156: "ERROR_BUSY",
		16646157: "ERROR_TIMEOUT",
		16646158: "ERROR_TOOMUCH",
	}).map(([k, v]) => [Number(k), v]),
);
const ORACLE_OUTER = new Set([0xff0003, 0xff0004, 0xff0007, 0xff0008]);

const files = {
	"sys-keys": "profiles/winbox-ipc/sys-keys.yaml",
	"std-keys": "profiles/winbox-ipc/std-keys.yaml",
	"std-commands": "profiles/winbox-ipc/std-commands.yaml",
	"std-errors": "profiles/winbox-ipc/std-errors.yaml",
};
// entries: [file, id, name][]
const entries: { file: string; id: number; name: string }[] = [];
for (const [tag, f] of Object.entries(files)) {
	const t = readFileSync(f, "utf8");
	const lines = t.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const m = (lines[i] ?? "").match(
			/^\s{2}(0x[0-9a-fA-F]+):\s*(\{[^}]*\})?\s*$/,
		);
		if (!m) continue;
		const id = parseInt(m[1] ?? "0x0", 16);
		let name = (m[2] || "").match(/canonical-name:\s*([A-Za-z0-9_]+)/)?.[1];
		if (!name) {
			for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
				const lj = lines[j] ?? "";
				const n = lj.match(/canonical-name:\s*([A-Za-z0-9_]+)/);
				if (n) {
					name = n[1];
					break;
				}
				if (/^\s{2}0x/.test(lj)) break;
			}
		}
		// sys-keys value tables (TYPE_REQUEST etc. under values:)
		entries.push({ file: tag, id, name: name || "(noname)" });
	}
}
// value-table entries: "      1: TYPE_REQUEST" style (best-effort)
for (const [tag, f] of Object.entries(files)) {
	const t = readFileSync(f, "utf8");
	for (const m of t.matchAll(/^\s{6}(\d+):\s*([A-Z][A-Z0-9_]+)\s*$/gm))
		entries.push({
			file: `${tag}:values`,
			id: Number(m[1] ?? "0"),
			name: m[2] ?? "(noname)",
		});
}

const BIN = process.argv[2] || "scratch/winbox64.exe";
const OUT =
	process.argv[3] || "work/2026-10-winbox-client-re/id-name-diff.json";
const b = new Uint8Array(await Bun.file(BIN).arrayBuffer());
const v = new DataView(b.buffer);
const idHits = new Map(); // id -> {aligned:[], unaligned:[]}
const want = new Set(entries.map((e) => e.id));
for (let o = 0; o + 4 <= b.length; o++) {
	const x = v.getUint32(o, true);
	if (want.has(x)) {
		if (!idHits.has(x)) idHits.set(x, { aligned: [], unaligned: [] });
		const h = idHits.get(x);
		(o % 4 === 0 ? h.aligned : h.unaligned).push(o);
	}
}
// names: one strings pass
const strHits = new Map();
{
	const out = await Bun.$`strings -n 3 ${BIN}`.text();
	const lines = out.split("\n");
	const set = new Set(lines);
	for (const e of entries) {
		if (e.name === "(noname)") continue;
		if (set.has(e.name)) strHits.set(e.name, "exact");
		else if (lines.some((l) => l.includes(e.name)))
			strHits.set(e.name, "substr");
	}
}

const verdicts = entries.map((e) => {
	const h = idHits.get(e.id);
	const idEv = h
		? `u32@${[...h.aligned, ...h.unaligned]
				.slice(0, 3)
				.map((o) => o.toString(16))
				.join(",")}`
		: null;
	const nmEv = strHits.get(e.name) ? `str:${strHits.get(e.name)}` : null;
	let orEv = null;
	if (e.file === "std-commands" && ORACLE_CMDS.get(e.id) === e.name)
		orEv = "oracle-CMD";
	else if (e.file === "std-commands" && ORACLE_CMDS.has(e.id))
		orEv = `oracle-MISMATCH:${ORACLE_CMDS.get(e.id)}`;
	if (e.file === "std-errors" && ORACLE_ERRORS.get(e.id) === e.name)
		orEv = "oracle-ERR";
	else if (e.file === "std-errors" && ORACLE_ERRORS.has(e.id))
		orEv = `oracle-MISMATCH:${ORACLE_ERRORS.get(e.id)}`;
	if (e.file === "sys-keys" && ORACLE_OUTER.has(e.id)) orEv = "oracle-outer";
	const verdict = orEv?.startsWith("oracle-MISMATCH")
		? "CONTRADICTED"
		: orEv
			? "CONFIRMED"
			: idEv && nmEv
				? "CONFIRMED"
				: idEv
					? "ID-ONLY"
					: nmEv
						? "NAME-ONLY"
						: "ABSENT";
	return {
		...e,
		id: `0x${e.id.toString(16)}`,
		verdict,
		ev: [orEv, idEv, nmEv].filter(Boolean).join(" + "),
	};
});
const summary: Record<string, number> = {};
for (const x of verdicts) summary[x.verdict] = (summary[x.verdict] || 0) + 1;
writeFileSync(OUT, JSON.stringify({ summary, verdicts }, null, 1));
console.log(JSON.stringify(summary));
for (const x of verdicts.filter((x) => x.verdict !== "CONFIRMED"))
	console.log(x.verdict, x.file, x.id, x.name, x.ev);
