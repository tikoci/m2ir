// WS-3C: nv::message (M2) TLV encode/decode for the WinBox wire prober.
// Grammar: physical/nv-message.yaml. Profile: winbox-ipc (byte_2 =
// namespace, compact pairs 0x08/0x09, 0x20/0x21, 0x28/0x29, 0x30/0x31).

export type M2Value =
	| boolean
	| number
	| bigint
	| string
	| Uint8Array
	| M2Message
	| number[]
	| string[]
	| Uint8Array[]
	| M2Message[];

export interface M2Entry {
	fullKey: number;
	byte2: number;
	keyId: number;
	tcode: number;
	value: M2Value;
}

export interface M2Message {
	entries: M2Entry[];
}

/** Known SYS_* key names (profiles/winbox-ipc/sys-keys.yaml) for display. */
const SYS_NAMES: Record<number, string> = {
	16711681: "SYS_TO",
	16711682: "SYS_FROM",
	16711683: "SYS_TYPE",
	16711684: "SYS_STATUS",
	16711685: "SYS_REPLYEXP",
	16711686: "SYS_REQID",
	16711687: "SYS_CMD",
	16711688: "SYS_ERRNO",
	16711689: "SYS_ERRSTR",
	16711690: "SYS_USER",
	16711691: "SYS_POLICY",
	16711693: "SYS_CTRL",
	16711695: "SYS_CTRL_ARG",
	16711696: "SYS_USER_ID",
	16711697: "SYS_NOTIFYCMD",
	16711698: "SYS_ORIGINATOR",
	16711699: "SYS_RADDR6",
	16711702: "SYS_DREASON",
};

export function keyName(fullKey: number): string {
	return SYS_NAMES[fullKey] ?? "";
}

const TCODE_NAMES: Record<number, string> = {
	0: "bool_false",
	1: "bool_true",
	8: "u32",
	9: "u8",
	16: "u64",
	24: "bytes16",
	32: "string",
	33: "string_c",
	40: "msg",
	41: "msg_c",
	48: "bytes",
	49: "bytes_c",
	136: "u32_array",
	152: "bytes16_array",
	160: "string_array",
	168: "msg_array",
};

export function tcodeName(tcode: number): string {
	return TCODE_NAMES[tcode] ?? `tcode_${tcode.toString(16)}`;
}

// ── decode ──────────────────────────────────────────────────────────────

class Cursor {
	off = 0;
	constructor(
		readonly buf: Uint8Array,
		readonly view: DataView,
		readonly end: number,
	) {}
	need(n: number, what: string): void {
		if (this.off + n > this.end) {
			throw new Error(`m2: ${what} overruns (${this.off}+${n}>${this.end})`);
		}
	}
	u8(): number {
		this.need(1, "u8");
		const v = this.buf[this.off] ?? 0;
		this.off += 1;
		return v;
	}
	u16le(): number {
		this.need(2, "u16");
		const v = this.view.getUint16(this.off, true);
		this.off += 2;
		return v;
	}
	u32le(): number {
		this.need(4, "u32");
		const v = this.view.getUint32(this.off, true);
		this.off += 4;
		return v;
	}
	u64le(): bigint {
		this.need(8, "u64");
		const v = this.view.getBigUint64(this.off, true);
		this.off += 8;
		return v;
	}
	bytes(n: number): Uint8Array {
		this.need(n, "bytes");
		const v = this.buf.subarray(this.off, this.off + n);
		this.off += n;
		return v;
	}
}

function decodeEntries(c: Cursor): M2Entry[] {
	const entries: M2Entry[] = [];
	while (c.off < c.end) {
		c.need(4, "entry header");
		const keyLow = c.u8();
		const keyHigh = c.u8();
		const byte2 = c.u8();
		const tcode = c.u8();
		const keyId = keyLow | (keyHigh << 8);
		const fullKey = (byte2 << 16) | (keyHigh << 8) | keyLow;
		entries.push({
			fullKey,
			byte2,
			keyId,
			tcode,
			value: decodeValue(c, tcode),
		});
	}
	return entries;
}

