// WS-3B routerboard owner hunt: row-shape scan across nova/bin ELFs.
// Usage: bun rbscan.ts [root] [bin...]
//   root defaults to the v6 extraction nova/bin; with extra args only
//   those binaries are scanned. Streams `objdump -d` per binary (no
//   /tmp intermediates); groups nv::message inserts by function via the
//   `push %ebp` heuristic (same as fields.ts); scores the routerboard
//   signature {bool:16, u32:4, strings 1,7,9,10,13,15,24,32} per fn.
const { HOME } = process.env;
const root =
	Bun.argv[2] ??
	`${HOME ?? ""}/.local/share/m2ir/extractions/root-6.49.23/nova/bin`;
const only = new Set(Bun.argv.slice(3));

const STR_IDS = new Set([1, 7, 9, 10, 13, 15, 24, 32]);
const FN_RE = /^\s*([0-9a-f]+):\tpush\s+%ebp$/;
const CALL_RE =
	/^\s*([0-9a-f]+):\tcall\s+[0-9a-f]+ <_ZNK?2nv7message(6insert|3get|3has|ix)(INS_([0-9A-Za-z_]+))?/;
const PUSH_RE = /push\s+\$(0x[0-9a-f]+)$/;

const shortT = (t: string): string => {
	const u = t.replace(/EE.*/, "").replace(/^[0-9]+/, "");
	if (u.includes("string")) return "str";
	if (u.startsWith("bool")) return "bool";
	if (u.includes("be32")) return "be32";
	if (u.includes("addr6")) return "addr6";
	if (u.includes("u64")) return "u64";
	if (u.includes("Array") || u.includes("array") || u.includes("vector"))
		return "arr";
	if (u.includes("u32")) return "u32";
	if (u.includes("message")) return "msg";
	if (u.includes("raw")) return "raw";
	return u || "?";
};

interface FnRec {
	ins: string[];
	n: number;
}

async function scanBin(path: string, name: string): Promise<void> {
	const proc = Bun.spawn(["objdump", "-d", "--no-show-raw-insn", path], {
		stdout: "pipe",
		stderr: "ignore",
	});
	const reader = proc.stdout.getReader();
	const dec = new TextDecoder();
	let rest = "";
	let fn = "top";
	const fns = new Map<string, FnRec>();
	const prev: string[] = [];
	let totalIns = 0;
	const rec = (f: string): FnRec => {
		let r = fns.get(f);
		if (!r) {
			r = { ins: [], n: 0 };
			fns.set(f, r);
		}
		return r;
	};
	const feed = (line: string) => {
		const fm = line.match(FN_RE);
		if (fm) fn = `0x${fm[1]}`;
		const cm = line.match(CALL_RE);
		if (cm && (cm[2] === "6insert" || cm[2] === "ix")) {
			let id = "?";
			for (let j = prev.length - 1; j >= 0; j--) {
				const pm = (prev[j] ?? "").match(PUSH_RE);
				if (pm) {
					id = pm[1] ?? "?";
					break;
				}
			}
			const key = `${shortT(cm[4] ?? "")}:${id}`;
			rec(fn).ins.push(key);
			rec(fn).n++;
			totalIns++;
		}
		prev.push(line);
		if (prev.length > 12) prev.shift();
	};
	for (;;) {
		const { done, value } = await reader.read();
		if (value) {
			const chunk = rest + dec.decode(value, { stream: true });
			const parts = chunk.split("\n");
			rest = parts.pop() ?? "";
			for (const l of parts) feed(l);
		}
		if (done) break;
	}
	if (rest) feed(rest);
	await proc.exited;
	if (totalIns === 0) return; // no M2 traffic (or objdump failed)

	interface Hit {
		fn: string;
		n: number;
		bool16: boolean;
		u32_4: boolean;
		strs: number[];
		ins: string[];
	}
	const hits: Hit[] = [];
	const rich: Hit[] = [];
	const anchors: Hit[] = [];
	const small: Hit[] = [];
	for (const [f, r] of fns) {
		if (r.n === 0) continue;
		let bool16 = false;
		let u32_4 = false;
		const strs = new Set<number>();
		for (const k of r.ins) {
			const [t, ids] = k.split(":");
			const id = Number.parseInt(ids ?? "", 16);
			if (t === "bool" && id === 16) bool16 = true;
			if (t === "u32" && id === 4) u32_4 = true;
			if (t === "str" && STR_IDS.has(id)) strs.add(id);
		}
		const h = {
			fn: f,
			n: r.n,
			bool16,
			u32_4,
			strs: [...strs].sort((a, b) => a - b),
			ins: r.ins,
		};
		if (((bool16 || u32_4) && h.strs.length >= 2) || h.strs.length >= 5)
			hits.push(h);
		if (bool16) anchors.push(h);
		if (r.n >= 8) rich.push(h);
		else if (bool16 || u32_4 || h.strs.length >= 1) small.push(h);
	}
	rich.sort((a, b) => b.n - a.n);
	console.log(`== ${name}: ${fns.size} fns, ${totalIns} inserts`);
	for (const h of hits) {
		console.log(
			`   RB? fn=${h.fn} n=${h.n} bool16=${h.bool16 ? 1 : 0} u32:4=${h.u32_4 ? 1 : 0} str=[${h.strs.join(",")}] :: ${h.ins.join(" ")}`,
		);
	}
	for (const h of anchors) {
		if (hits.includes(h)) continue;
		console.log(
			`   anchor fn=${h.fn} n=${h.n} u32:4=${h.u32_4 ? 1 : 0} str=[${h.strs.join(",")}] :: ${[...new Set(h.ins)].join(" ")}`,
		);
	}
	if (small.length > 0)
		console.log(
			`   small(${small.length}): ` +
				small.map((h) => `${h.fn}[${h.ins.join(",")}]`).join(" "),
		);
	for (const h of rich.slice(0, 25)) {
		if (hits.includes(h)) continue;
		const uniq = [...new Set(h.ins)].join(" ");
		console.log(`   top fn=${h.fn} n=${h.n} :: ${uniq}`);
	}
}

const { readdir } = await import("node:fs/promises");
const names = (await readdir(root)).sort();
for (const name of names) {
	if (only.size > 0 && !only.has(name)) continue;
	const path = `${root}/${name}`;
	const f = Bun.file(path);
	if (!(await f.exists())) continue;
	// Skip non-ELF (objdump would fail loudly per file).
	const head = new Uint8Array((await f.arrayBuffer()).slice(0, 4));
	if (head[0] !== 0x7f || head[1] !== 0x45) continue;
	await scanBin(path, name);
}
