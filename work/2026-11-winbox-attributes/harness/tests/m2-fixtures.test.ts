// cspell:ignore aabbcc
// Phase B acceptance: independent byte fixtures for the M2 codec.
// Every expected blob below is a hand-written hex literal — the oracle is
// the literal, never the encoder under test. Encoder checks assert the
// encoder reproduces the same literal bytes.
import { describe, expect, test } from "bun:test";

import {
	decodeM2,
	encBool,
	encBytes,
	encBytes16,
	encBytes16Array,
	encMsg,
	encMsgArray,
	encodeM2,
	encStr,
	encStrArray,
	encU32,
	encU32Array,
	encU64,
} from "../../../2026-10-chr-extraction/ws3c/m2.ts";

const bx = (hex: string): Uint8Array => new Uint8Array(Buffer.from(hex, "hex"));
const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");

describe("m2 headers and scalars", () => {
	test("decodes header into fullKey/byte2/keyId", () => {
		const m = decodeM2(bx("4d32" + "0600ff09" + "02"));
		expect(m.entries.length).toBe(1);
		expect(m.entries[0]).toMatchObject({
			fullKey: 0xff0006,
			byte2: 0xff,
			keyId: 6,
			tcode: 0x09,
			value: 2,
		});
	});

	test("u32 compact/wide boundary at 255/256", () => {
		expect(decodeM2(bx("4d32" + "0100fe09" + "ff")).entries[0]?.value).toBe(
			255,
		);
		expect(
			decodeM2(bx("4d32" + "0100fe08" + "00010000")).entries[0]?.value,
		).toBe(256);
		expect(
			decodeM2(bx("4d32" + "0100fe08" + "ffffffff")).entries[0]?.value,
		).toBe(4294967295);
		expect(encU32(0xfe0001, 255).tcode).toBe(0x09);
		expect(encU32(0xfe0001, 256).tcode).toBe(0x08);
	});

	test("bools ride in the tcode with no payload", () => {
		const m = decodeM2(bx("4d32" + "0b000000" + "0700fe01"));
		expect(m.entries.map((e) => e.value)).toEqual([false, true]);
		expect(
			hex(encodeM2([encBool(0x00000b, false), encBool(0xfe0007, true)])),
		).toBe("4d32" + "0b000000" + "0700fe01");
	});

	test("u64 little-endian incl. max", () => {
		const m = decodeM2(bx("4d32" + "14000010" + "0807060504030201"));
		expect(m.entries[0]?.value).toBe(0x0102030405060708n);
		const max = decodeM2(bx("4d32" + "14000010" + "ffffffffffffffff"));
		expect(max.entries[0]?.value).toBe(0xffffffffffffffffn);
	});

	test("string compact/wide lengths", () => {
		const compact = decodeM2(bx("4d32" + "0d000021" + "026869"));
		expect(compact.entries[0]).toMatchObject({ tcode: 0x21, value: "hi" });
		const wide = decodeM2(bx("4d32" + "0d000020" + "02006869"));
		expect(wide.entries[0]).toMatchObject({ tcode: 0x20, value: "hi" });
		const empty = decodeM2(bx("4d32" + "0900fe21" + "00"));
		expect(empty.entries[0]?.value).toBe("");
		expect(encStr(1, "a".repeat(255)).tcode).toBe(0x21);
		expect(encStr(1, "a".repeat(256)).tcode).toBe(0x20);
	});

	test("bytes compact/wide lengths", () => {
		const m = decodeM2(bx("4d32" + "01000031" + "03aabbcc"));
		expect(hex(m.entries[0]?.value as Uint8Array)).toBe("aabbcc");
		const w = decodeM2(bx("4d32" + "01000030" + "0300aabbcc"));
		expect(hex(w.entries[0]?.value as Uint8Array)).toBe("aabbcc");
	});

	test("bytes16 fixed shape", () => {
		const body = "000102030405060708090a0b0c0d0e0f";
		const m = decodeM2(bx(`4d32${"01002018"}${body}`));
		expect(hex(m.entries[0]?.value as Uint8Array)).toBe(body);
	});
});