function decodeValue(c: Cursor, tcode: number): M2Value {
	switch (tcode) {
		case 0x00:
			return false;
		case 0x01:
			return true;
		case 0x08:
			return c.u32le();
		case 0x09:
			return c.u8();
		case 0x10:
			return c.u64le();
		case 0x18:
			return c.bytes(16);
		case 0x20:
			return new TextDecoder().decode(c.bytes(c.u16le()));
		case 0x21:
			return new TextDecoder().decode(c.bytes(c.u8()));
		case 0x28:
		case 0x29: {
			const len = tcode === 0x28 ? c.u16le() : c.u8();
			return decodeNested(c.bytes(len));
		}
		case 0x30:
			return c.bytes(c.u16le());
		case 0x31:
			return c.bytes(c.u8());
		case 0x88: {
			const count = c.u16le();
			const out: number[] = [];
			for (let i = 0; i < count; i++) out.push(c.u32le());
			return out;
		}
		case 0x98: {
			const count = c.u16le();
			const out: Uint8Array[] = [];
			for (let i = 0; i < count; i++) out.push(c.bytes(16));
			return out;
		}
		case 0xa0: {
			const count = c.u16le();
			const out: string[] = [];
			const dec = new TextDecoder();
			for (let i = 0; i < count; i++) out.push(dec.decode(c.bytes(c.u16le())));
			return out;
		}
		case 0xa8: {
			const count = c.u16le();
			const out: M2Message[] = [];
			for (let i = 0; i < count; i++)
				out.push(decodeNested(c.bytes(c.u16le())));
			return out;
		}
		default: {
			const lo = Math.max(0, c.off - 20);
			const hi = Math.min(c.buf.length, c.off + 48);
			throw new Error(
				`m2: unknown tcode 0x${tcode.toString(16)} at off ${c.off} ctx[${lo}..${hi}]=${fmtHex(c.buf.subarray(lo, hi))}`,
			);
		}
	}
}

