// Anchor tests for the WinBox M2 schema strawman.
//
// Strategy: don't depend on the Kaitai compiler in CI. Instead, hand-code
// a minimal TLV parser that mirrors `src/protocols/winbox/schema/winbox-m2.ksy`
// and assert it agrees
// with byte-level fixtures lifted verbatim from PROTOCOL.md examples.
//
// When Kaitai-generated JS is added later (`bunx kaitai-struct-compiler -t
// javascript src/protocols/winbox/schema/winbox-m2.ksy`), point `parseM2()`
// at it and these
// fixtures become regression tests for the generated parser too.
//
// The point of these tests is to *exercise the schema as documentation*:
// every fixture pulls a real byte sequence out of PROTOCOL.md and asserts
// the structure described there parses as expected.

import { describe, expect, test } from "bun:test";

type Tlv =
	| { kind: "bool"; key: number; value: boolean }
	| { kind: "u8"; key: number; value: number }
	| { kind: "u32"; key: number; value: number }
	| { kind: "u32_array"; key: number; value: number[] }
	| { kind: "raw"; key: number; value: Uint8Array }
	| { kind: "string"; key: number; value: string };

function parseM2(buf: Uint8Array): { entries: Tlv[] } {
	if (buf[0] !== 0x4d || buf[1] !== 0x32) throw new Error("missing M2 magic");
	const entries: Tlv[] = [];
	const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
	let p = 2;
	while (p < buf.length) {
		const keyLow = readByte(buf, p);
		const keyHigh = readByte(buf, p + 1);
		const ns = readByte(buf, p + 2);
		const tb = readByte(buf, p + 3);
		p += 4;
		const fullKey = (ns << 16) | (keyHigh << 8) | keyLow;
		switch (tb) {
			case 0x00:
				entries.push({ kind: "bool", key: fullKey, value: false });
				break;
			case 0x01:
				entries.push({ kind: "bool", key: fullKey, value: true });
				break;
			case 0x09:
				entries.push({ kind: "u8", key: fullKey, value: readByte(buf, p) });
				p += 1;
				break;
			case 0x08:
				entries.push({
					kind: "u32",
					key: fullKey,
					value: dv.getUint32(p, true),
				});
				p += 4;
				break;
			case 0x88: {
				const count = dv.getUint16(p, true);
				p += 2;
				const arr: number[] = [];
				for (let i = 0; i < count; i++) {
					arr.push(dv.getUint32(p, true));
					p += 4;
				}
				entries.push({ kind: "u32_array", key: fullKey, value: arr });
				break;
			}
			case 0x31: {
				const len = readByte(buf, p);
				p += 1;
				entries.push({
					kind: "raw",
					key: fullKey,
					value: buf.slice(p, p + len),
				});
				p += len;
				break;
			}
			case 0x21: {
				const len = readByte(buf, p);
				p += 1;
				entries.push({
					kind: "string",
					key: fullKey,
					value: new TextDecoder().decode(buf.slice(p, p + len)),
				});
				p += len;
				break;
			}
			default:
				throw new Error(
					`unhandled type byte 0x${tb.toString(16)} at offset ${p - 4}`,
				);
		}
	}
	return { entries };
}

function hex(value: string): Uint8Array {
	const bytes = value.replace(/\s+/g, "").match(/.{2}/g);
	if (!bytes) {
		throw new Error("fixture hex string did not contain any bytes");
	}

	return Uint8Array.from(bytes.map((byte) => Number.parseInt(byte, 16)));
}

function readByte(buf: Uint8Array, index: number): number {
	const value = buf[index];
	if (value === undefined) {
		throw new Error(`expected byte at offset ${index}`);
	}

	return value;
}

function requireEntry(
	entry: Tlv | undefined,
	kind: "bool",
): Extract<Tlv, { kind: "bool" }>;
function requireEntry(
	entry: Tlv | undefined,
	kind: "u8",
): Extract<Tlv, { kind: "u8" }>;
function requireEntry(
	entry: Tlv | undefined,
	kind: "u32",
): Extract<Tlv, { kind: "u32" }>;
function requireEntry(
	entry: Tlv | undefined,
	kind: "u32_array",
): Extract<Tlv, { kind: "u32_array" }>;
function requireEntry(
	entry: Tlv | undefined,
	kind: "raw",
): Extract<Tlv, { kind: "raw" }>;
function requireEntry(
	entry: Tlv | undefined,
	kind: "string",
): Extract<Tlv, { kind: "string" }>;
function requireEntry(entry: Tlv | undefined, kind: Tlv["kind"]): Tlv {
	if (!entry || entry.kind !== kind) {
		throw new Error(
			`expected entry kind ${kind}, got ${entry?.kind ?? "missing"}`,
		);
	}

	return entry;
}