describe("m2 nesting and arrays", () => {
	const innerRow = "4d32" + "01000009" + "07"; // 7 bytes total

	test("nested msg compact and wide", () => {
		const c = decodeM2(bx(`4d320c00fe2907${innerRow}`));
		const w = decodeM2(bx(`4d320c00fe280700${innerRow}`));
		for (const m of [c, w]) {
			const nested = m.entries[0]?.value as { entries: { value: unknown }[] };
			expect(nested.entries[0]?.value).toBe(7);
		}
		expect(c.entries[0]?.tcode).toBe(0x29);
		expect(w.entries[0]?.tcode).toBe(0x28);
	});

	test("u32 array", () => {
		const m = decodeM2(
			bx("4d32" + "0100ff88" + "0200" + "00000000" + "0b000000"),
		);
		expect(m.entries[0]?.value).toEqual([0, 11]);
	});

	test("bytes16 array (0x98 PPPoE shape: one zero item)", () => {
		const m = decodeM2(bx(`4d32c90000980100${"00".repeat(16)}`));
		const items = m.entries[0]?.value as Uint8Array[];
		expect(items.length).toBe(1);
		expect(hex(items[0] as Uint8Array)).toBe("00".repeat(16));
	});

	test("string array incl. empty item", () => {
		const m = decodeM2(bx("4d32" + "1c00ffa0" + "0200" + "02006162" + "0000"));
		expect(m.entries[0]?.value).toEqual(["ab", ""]);
	});

	test("message array of two rows", () => {
		const row1 = "4d32" + "0100fe09" + "01";
		const row2 = "4d32" + "0100fe09" + "02";
		const m = decodeM2(bx(`4d320200fea802000700${row1}0700${row2}`));
		const rows = m.entries[0]?.value as { entries: { value: unknown }[] }[];
		expect(rows.length).toBe(2);
		expect(rows[0]?.entries[0]?.value).toBe(1);
		expect(rows[1]?.entries[0]?.value).toBe(2);
	});

	test("repeated keys keep order and count", () => {
		const m = decodeM2(bx("4d32" + "05000009" + "01" + "05000009" + "02"));
		expect(m.entries.map((e) => e.value)).toEqual([1, 2]);
	});
});

describe("m2 explicit failures", () => {
	test("unknown tcode stops with context (0x80 declared-unwired)", () => {
		expect(() => decodeM2(bx("4d32" + "0100fe80"))).toThrow(/0x80/);
	});

	test("truncated fixed payload overruns explicitly", () => {
		expect(() => decodeM2(bx("4d32" + "0100fe08" + "0001"))).toThrow(/overrun/);
	});

	test("length prefix past end overruns explicitly", () => {
		expect(() => decodeM2(bx("4d32" + "0d000021" + "05" + "6162"))).toThrow(
			/overrun/,
		);
	});

	test("nested bytes without M2 magic are rejected", () => {
		expect(() => decodeM2(bx("4d32" + "0c00fe29" + "02" + "0000"))).toThrow(
			/magic/,
		);
	});

	test("root without M2 magic is rejected", () => {
		expect(() => decodeM2(bx("0000" + "0100fe09" + "01"))).toThrow(/magic/);
	});

	test("array counts past the end overrun explicitly", () => {
		// u32 array claims 2 items, carries 1.
		expect(() =>
			decodeM2(bx("4d32" + "0100ff88" + "0200" + "00000000")),
		).toThrow(/overrun/);
		// String array item length past the end.
		expect(() =>
			decodeM2(bx("4d32" + "1c00ffa0" + "0100" + "0500" + "6162")),
		).toThrow(/overrun/);
		// Message array item length past the end.
		expect(() =>
			decodeM2(bx("4d32" + "0200fea8" + "0100" + "2000" + "4d32")),
		).toThrow(/overrun/);
		// bytes16 array item cut short.
		expect(() => decodeM2(bx(`4d32c90000980100${"00".repeat(8)}`))).toThrow(
			/overrun/,
		);
	});
});

