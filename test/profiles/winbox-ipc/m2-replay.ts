// Shared Tier-1 replay helper: independent mini M2 parser + fixture loading.
//
// Independent of the work/ harness decoder by construction (no imports
// outside node/yaml). Decodes the tcode subset used by Tier-1 fixtures:
// bools, u8/u32/u64, fixed bytes16, compact/wide strings,
// length-prefixed bytes, nested messages, u32/string/message arrays.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

export interface FixtureEntry {
	key: string;
	tcode: string;
	value: unknown;
}

export interface FixtureRecord {
	id: string;
	role: string;
	source: string;
	hex: string;
	cmd: number | null;
	to: number[] | null;
	from: number[] | null;
	reqId: number | null;
	entries: FixtureEntry[];
}

export interface Fixture {
	provenance: {
		report: string;
		routeros_version: string;
		route: number[] | string;
		note?: string;
	};
	records: FixtureRecord[];
}

export function repoPath(rel: string): string {
	return fileURLToPath(new URL(`../../../${rel}`, import.meta.url));
}

export function loadFixture(name: string): Fixture {
	return JSON.parse(
		readFileSync(repoPath(`fixtures/winbox-ipc/${name}`), "utf8"),
	) as Fixture;
}

export function loadYamlDoc<T>(rel: string): T {
	return parseYaml(readFileSync(repoPath(rel), "utf8")) as T;
}

export function fmtKey(key: number): string {
	return `0x${key.toString(16).padStart(6, "0")}`;
}

export function fmtTcode(tcode: number): string {
	return `0x${tcode.toString(16)}`;
}

export function hexBytes(hex: string): Uint8Array {
	const pairs = hex.match(/.{2}/g);
	if (!pairs) throw new Error("empty hex fixture");
	return Uint8Array.from(pairs.map((b) => Number.parseInt(b, 16)));
}

interface Cursor {
	buf: Uint8Array;
	view: DataView;
	end: number;
	pos: number;
}

function decodeEntriesAt(c: Cursor): FixtureEntry[] {
	const text = new TextDecoder();
	const out: FixtureEntry[] = [];
	while (c.pos < c.end) {
		const keyLow = c.buf[c.pos] as number;
		const keyHigh = c.buf[c.pos + 1] as number;
		const ns = c.buf[c.pos + 2] as number;
		const tcode = c.buf[c.pos + 3] as number;
		c.pos += 4;
		const key = (ns << 16) | (keyHigh << 8) | keyLow;
		out.push({
			key: fmtKey(key),
			tcode: fmtTcode(tcode),
			value: decodeValue(c, tcode, text),
		});
	}
	return out;
}

function decodeNested(bytes: Uint8Array): FixtureEntry[] {
	if (bytes.length < 2 || bytes[0] !== 0x4d || bytes[1] !== 0x32) {
		throw new Error("nested message without M2 magic");
	}
	const c: Cursor = {
		buf: bytes,
		view: new DataView(bytes.buffer, bytes.byteOffset, bytes.length),
		end: bytes.length,
		pos: 2,
	};
	return decodeEntriesAt(c);
}

function decodeValue(c: Cursor, tcode: number, text: TextDecoder): unknown {
	switch (tcode) {
		case 0x00:
			return false;
		case 0x01:
			return true;
		case 0x09: {
			const v = c.buf[c.pos] as number;
			c.pos += 1;
			return v;
		}
		case 0x08: {
			const v = c.view.getUint32(c.pos, true);
			c.pos += 4;
			return v;
		}
		case 0x10: {
			const v = c.view.getBigUint64(c.pos, true);
			c.pos += 8;
			const n = Number(v);
			if (!Number.isSafeInteger(n)) throw new Error("u64 beyond safe int");
			return n;
		}
		case 0x18: {
			const v = `hex:${[...c.buf.slice(c.pos, c.pos + 16)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
			c.pos += 16;
			return v;
		}
		case 0x21: {
			const len = c.buf[c.pos] as number;
			c.pos += 1;
			const v = text.decode(c.buf.slice(c.pos, c.pos + len));
			c.pos += len;
			return v;
		}
		case 0x31: {
			const len = c.buf[c.pos] as number;
			c.pos += 1;
			const v = `hex:${[...c.buf.slice(c.pos, c.pos + len)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
			c.pos += len;
			return v;
		}
		case 0x20: {
			const len = c.view.getUint16(c.pos, true);
			c.pos += 2;
			const v = text.decode(c.buf.slice(c.pos, c.pos + len));
			c.pos += len;
			return v;
		}
		case 0x28: {
			const len = c.view.getUint16(c.pos, true);
			c.pos += 2;
			const v = decodeNested(c.buf.slice(c.pos, c.pos + len));
			c.pos += len;
			return v;
		}
		case 0x29: {
			const len = c.buf[c.pos] as number;
			c.pos += 1;
			const v = decodeNested(c.buf.slice(c.pos, c.pos + len));
			c.pos += len;
			return v;
		}
		case 0x88: {
			const count = c.view.getUint16(c.pos, true);
			c.pos += 2;
			const arr: number[] = [];
			for (let i = 0; i < count; i++) {
				arr.push(c.view.getUint32(c.pos, true));
				c.pos += 4;
			}
			return arr;
		}
		case 0xa0: {
			const count = c.view.getUint16(c.pos, true);
			c.pos += 2;
			const arr: string[] = [];
			for (let i = 0; i < count; i++) {
				const len = c.view.getUint16(c.pos, true);
				c.pos += 2;
				arr.push(text.decode(c.buf.slice(c.pos, c.pos + len)));
				c.pos += len;
			}
			return arr;
		}
		case 0xa8: {
			const count = c.view.getUint16(c.pos, true);
			c.pos += 2;
			const rows: FixtureEntry[][] = [];
			for (let i = 0; i < count; i++) {
				const len = c.view.getUint16(c.pos, true);
				c.pos += 2;
				rows.push(decodeNested(c.buf.slice(c.pos, c.pos + len)));
				c.pos += len;
			}
			return rows;
		}
		default:
			throw new Error(`unhandled tcode 0x${tcode.toString(16)}`);
	}
}

/** Decode fixture hex into the recorded-entry shape (for deep-equal replay). */
export function decodeFixtureEntries(hex: string): FixtureEntry[] {
	return decodeNested(hexBytes(hex));
}

export function findEntry(
	entries: FixtureEntry[],
	key: string,
): FixtureEntry | undefined {
	return entries.find((e) => e.key === key);
}

export function requiredEntry(
	entries: FixtureEntry[],
	key: string,
	what: string,
): FixtureEntry {
	const e = findEntry(entries, key);
	if (!e) throw new Error(`replay: missing ${what} (${key})`);
	return e;
}

/** Entries carried by a 0x28/0x29 nested-message entry. */
export function nestedOf(entry: FixtureEntry): FixtureEntry[] {
	if (entry.tcode !== "0x28" && entry.tcode !== "0x29") {
		throw new Error(`replay: ${entry.key} is ${entry.tcode}, not nested`);
	}
	return entry.value as FixtureEntry[];
}

/** Rows carried by a 0xa8 message-array entry. */
export function rowsOf(entry: FixtureEntry): FixtureEntry[][] {
	if (entry.tcode !== "0xa8") {
		throw new Error(`replay: ${entry.key} is ${entry.tcode}, not 0xa8`);
	}
	return entry.value as FixtureEntry[][];
}

export function required<T>(value: T | undefined, what: string): T {
	if (value === undefined) throw new Error(`replay test: missing ${what}`);
	return value;
}