const SYS_TO = 0xff0001;
const SYS_FROM = 0xff0002;
const SYS_REPLYEXP = 0xff0005; // PROTOCOL.md calls this SYS_REQUEST
const SYS_CMD = 0xff0007;
const SESSION_ID_OR_STD_ID = 0xfe0001;

describe("Initial Request fixture (PROTOCOL.md §6)", () => {
	// From PROTOCOL.md: cmdGet=7 to handler [13,4]
	const bytes = hex(`
    4d 32
    01 00 ff 88 02 00  0d 00 00 00 04 00 00 00
    02 00 ff 88 02 00  00 00 00 00 01 00 00 00
    05 00 ff 01
    06 00 ff 09 00
    07 00 ff 09 07
	`);

	test("parses without consuming extra bytes", () => {
		const m = parseM2(bytes);
		expect(m.entries.length).toBe(5);
	});

	test("SYS_TO = [13, 4]", () => {
		const m = parseM2(bytes);
		const e = requireEntry(
			m.entries.find((entry) => entry.key === SYS_TO),
			"u32_array",
		);
		expect(e.value).toEqual([13, 4]);
	});

	test("SYS_FROM = [0, 1] (source_id=1)", () => {
		const m = parseM2(bytes);
		const e = requireEntry(
			m.entries.find((entry) => entry.key === SYS_FROM),
			"u32_array",
		);
		expect(e.value).toEqual([0, 1]);
	});

	test("SYS_REPLYEXP true (project 'SYS_REQUEST')", () => {
		const m = parseM2(bytes);
		const e = requireEntry(
			m.entries.find((entry) => entry.key === SYS_REPLYEXP),
			"bool",
		);
		expect(e.value).toBe(true);
	});

	test("SYS_CMD u8 = 7 (legacy short-form cmdGet)", () => {
		const m = parseM2(bytes);
		const e = requireEntry(
			m.entries.find((entry) => entry.key === SYS_CMD),
			"u8",
		);
		expect(e.value).toBe(7);
	});
});

describe("Keystroke 't' fixture (PROTOCOL.md §6)", () => {
	const bytes = hex(`
    4d 32
    01 00 ff 88 01 00  4c 00 00 00
    02 00 ff 88 02 00  00 00 00 00 ad 01 00 00
    03 00 00 08 98 02 00 00
    01 00 fe 09 1c
    07 00 ff 08 67 00 0a 00
    02 00 00 31 01 74
	`);

	test("SYS_TO = [76] (mepty handler — see overlay's open question)", () => {
		const m = parseM2(bytes);
		const e = requireEntry(
			m.entries.find((entry) => entry.key === SYS_TO),
			"u32_array",
		);
		expect(e.value).toEqual([76]);
	});

	test("SYS_CMD u32 = 0x000A0067 (meptyData)", () => {
		const m = parseM2(bytes);
		const e = requireEntry(
			m.entries.find((entry) => entry.key === SYS_CMD),
			"u32",
		);
		expect(e.value).toBe(0x000a0067);
	});

	test("STD_ID (session id) u8 = 28 in user namespace 0xFE", () => {
		const m = parseM2(bytes);
		const e = requireEntry(
			m.entries.find((entry) => entry.key === SESSION_ID_OR_STD_ID),
			"u8",
		);
		expect(e.value).toBe(0x1c);
	});

	test("user key_2 (raw_short) carries the keystroke 0x74 ('t')", () => {
		const m = parseM2(bytes);
		const e = requireEntry(
			m.entries.find((entry) => entry.key === 0x000002),
			"raw",
		);
		expect(Array.from(e.value)).toEqual([0x74]);
	});

	test("user key_3 (u32 LE) = 664 — outgoing byte counter", () => {
		const m = parseM2(bytes);
		const e = requireEntry(
			m.entries.find((entry) => entry.key === 0x000003),
			"u32",
		);
		expect(e.value).toBe(664);
	});
});