describe("m2 encoder reproduces hand literals", () => {
	test("request header order matches the real-client capture shape", () => {
		const got = hex(
			encodeM2([
				encBool(0xff0005, true),
				encU32(0xff0006, 1),
				encU32(0xff0007, 7),
				encU32Array(0xff0001, [13, 4]),
				encU32Array(0xff0002, [0, 11]),
			]),
		);
		expect(got).toBe(
			"4d320500ff010600ff09010700ff09070100ff88" +
				"02000d000000040000000200ff880200000000000b000000",
		);
	});

	test("each tcode round-trips its hand literal", () => {
		const cases: { literal: string; build: () => Uint8Array }[] = [
			{
				literal: "4d320100fe09ff",
				build: () => encodeM2([encU32(0xfe0001, 255)]),
			},
			{
				literal: "4d320100fe0800010000",
				build: () => encodeM2([encU32(0xfe0001, 256)]),
			},
			{
				literal: "4d32140000100807060504030201",
				build: () => encodeM2([encU64(0x000014, 0x0102030405060708n)]),
			},
			{
				literal: `4d3201002018${"00".repeat(16)}`,
				build: () => encodeM2([encBytes16(0x200001, new Uint8Array(16))]),
			},
			{
				literal: "4d320d000021026869",
				build: () => encodeM2([encStr(0x00000d, "hi")]),
			},
			{
				literal: "4d320100003103aabbcc",
				build: () => encodeM2([encBytes(0x000001, bx("aabbcc"))]),
			},
			{
				literal: "4d320100ff880200000000000b000000",
				build: () => encodeM2([encU32Array(0xff0001, [0, 11])]),
			},
			{
				literal: `4d32c90000980100${"00".repeat(16)}`,
				build: () =>
					encodeM2([encBytes16Array(0x0000c9, [new Uint8Array(16)])]),
			},
			{
				literal: "4d321c00ffa001000e006d73672d70726f78792d372e3235",
				build: () => encodeM2([encStrArray(0xff001c, ["msg-proxy-7.25"])]),
			},
		];
		for (const c of cases) {
			expect(hex(c.build())).toBe(c.literal);
			// And the literal decodes (decoder cross-check, not encoder-only).
			expect(() => decodeM2(bx(c.literal))).not.toThrow();
		}
	});

	test("nested and array messages round-trip hand literals", () => {
		const row = decodeM2(bx("4d32" + "0100fe09" + "01"));
		expect(hex(encodeM2([encMsg(0xfe000c, row)]))).toBe(
			"4d32" + "0c00fe29" + "07" + "4d32" + "0100fe09" + "01",
		);
		expect(hex(encodeM2([encMsgArray(0xfe0002, [row])]))).toBe(
			"4d32" + "0200fea8" + "0100" + "0700" + "4d32" + "0100fe09" + "01",
		);
	});
});

describe("m2 encoder refuses bad input explicitly", () => {
	test("u32 range is validated, never masked", () => {
		expect(() => encU32(1, -1)).toThrow(/u32/);
		expect(() => encU32(1, 2 ** 32)).toThrow(/u32/);
		expect(() => encU32(1, 1.5)).toThrow(/u32/);
		expect(() => encodeM2([{ fullKey: 1, tcode: 0x09, value: 300 }])).toThrow(
			/compact u8/,
		);
	});

	test("u64 range is validated", () => {
		expect(() => encU64(1, -1n)).toThrow(/u64/);
		expect(() => encU64(1, 0x10000000000000000n)).toThrow(/u64/);
	});

	test("bytes16 must be exactly 16 bytes", () => {
		expect(() => encBytes16(1, new Uint8Array(15))).toThrow(/16B/);
		expect(() => encBytes16(1, new Uint8Array(17))).toThrow(/16B/);
	});

	test("fullKey must fit 24 bits", () => {
		expect(() => encU32(0x1000000, 1)).toThrow(/24-bit/);
		expect(() => encU32(-1, 1)).toThrow(/24-bit/);
	});

	test("declared-unwired tcodes are refused, not guessed", () => {
		expect(() => encodeM2([{ fullKey: 1, tcode: 0x80, value: 1 }])).toThrow(
			/declared-unwired/,
		);
		expect(() => encodeM2([{ fullKey: 1, tcode: 0x90, value: 1 }])).toThrow(
			/declared-unwired/,
		);
	});

	test("compact overflows are refused", () => {
		expect(() =>
			encodeM2([{ fullKey: 1, tcode: 0x21, value: "a".repeat(256) }]),
		).toThrow(/compact string/);
	});
});
