// Phase B harness: lossless capture layer for WinBox M2 traffic.
//
// Every record keeps the exact plaintext bytes (full hex, never truncated)
// plus direction, order, request ID, routes, timestamps, and decode errors.
// An unknown tcode stops parsing explicitly (m2.ts throws with context);
// the record retains the original message either way. Semantic naming
// (schema-names.ts) is a separate overlay; capture never depends on it.
import { appendFileSync, readFileSync } from "node:fs";

import {
	decodeM2,
	findEntry,
	type M2Message,
	type M2Value,
} from "../../2026-10-chr-extraction/ws3c/m2.ts";

export type Direction = "tx" | "rx";

export interface LosslessEntry {
	key: string;
	tcode: string;
	value: unknown;
}

export type CaptureDecode =
	| { ok: true; entries: LosslessEntry[] }
	| { ok: false; error: string };

export interface CaptureRecord {
	seq: number;
	direction: Direction;
	ts: string;
	reqId: number | null;
	to: number[] | null;
	from: number[] | null;
	cmd: number | null;
	plaintextHex: string;
	decode: CaptureDecode;
	note?: string;
}

function hexFull(b: Uint8Array): string {
	return Buffer.from(b).toString("hex");
}

function fmtKey(fullKey: number): string {
	return `0x${fullKey.toString(16).padStart(6, "0")}`;
}

function fmtTcode(tcode: number): string {
	return `0x${tcode.toString(16)}`;
}

/** Lossless value rendering: full bytes, order and repeats preserved. */
export function losslessValue(v: M2Value): unknown {
	if (typeof v === "bigint") return `u64:${v.toString()}`;
	if (v instanceof Uint8Array) return `hex:${hexFull(v)}`;
	if (Array.isArray(v)) {
		if (
			v.length > 0 &&
			typeof v[0] === "object" &&
			!(v[0] instanceof Uint8Array)
		) {
			return (v as M2Message[]).map(losslessMessage);
		}
		return (v as unknown[]).map((x) =>
			x instanceof Uint8Array ? `hex:${hexFull(x)}` : x,
		);
	}
	if (typeof v === "object") return losslessMessage(v as M2Message);
	return v;
}

export function losslessMessage(m: M2Message): LosslessEntry[] {
	return m.entries.map((e) => ({
		key: fmtKey(e.fullKey),
		tcode: fmtTcode(e.tcode),
		value: losslessValue(e.value),
	}));
}

function numArray(v: M2Value | undefined): number[] | null {
	if (!Array.isArray(v)) return null;
	if (!v.every((x) => typeof x === "number")) return null;
	return v as number[];
}

function num(v: M2Value | undefined): number | null {
	return typeof v === "number" ? v : null;
}

/**
 * Capture one plaintext M2 message. Decode failure is recorded with the
 * original bytes, never thrown and never skipped.
 */
export function captureMessage(
	seq: number,
	direction: Direction,
	plaintext: Uint8Array,
	note?: string,
): CaptureRecord {
	const ts = new Date().toISOString();
	const plaintextHex = hexFull(plaintext);
	let decode: CaptureDecode;
	let reqId: number | null = null;
	let to: number[] | null = null;
	let from: number[] | null = null;
	let cmd: number | null = null;
	try {
		const msg = decodeM2(plaintext);
		decode = { ok: true, entries: losslessMessage(msg) };
		reqId = num(findEntry(msg, 0xff0006)?.value);
		to = numArray(findEntry(msg, 0xff0001)?.value);
		from = numArray(findEntry(msg, 0xff0002)?.value);
		cmd = num(findEntry(msg, 0xff0007)?.value);
	} catch (e) {
		decode = { ok: false, error: (e as Error).message };
	}
	const rec: CaptureRecord = {
		seq,
		direction,
		ts,
		reqId,
		to,
		from,
		cmd,
		plaintextHex,
		decode,
	};
	if (note !== undefined) rec.note = note;
	return rec;
}

/** Append one record as a single JSONL line. */
export function appendCapture(path: string, rec: CaptureRecord): void {
	appendFileSync(path, `${JSON.stringify(rec)}\n`, "utf8");
}

/**
 * Read a JSONL capture file. A malformed line is an explicit failure:
 * nothing is skipped, and the error names the line number.
 */
export function readCapture(path: string): CaptureRecord[] {
	const text = readFileSync(path, "utf8");
	const lines = text.split("\n").filter((l) => l.length > 0);
	return lines.map((line, i) => {
		try {
			return JSON.parse(line) as CaptureRecord;
		} catch (e) {
			throw new Error(
				`capture ${path} line ${i + 1}: invalid JSON (${(e as Error).message})`,
			);
		}
	});
}

/** Decode the retained bytes of a record, throwing on any decode error. */
export function replayBytes(rec: CaptureRecord): M2Message {
	return decodeM2(new Uint8Array(Buffer.from(rec.plaintextHex, "hex")));
}
