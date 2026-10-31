// WS-3B .x3 parser — grammar reverse-engineered from libuxml++.so accessors:
//   Node @p:      [len][tag][attrlen][attrs:attrlen B][children]
//                   children @p+12+attrlen, end @p+4+len
//   AttrList:     header IS node's attrlen slot (this=p+8, list[0]=attrlen)
//                   items step len+4, end = children start
//   Attribute @q: [len][id][etype][count][slen][values][text]
//                   total = 20 + esize[etype]*count + slen = len+4
//   esize = [1,1,4,4] (from libuxml .rodata @0x2000: ".x3\0",1,1,4,4)
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ESIZE = [1, 1, 4, 4];
export interface X3Attr {
	id: number;
	etype: number;
	vals: number[];
	text: string;
}
interface X3Node {
	tag: number;
	attrs: X3Attr[];
	kids: X3Node[];
}
export interface X3Doc {
	ok: boolean;
	errs: string[];
	root: X3Node | null;
	path: string;
}
export function parseX3(buf: Uint8Array, path = ""): X3Doc {
	const v = new DataView(buf.buffer, buf.byteOffset, buf.length);
	const u32 = (o: number) => v.getUint32(o, true);
	const errs: string[] = [];
	function attr(q: number, end: number): (X3Attr & { _len: number }) | null {
		if (q + 20 > end) {
			errs.push(`attr@${q}: header overruns`);
			return null;
		}
		const [len, id, etype, count, slen] = [
			u32(q),
			u32(q + 4),
			u32(q + 8),
			u32(q + 12),
			u32(q + 16),
		];
		if (etype > 3) {
			errs.push(`attr@${q}: bad etype ${etype}`);
			return null;
		}
		const esz: number = ESIZE[etype] ?? 0;
		const total = 20 + esz * count + slen;
		if (total !== len + 4) {
			errs.push(`attr@${q}: size mismatch total=${total} len=${len}`);
			return null;
		}
		if (q + total > end) {
			errs.push(`attr@${q}: overruns region`);
			return null;
		}
		const vals: number[] = [];
		for (let i = 0; i < count; i++) {
			const o = q + 20 + i * esz;
			vals.push(esz === 1 ? (buf[o] ?? 0) : u32(o));
		}
		const text = Buffer.from(
			buf.subarray(q + 20 + esz * count, q + total),
		).toString();
		return { id, etype, vals, text, _len: total };
	}
	function node(
		p: number,
		end: number,
		depth: number,
	): (X3Node & { _off: number }) | null {
		if (p + 12 > end) {
			errs.push(`node@${p}: header overruns`);
			return null;
		}
		if (depth > 32) {
			errs.push(`node@${p}: too deep`);
			return null;
		}
		const [len, tag, attrlen] = [u32(p), u32(p + 4), u32(p + 8)];
		const nend = p + 4 + len;
		if (nend > end) {
			errs.push(`node@${p}: overruns parent end`);
			return null;
		}
		const cstart = p + 12 + attrlen;
		if (cstart > nend) {
			errs.push(`node@${p}: attrlen overruns`);
			return null;
		}
		const attrs: X3Attr[] = [];
		for (let q = p + 12; q < cstart; ) {
			const a = attr(q, cstart);
			if (!a) break;
			attrs.push(a);
			q += a._len;
		}
		const kids: X3Node[] = [];
		for (let k = cstart; k < nend; ) {
			if (k + 4 > nend) {
				errs.push(`node@${p}: child len overruns`);
				break;
			}
			const kl = u32(k);
			const c = node(k, nend, depth + 1);
			if (!c) break;
			kids.push(c);
			k += 4 + kl;
		}
		return { tag, attrs, kids, _off: p };
	}
	if (buf.length < 4)
		return { ok: false, errs: ["too small"], root: null, path };
	const root = node(0, buf.length, 0);
	const ok = errs.length === 0 && root !== null && 4 + u32(0) === buf.length;
	if (root && 4 + u32(0) !== buf.length)
		errs.push(`root len mismatch: ${u32(0)} vs ${buf.length - 4}`);
	return { ok, errs, root, path };
}

if (import.meta.main) {
	const roots = process.argv.slice(2);
	const files: string[] = [];
	for (const r of roots) {
		const walk = (d: string) => {
			for (const e of readdirSync(d, { withFileTypes: true })) {
				const p = join(d, e.name);
				if (e.isDirectory()) walk(p);
				else if (e.name.endsWith(".x3")) files.push(p);
			}
		};
		walk(r);
	}
	let ok = 0;
	for (const f of files.sort()) {
		const r = parseX3(new Uint8Array(readFileSync(f)), f);
		const count = (n: X3Node | null): number =>
			!n ? 0 : 1 + n.kids.reduce((a: number, c: X3Node) => a + count(c), 0);
		const errSuffix = r.ok ? "" : ` :: ${r.errs.slice(0, 3).join("; ")}`;
		console.log(
			`${r.ok ? "OK  " : "FAIL"} ${String(readFileSync(f).length).padStart(7)}B nodes=${r.root ? count(r.root) : 0} tag=${r.root?.tag} ${f.replace(/.*root-(7\.25|6\.49\.23)\//, "$1:")}${errSuffix}`,
		);
		if (r.ok) ok++;
	}
	console.log(`parsed ${ok}/${files.length}`);
}
