// Phase B acceptance: schema-derived naming over the canonical YAML,
// plus replay of the pilot observations (identity + ip/address) from
// hand-written M2 bytes shaped like the committed ev/ transcripts.
import { describe, expect, test } from "bun:test";

import {
	decodeM2,
	type M2Message,
} from "../../../2026-10-chr-extraction/ws3c/m2.ts";
import { captureMessage } from "../capture.ts";
import {
	checkTcode,
	loadNameTables,
	resolveCommandName,
	resolveKeyName,
	resolveRouteField,
} from "../schema-names.ts";

const bx = (hex: string): Uint8Array => new Uint8Array(Buffer.from(hex, "hex"));

describe("schema names", () => {
	test("tables load from the canonical YAML", () => {
		const tables = loadNameTables();
		expect(tables.keys.size).toBeGreaterThan(40);
		expect(tables.commands.size).toBeGreaterThan(5);
		expect(tables.routes.get("24,1")?.size).toBe(2);
		expect(tables.routes.get("20,1")?.size).toBeGreaterThanOrEqual(10);
	});

	test("global keys resolve with sources", () => {
		expect(resolveKeyName(0xff0006)).toMatchObject({
			name: "SYS_REQID",
			source: "profiles/winbox-ipc/sys-keys.yaml",
		});
		expect(resolveKeyName(0xfe0002)).toMatchObject({ name: "STD_OBJS" });
		expect(resolveKeyName(0xfe0003)).toMatchObject({ name: "STD_GETALLID" });
		expect(resolveCommandName(0xfe000d)).toMatchObject({ name: "CMD_GET" });
		expect(resolveCommandName(0xfe0004)).toMatchObject({ name: "CMD_GETALL" });
	});

	test("unknown keys report absent-coverage with numeric fallback", () => {
		expect(resolveKeyName(0x123456)).toEqual({
			name: null,
			reason: "absent-coverage",
			fallback: "key_0x123456",
		});
		expect(resolveCommandName(0xfe00ff)).toMatchObject({
			name: null,
			reason: "absent-coverage",
		});
	});

	test("pilot route fields resolve, others fall back", () => {
		expect(resolveRouteField([24, 1], 0x00000c)).toMatchObject({
			name: "name",
		});
		expect(resolveRouteField([24, 1], 0x00000d)).toMatchObject({
			name: "version",
		});
		expect(resolveRouteField([20, 1], 0x000001)).toMatchObject({
			name: "address",
		});
		expect(resolveRouteField([20, 1], 0x000005)).toMatchObject({
			name: "actual-interface",
		});
		expect(resolveRouteField([20, 1], 0xfe0009)).toMatchObject({
			name: "comment",
		});
		// Unmapped field on a known route: numeric fallback, still explicit.
		expect(resolveRouteField([24, 1], 0x000099)).toMatchObject({
			name: null,
			reason: "absent-coverage",
		});
	});

	test("tcode agreement and disagreement are both explicit", () => {
		expect(checkTcode(0xff0006, 0x09)).toEqual({ agree: true });
		expect(checkTcode(0xff0006, 0x08)).toEqual({ agree: true });
		const bad = checkTcode(0xff0006, 0xa0);
		expect(bad).toMatchObject({ agree: false });
		if (bad.agree === false) expect(bad.detail).toMatch(/SYS_REQID/);
		expect(checkTcode(0x123456, 0x09)).toEqual({
			agree: null,
			reason: "absent-coverage",
		});
	});
});

describe("pilot replay from hand bytes", () => {
	// Shaped like ev/7.25-getone-24-1.json: SYS_TO [0,11],
	// SYS_FROM [24,1], proxy banner, TYPE=2, REQID=2, version "7.25", name "CHR".
	const IDENTITY_HEX =
		"4d32" +
		"0100ff88" +
		"0200" +
		"00000000" +
		"0b000000" +
		"0200ff88" +
		"0200" +
		"18000000" +
		"01000000" +
		"1c00ffa0" +
		"0100" +
		"0e00" +
		"6d73672d70726f78792d372e3235" +
		"0300ff09" +
		"02" +
		"0600ff09" +
		"02" +
		"0d000021" +
		"04" +
		"372e3235" +
		"0c000021" +
		"03" +
		"434852";

	test("identity reply decodes, captures, and names end to end", () => {
		const bytes = bx(IDENTITY_HEX);
		const msg = decodeM2(bytes);
		expect(msg.entries.length).toBe(7);
		const rec = captureMessage(0, "rx", bytes);
		expect(rec.decode.ok).toBe(true);
		expect(rec.reqId).toBe(2);
		expect(rec.from).toEqual([24, 1]);
		// Schema overlay: every key in this reply has a canonical name.
		const names = msg.entries.map((e) => {
			const r =
				e.byte2 === 0x00
					? resolveRouteField([24, 1], e.fullKey)
					: resolveKeyName(e.fullKey);
			return r.name ?? (r as { fallback: string }).fallback;
		});
		expect(names).toEqual([
			"SYS_TO",
			"SYS_FROM",
			"SYS_PROXY_BANNER",
			"SYS_TYPE",
			"SYS_REQID",
			"version",
			"name",
		]);
		const values = Object.fromEntries(
			msg.entries.map((e) => [
				`0x${e.fullKey.toString(16)}`,
				e.value instanceof Uint8Array ? "bytes" : e.value,
			]),
		);
		expect(values["0xd"]).toBe("7.25");
		expect(values["0xc"]).toBe("CHR");
	});

	test("ip-address row decodes with be32 + session fields", () => {
		// One row: broadcast u32 4278321162 (0xFF02000A, LE bytes
		// 0a0002ff), actual-iface u8 2, row-id u8 1, comment "" —
		// inside a 0xfe0002 msg_array.
		const rowInner =
			"04000008" +
			"0a0002ff" +
			"05000009" +
			"02" +
			"0100fe09" +
			"01" +
			"0900fe21" +
			"00";
		const rowBytes = `4d32${rowInner}`;
		const rowLen = rowBytes.length / 2;
		const rowLenHex = rowLen.toString(16).padStart(4, "0");
		const rowLenLe = rowLenHex.slice(2, 4) + rowLenHex.slice(0, 2);
		const replyHex =
			"4d32" +
			"0100ff88" +
			"0200" +
			"00000000" +
			"0b000000" +
			"0200ff88" +
			"0200" +
			"14000000" +
			"01000000" +
			"0200fea8" +
			"0100" +
			rowLenLe +
			rowBytes +
			"0300ff09" +
			"02" +
			"0600ff09" +
			"02";
		const msg = decodeM2(bx(replyHex));
		const rowsEntry = msg.entries.find((e) => e.fullKey === 0xfe0002);
		const rows = rowsEntry?.value as M2Message[];
		expect(rows.length).toBe(1);
		const rowFields = rows[0]?.entries ?? [];
		expect(rowFields.find((e) => e.fullKey === 0x000004)?.value).toBe(
			4278321162,
		);
		expect(rowFields.find((e) => e.fullKey === 0x000005)?.value).toBe(2);
		expect(resolveRouteField([20, 1], 0x000004)).toMatchObject({
			name: "broadcast",
		});
		expect(resolveRouteField([20, 1], 0x000005)).toMatchObject({
			name: "actual-interface",
		});
		// Tcode check passes for the real wire shape of session fields.
		for (const e of rowFields) {
			if (e.fullKey >= 0xfe0000) {
				expect(checkTcode(e.fullKey, e.tcode).agree).not.toBe(false);
			}
		}
	});
});
