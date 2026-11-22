// Shared by the WinBox 4 fixture tests (plan step 5 and its recovery
// follow-up): load an entry-form fixture (native or WinBox proxy) and turn
// its [16,2] traffic into list-model events
// (work/2026-11-jg-descriptors/winbox4/list-model.ts).

import type {
	ListEvent,
	RowUpdate,
} from "../../../work/2026-11-jg-descriptors/winbox4/list-model";
import type { FixtureEntry, FixtureRecord } from "./m2-replay";
import {
	decodeFixtureEntries,
	findEntry,
	loadFixture,
	rowsOf,
} from "./m2-replay";

export const PORT = "[16,2]";
const GETALL = 0xfe0004;
const NOTIFY = 0xfe000b;
const SUBSCRIBE = 0xfe0012;
const UNSUBSCRIBE = 0xfe0013;

export interface Rec extends FixtureRecord {
	mark: string;
	session: string;
	tMs: number;
}
export interface Decoded extends Rec {
	all: FixtureEntry[];
}

export function loadDecoded(name: string): {
	prov: Record<string, unknown>;
	recs: Decoded[];
} {
	const fx = loadFixture(name);
	return {
		prov: fx.provenance as unknown as Record<string, unknown>,
		recs: fx.records.map((r) => ({
			...(r as Rec),
			all: decodeFixtureEntries(r.hex),
		})),
	};
}

export function rowUpdate(row: FixtureEntry[]): RowUpdate {
	const v = (k: string) => findEntry(row, k)?.value;
	const id = v("0xfe0001");
	if (typeof id !== "number") throw new Error("row without 0xfe0001");
	const next = v("0xfe0005");
	const comment = v("0xfe0009");
	return {
		id,
		...(typeof next === "number" ? { next } : {}),
		...(typeof comment === "string" ? { comment } : {}),
		...(v("0xfe0013") === 1 ? { removed: true } : {}),
	};
}

export interface EventOptions {
	/**
	 * Treat the NOTIFY that answers a SUBSCRIBE carrying 0xff0017=true
	 * (SYS_SNAPSHOT: every row, sys-keys.yaml) as a list read.
	 */
	snapshotIsList?: boolean;
}

/**
 * Entry-form records of the given sessions, in fixture order. A change of
 * session (a new connection) is a release: the next read starts afresh.
 */
export function entryEvents(
	recs: Decoded[],
	sessions: string | string[],
	opts: EventOptions = {},
): ListEvent[] {
	const want = new Set(typeof sessions === "string" ? [sessions] : sessions);
	const asked = new Map<string, Decoded>();
	const out: ListEvent[] = [];
	let snapshotDue = false;
	let current: string | null = null;
	for (const r of recs) {
		if (!want.has(r.session)) continue;
		if (current !== null && r.session !== current)
			out.push({ tMs: r.tMs, kind: "release", rows: [], ref: r.id });
		current = r.session;
		const to = JSON.stringify(r.to);
		const from = JSON.stringify(r.from);
		if (r.cmd !== null && to === PORT && r.reqId !== null)
			asked.set(`${r.session}:${r.reqId}`, r);
		if (r.cmd === UNSUBSCRIBE && to === PORT)
			out.push({ tMs: r.tMs, kind: "release", rows: [], ref: r.id });
		if (r.cmd === SUBSCRIBE && to === PORT)
			snapshotDue = findEntry(r.all, "0xff0017")?.value === true;
		if (from !== PORT) continue;
		const rowsE = findEntry(r.all, "0xfe0002");
		if (r.cmd === NOTIFY) {
			const rows = rowsE ? rowsOf(rowsE).map(rowUpdate) : [];
			const kind = opts.snapshotIsList && snapshotDue ? "list" : "notify";
			snapshotDue = false;
			out.push({ tMs: r.tMs, kind, rows, ref: r.id });
			continue;
		}
		const tx =
			r.reqId !== null ? asked.get(`${r.session}:${r.reqId}`) : undefined;
		if (!tx || tx.cmd !== GETALL || !rowsE) continue;
		// 0xfe000c bit 29 asks for the defaults row, not the list.
		const word = findEntry(tx.all, "0xfe000c")?.value;
		if (typeof word === "number" && (word & 0x20000000) !== 0) continue;
		out.push({
			tMs: r.tMs,
			kind: "list",
			rows: rowsOf(rowsE).map(rowUpdate),
			ref: r.id,
		});
	}
	return out;
}
