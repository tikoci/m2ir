// cspell:ignore webfig
/**
 * Decode plaintext M2 into the letter-keyed object form WebFig's own
 * buffer2msg() builds (7.25 master.js), so transcripts read like the
 * objects MikroTik's client handles: `Uff0001` SYS_TO, `ufe0001` STD_ID.
 *
 * The key is the type letter plus the 24-bit key in lowercase hex without
 * leading zeros. Type letters follow WebFig (FT_* << 27):
 *   b bool, u u32, q u64, a addr6, s string, m message, r raw,
 *   B U Q A S M R the array forms.
 * Unlike buffer2msg this keeps the wire tcode byte of every key in a
 * parallel `tcodes` map and keeps u64 values above 2^53 exact (as a
 * decimal string), so the plaintext hex stays the authority.
 * Grammar: physical/nv-message.yaml.
 */

const FT_LETTER: Record<number, string> = {
	0: "b",
	1: "u",
	2: "q",
	3: "a",
	4: "s",
	5: "m",
	6: "r",
	16: "B",
	17: "U",
	18: "Q",
	19: "A",
	20: "S",
	21: "M",
	22: "R",
};
const FS_SHORT = 0x01;
const FS_LONG = 0x02;

export type LetterValue =
	| number
	| string
	| boolean
	| number[]
	| string[]
	| (number | string)[]
	| boolean[]
	| number[][]
	| LetterMsg
	| LetterMsg[];
export interface LetterMsg {
	[key: string]: LetterValue;
}
export interface Decoded {
	msg: LetterMsg;
	/** letter key -> wire tcode byte, e.g. "u1" -> "0x09"; nested under "mfe0002/0". */
	tcodes: Record<string, string>;
}

export function hexToBytes(hex: string): Uint8Array {
	const out = new Uint8Array(hex.length / 2);
	for (let i = 0; i < out.length; i++) {
		out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	}
	return out;
}

export function letterKey(tcode: number, key: number): string {
	const letter = FT_LETTER[tcode >> 3];
	if (!letter)
		throw new Error(
			`m2-letters: unknown type in tcode 0x${tcode.toString(16)}`,
		);
	return letter + key.toString(16);
}

export function decodeLetters(bytes: Uint8Array, path = ""): Decoded {
	if (bytes[0] !== 0x4d || bytes[1] !== 0x32) {
		throw new Error(`m2-letters: no M2 magic at ${path || "root"}`);
	}
	const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
	const msg: LetterMsg = {};
	const tcodes: Record<string, string> = {};
	let pos = 2;
	const need = (n: number) => {
		if (pos + n > bytes.length) {
			throw new Error(
				`m2-letters: truncated at ${pos} (+${n}) in ${path || "root"}`,
			);
		}
	};
	const u8 = () => {
		need(1);
		return bytes[pos++] as number;
	};
	const u16 = () => {
		need(2);
		const v = dv.getUint16(pos, true);
		pos += 2;
		return v;
	};
	const u32 = () => {
		need(4);
		const v = dv.getUint32(pos, true);
		pos += 4;
		return v;
	};
	const u64 = (): number | string => {
		need(8);
		const v = dv.getBigUint64(pos, true);
		pos += 8;
		return v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v.toString();
	};
	const len = (tcode: number) =>
		tcode & FS_SHORT ? u8() : tcode & FS_LONG ? u32() : u16();
	const take = (n: number) => {
		need(n);
		const s = bytes.subarray(pos, pos + n);
		pos += n;
		return s;
	};
	const utf8 = new TextDecoder();
	while (pos < bytes.length) {
		need(4);
		const key = dv.getUint32(pos, true) & 0xffffff;
		const tcode = dv.getUint8(pos + 3);
		pos += 4;
		const k = letterKey(tcode, key);
		const sub = path ? `${path}/${k}` : k;
		tcodes[sub] = `0x${tcode.toString(16).padStart(2, "0")}`;
		const type = tcode >> 3;
		let v: LetterValue;
		switch (type) {
			case 0:
				v = !!(tcode & FS_SHORT);
				break;
			case 1:
				v = tcode & FS_SHORT ? u8() : u32();
				break;
			case 2:
				v = u64() as number;
				break;
			case 3:
				v = [...take(16)];
				break;
			case 4:
				v = utf8.decode(take(len(tcode)));
				break;
			case 6:
				v = [...take(len(tcode))];
				break;
			case 5: {
				const d = decodeLetters(take(len(tcode)), sub);
				Object.assign(tcodes, d.tcodes);
				v = d.msg;
				break;
			}
			case 16: {
				const n = len(tcode);
				v = [...take(n)].map((b) => !!b);
				break;
			}
			case 17: {
				const n = len(tcode);
				v = Array.from({ length: n }, u32);
				break;
			}
			case 18: {
				const n = len(tcode);
				// Exact values: a number when safe, else a decimal string.
				v = Array.from({ length: n }, u64);
				break;
			}
			case 19: {
				const n = len(tcode);
				v = Array.from({ length: n }, () => [...take(16)]);
				break;
			}
			case 20: {
				const n = len(tcode);
				v = Array.from({ length: n }, () => utf8.decode(take(len(tcode))));
				break;
			}
			case 22: {
				const n = len(tcode);
				v = Array.from({ length: n }, () => [...take(len(tcode))]);
				break;
			}
			case 21: {
				const n = len(tcode);
				const rows: LetterMsg[] = [];
				for (let i = 0; i < n; i++) {
					const d = decodeLetters(take(len(tcode)), `${sub}/${i}`);
					Object.assign(tcodes, d.tcodes);
					rows.push(d.msg);
				}
				v = rows;
				break;
			}
			default:
				throw new Error(
					`m2-letters: unhandled type ${type} (tcode 0x${tcode.toString(16)})`,
				);
		}
		msg[k] = v;
	}
	return { msg, tcodes };
}

/** Split an RX plaintext into its [u32 BE length][M2] frames. */
export function splitFrames(bytes: Uint8Array): Uint8Array[] {
	const out: Uint8Array[] = [];
	let pos = 0;
	while (pos + 4 <= bytes.length) {
		const n = new DataView(
			bytes.buffer,
			bytes.byteOffset,
			bytes.length,
		).getUint32(pos, false);
		out.push(bytes.subarray(pos + 4, pos + 4 + n));
		pos += 4 + n;
	}
	if (pos !== bytes.length) {
		throw new Error(
			`m2-letters: ${bytes.length - pos} trailing bytes after frames`,
		);
	}
	return out;
}
