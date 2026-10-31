// WS-3B handler-table extractor (v6 nova/bin, 32-bit x86).
// Usage: bun handlers.ts <binary> <asm.txt> <id,hex..>
// e.g.: bun handlers.ts rbbios /tmp/rbbios-asm.txt 0x1,0x2,0x3
// Finds `nv::Looper::addHandler` sites, pairs (id → vtable) via the
// malloc+`movl $VT,(%obj)` sequence, dumps vtable slots 9/10/12,
// and lists `nv::message::insert<T>` (field-id → tcode) calls in
// the slot-9 getter.
import { $ } from "bun";

const [bin, asmPath, wantRaw] = Bun.argv.slice(2);
if (!bin || !asmPath || !wantRaw) {
	console.error("usage: bun handlers.ts <binary> <asm.txt> <id,..>");
	process.exit(1);
}
const wantIds = wantRaw.split(",");
const { HOME } = process.env;
const home = HOME ?? "";
const root = `${home}/.local/share/m2ir/extractions/root-6.49.23/nova/bin`;

// .rodata VA → file offset (columns: Name Size VMA LMA FileOff)
const hdr = await $`objdump -h ${root}/${bin}`.text();
const hm = hdr.match(
	/\.rodata\s+[0-9a-f]+\s+([0-9a-f]+)\s+[0-9a-f]+\s+([0-9a-f]+)/,
);
if (!hm) throw new Error("no .rodata header");
const rva = Number.parseInt(hm[1] ?? "", 16);
const roff = Number.parseInt(hm[2] ?? "", 16);
const raw = new Uint8Array(await Bun.file(`${root}/${bin}`).arrayBuffer());
const dv = new DataView(raw.buffer);
const va2off = (a: number) => a - rva + roff;

const asm = (await Bun.file(asmPath).text()).split("\n");
const line = (i: number): string => asm[i] ?? "";
const idx = new Map<string, number>();
asm.forEach((l, i) => {
	const m = l.match(/^\s*([0-9a-f]+):/);
	if (m && !idx.has(m[1] ?? "")) idx.set(m[1] ?? "", i);
});

interface Site {
	id: string;
	addr: string;
	vt: string;
	slots?: Record<string, string>;
	getterLen?: number;
	inserts?: string[];
}
const out: Site[] = [];

asm.forEach((l, i) => {
	const m = l.match(/^\s*([0-9a-f]+):\tcall.*addHandler/);
	if (!m) return;
	// Collect the 3 pushes feeding the call: [obj, id, looper].
	const pushes: string[] = [];
	for (let j = i - 1; j > Math.max(0, i - 12) && pushes.length < 3; j--) {
		if (/call\s+[0-9a-f]+ </.test(line(j))) break;
		const p = line(j).match(
			/push\s+(\$0x[0-9a-f]+|%e[a-z]+|-0x[0-9a-f]+\(%ebp\))/,
		);
		if (p) pushes.unshift(p[1] ?? "");
	}
	const rawId = pushes.length === 3 ? (pushes[1] ?? "?") : "?";
	const id = rawId.startsWith("$") ? rawId.slice(1) : rawId;
	if (!wantIds.includes(id)) return;
	const objPushed = pushes[0] ?? "";
	const entry: Site = { id, addr: `0x${m[1] ?? ""}`, vt: "?" };
	// Vtable: LAST `movl $VT,(%obj)` in (anchor, call) wins (derived
	// ctors overwrite the base vtable).
	const oreg = objPushed.match(/^(%e[a-z]+)$/)?.[1];
	if (oreg) {
		let anchor = Math.max(0, i - 600);
		for (let j = i - 1; j > anchor; j--) {
			if (new RegExp(`mov\\s+%eax,${oreg}$`).test(line(j))) {
				anchor = j;
				break;
			}
		}
		const lo = anchor === Math.max(0, i - 600) ? Math.max(0, i - 60) : anchor;
		for (let k = i - 1; k > lo; k--) {
			const mv = line(k).match(
				new RegExp(`movl?\\s+\\$(0x[0-9a-f]+),\\(${oreg}\\)`),
			);
			if (mv && Number.parseInt(mv[1] ?? "", 16) >= rva) {
				entry.vt = mv[1] ?? "?";
				break;
			}
		}
	}
	if (entry.vt !== "?") {
		const slots: Record<string, string> = {};
		for (const s of [9, 10, 12]) {
			const fn = dv.getUint32(
				va2off(Number.parseInt(entry.vt, 16)) + s * 4,
				true,
			);
			slots[s] = `0x${fn.toString(16)}`;
		}
		entry.slots = slots;
		const at = idx.get(Number.parseInt(slots[9] ?? "0", 16).toString(16));
		if (at !== undefined) {
			let end = Math.min(at + 1500, asm.length);
			for (let k = at + 60; k < Math.min(at + 1500, asm.length); k++) {
				if (/^\s*[0-9a-f]+:\tret\b/.test(line(k))) {
					end = k;
					break;
				}
			}
			entry.getterLen = end - at;
			const ins: string[] = [];
			for (let k = at; k <= end; k++) {
				const c = line(k).match(
					/call\s+[0-9a-f]+ <_ZN2nv7message6insertINS_([0-9A-Za-z_]+)/,
				);
				if (!c) continue;
				const pp: string[] = [];
				for (let p = k - 1; p > Math.max(at, k - 14) && pp.length < 4; p--) {
					const pm = line(p).match(/push\s+(\$0x[0-9a-f]+|%e[a-z]+)/);
					if (pm) pp.unshift(pm[1] ?? "");
				}
				ins.push(`${c[1]}:${pp.filter((x) => x.startsWith("$")).pop() ?? "?"}`);
			}
			entry.inserts = ins;
		}
	}
	out.push(entry);
});
console.log(JSON.stringify(out, null, 1));
