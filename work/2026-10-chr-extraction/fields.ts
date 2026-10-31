// WS-3B field verifier: index (tcode,id,op) sites + row-context.
// Usage: bun fields.ts <asm.txt> <tcode:id,tcode:id..>
// tcodes: u32,string,bool,u64,raw,bytes(be32),addr6,u32_array,message
// Prints per query: sites (addr, fn, op) + sibling field ids in same fn.
const [asmPath, wantRaw] = Bun.argv.slice(2);
if (!asmPath || !wantRaw) {
	console.error("usage: bun fields.ts <asm.txt> <tcode:id,..>");
	process.exit(1);
}
const queries = wantRaw.split(",").map((q) => {
	const [t, id] = q.split(":");
	return { t: t ?? "", id: (id ?? "").toLowerCase() };
});
const asm = (await Bun.file(asmPath).text()).split("\n");
const line = (i: number): string => asm[i] ?? "";
// function starts
const starts: [number, number][] = [];
asm.forEach((l, i) => {
	const m = l.match(/^\s*([0-9a-f]+):\tpush\s+%ebp$/);
	if (m) starts.push([Number.parseInt(m[1] ?? "0", 16), i]);
});
const funcOf = (addr: number) => {
	let f = 0;
	for (const [a] of starts) {
		if (a <= addr) f = a;
		else break;
	}
	return f;
};
interface Site {
	addr: string;
	fn: string;
	op: string;
}
const byFn = new Map<string, string[]>();
const sites: { q: string; s: Site[] }[] = queries.map((q) => ({
	q: `${q.t}:${q.id}`,
	s: [],
}));
asm.forEach((l, i) => {
	const c = l.match(
		/^\s*([0-9a-f]+):\tcall\s+[0-9a-f]+ <_ZNK?2nv7message(6insert|3get|3has|ix)(INS_([0-9A-Za-z_]+))?/,
	);
	if (!c) return;
	let id = "?";
	for (let j = i - 1; j > i - 10; j--) {
		const m = line(j).match(/push\s+\$(0x[0-9a-f]+)$/);
		if (m) {
			id = (m[1] ?? "?").toLowerCase();
			break;
		}
	}
	const t = (c[4] ?? "").replace(/EE.*/, "").replace(/^[0-9]+/, "");
	const addr = Number.parseInt(c[1] ?? "0", 16);
	const fn = `0x${funcOf(addr).toString(16)}`;
	const key = `${t}:${id}`;
	if (!byFn.has(fn)) byFn.set(fn, []);
	byFn.get(fn)?.push(key);
	queries.forEach((q, qi) => {
		const qid = q.id.startsWith("0x")
			? q.id
			: `0x${Number.parseInt(q.id, 10).toString(16)}`;
		if (t.startsWith(q.t) && id === qid) {
			const op =
				c[2] === "6insert"
					? "ins"
					: c[2] === "3get"
						? "get"
						: c[2] === "ix"
							? "ix"
							: "has";
			sites[qi]?.s.push({ addr: `0x${c[1]}`, fn, op });
		}
	});
});
for (const { q, s } of sites) {
	console.log(`== ${q}: ${s.length} sites`);
	for (const x of s.slice(0, 10)) {
		const sibs = (byFn.get(x.fn) ?? []).filter((k) => k !== q);
		console.log(
			`   ${x.op} @${x.addr} fn=${x.fn} sibs[${sibs.length}]: ${sibs.slice(0, 18).join(" ")}`,
		);
	}
}