function decodeNested(bytes: Uint8Array): M2Message {
	if (bytes.length < 2 || bytes[0] !== 0x4d || bytes[1] !== 0x32) {
		throw new Error("m2: nested message without M2 magic");
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
	const c = new Cursor(bytes, view, bytes.length);
	c.off = 2;
	return { entries: decodeEntries(c) };
}

/** Decode a root M2 message (must start with the M2 magic). */
export function decodeM2(bytes: Uint8Array): M2Message {
	return decodeNested(bytes);
}

// ── encode ──────────────────────────────────────────────────────────────

export interface EncEntry {
	fullKey: number;
	tcode: number;
	value: M2Value;
}

export function encU32(fullKey: number, v: number): EncEntry {
	return { fullKey, tcode: v >= 0 && v < 256 ? 0x09 : 0x08, value: v };
}

export function encBool(fullKey: number, v: boolean): EncEntry {
	return { fullKey, tcode: v ? 0x01 : 0x00, value: v };
}

export function encStr(fullKey: number, s: string): EncEntry {
	const n = new TextEncoder().encode(s).length;
	return { fullKey, tcode: n < 256 ? 0x21 : 0x20, value: s };
}

export function encBytes(fullKey: number, b: Uint8Array): EncEntry {
	return { fullKey, tcode: b.length < 256 ? 0x31 : 0x30, value: b };
}

export function encU32Array(fullKey: number, vs: number[]): EncEntry {
	return { fullKey, tcode: 0x88, value: vs };
}

function concatParts(parts: Uint8Array[]): Uint8Array {
	const total = parts.reduce((n, p) => n + p.length, 0);
	const out = new Uint8Array(total);
	let cursor = 0;
	for (const p of parts) {
		out.set(p, cursor);
		cursor += p.length;
	}
	return out;
}

function encodeEntries(entries: EncEntry[]): Uint8Array {
	const parts: Uint8Array[] = [new Uint8Array([0x4d, 0x32])];
	const enc = new TextEncoder();
	for (const e of entries) {
		const keyLow = e.fullKey & 0xff;
		const keyHigh = (e.fullKey >> 8) & 0xff;
		const byte2 = (e.fullKey >> 16) & 0xff;
		parts.push(new Uint8Array([keyLow, keyHigh, byte2, e.tcode]));
		parts.push(encodeValue(e.tcode, e.value, enc));
	}
	return concatParts(parts);
}

function encodeValue(
	tcode: number,
	value: M2Value,
	enc: TextEncoder,
): Uint8Array {
	const u16 = (v: number) => new Uint8Array([v & 0xff, (v >> 8) & 0xff]);
	const u32 = (v: number) =>
		new Uint8Array([
			v & 0xff,
			(v >> 8) & 0xff,
			(v >> 16) & 0xff,
			(v >> 24) & 0xff,
		]);
	switch (tcode) {
		case 0x00:
		case 0x01:
			return new Uint8Array(0);
		case 0x08:
			return u32(value as number);
		case 0x09:
			return new Uint8Array([value as number]);
		case 0x20:
		case 0x21: {
			const b = enc.encode(value as string);
			return concatParts([
				tcode === 0x20 ? u16(b.length) : new Uint8Array([b.length]),
				b,
			]);
		}
		case 0x30:
		case 0x31: {
			const b = value as Uint8Array;
			return concatParts([
				tcode === 0x30 ? u16(b.length) : new Uint8Array([b.length]),
				b,
			]);
		}
		case 0x88: {
			const vs = value as number[];
			return concatParts([u16(vs.length), ...vs.map(u32)]);
		}
		default:
			throw new Error(`m2: encode of tcode 0x${tcode.toString(16)} not wired`);
	}
}

/** Encode a root M2 message from entries. */
export function encodeM2(entries: EncEntry[]): Uint8Array {
	return encodeEntries(entries);
}

// ── display ─────────────────────────────────────────────────────────────

export function fmtHex(b: Uint8Array, max = 64): string {
	const h = Buffer.from(b.subarray(0, max)).toString("hex");
	return b.length > max ? `${h}…(${b.length}B)` : h;
}

export function fmtValue(v: M2Value, indent = ""): string {
	if (typeof v === "boolean") return v ? "true" : "false";
	if (typeof v === "number") return `${v} (0x${v.toString(16)})`;
	if (typeof v === "bigint") return `${v}`;
	if (typeof v === "string") return JSON.stringify(v);
	if (v instanceof Uint8Array) return `bytes[${v.length}] ${fmtHex(v)}`;
	if (Array.isArray(v)) {
		if (
			v.length > 0 &&
			typeof v[0] === "object" &&
			!(v[0] instanceof Uint8Array)
		) {
			const rows = v as M2Message[];
			const body = rows
				.map(
					(r, i) => `${indent}  [row ${i}]\n${fmtMessage(r, `${indent}    `)}`,
				)
				.join("\n");
			return `${rows.length} rows\n${body}`;
		}
		return `[${(v as (number | string | Uint8Array)[]).map((x) => (typeof x === "number" ? x : x instanceof Uint8Array ? `bytes[${x.length}] ${fmtHex(x)}` : JSON.stringify(x))).join(", ")}]`;
	}
	const m = v as M2Message;
	return `${m.entries.length} fields\n${fmtMessage(m, `${indent}  `)}`;
}

export function fmtEntry(e: M2Entry, indent = ""): string {
	const name = keyName(e.fullKey);
	const key = `0x${e.fullKey.toString(16).padStart(6, "0")}`;
	return `${key}${name ? ` ${name}` : ""} ${tcodeName(e.tcode)} ${fmtValue(e.value, indent)}`;
}

export function fmtMessage(m: M2Message, indent = ""): string {
	return m.entries.map((e) => `${indent}${fmtEntry(e, indent)}`).join("\n");
}

/** Find the first entry with the given full key. */
export function findEntry(m: M2Message, fullKey: number): M2Entry | undefined {
	return m.entries.find((e) => e.fullKey === fullKey);
}
