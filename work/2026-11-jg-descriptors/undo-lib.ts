// cspell:ignore quickchr
/**
 * Shared live plumbing for the [17] undo-history oracle (plan step 4b).
 *
 * UndoListener opens one native SRP session, subscribes to [17] with a
 * MessagePump, and turns the CMD_NOTIFY messages from [17] into history
 * rows (letter-keyed, as WebFig sees them). centrsExec runs one REST
 * command through centrs (the control path; mutations are gated by the
 * caller with requireMutationGate).
 *
 * [17] commands, from WebFig's 7.25 master.js (static) and tested in
 * undo-q1.ts: 0x80001 undo, 0x80002 redo, 0x80007 peek the next undo
 * (reply s3 = its description, error when empty), 0x80008 peek the next
 * redo.
 */
import { appendFileSync } from "node:fs";
import { type EncEntry, encU32 } from "../2026-10-chr-extraction/ws3c/m2.ts";
import { buildRequest } from "../2026-10-chr-extraction/ws3c/probe.ts";
import {
	MessagePump,
	type PumpRecord,
} from "../2026-11-winbox-attributes/harness/pump.ts";
import { openSession } from "../2026-11-winbox-attributes/harness/session.ts";
import type { LabTarget } from "../2026-11-winbox-attributes/harness/target.ts";
import {
	decodeLetters,
	hexToBytes,
	type LetterMsg,
} from "./webfig/m2-letters.ts";

export const UNDO_ROUTE = [17];
export const CMD_SUBSCRIBE = 0xfe0012;
export const CMD_GETALL = 0xfe0004;
export const CMD_SET = 0xfe000e;
export const UNDO_CMD = {
	undo: 0x80001,
	redo: 0x80002,
	peekUndo: 0x80007,
	peekRedo: 0x80008,
} as const;

export type CentrsResult = { ok: boolean; data: unknown; error?: string };

/** Run one command over REST via centrs; returns ok + data, never throws on router errors. */
export function centrsExec(machine: string, cli: string[]): CentrsResult {
	const r = Bun.spawnSync([
		"centrs",
		"execute",
		"--quickchr",
		machine,
		"--via",
		"rest-api",
		"--yes",
		"--json",
		"--",
		...cli,
	]);
	// centrs prints its JSON on stdout when ok and on stderr on failure.
	const text = r.stdout.toString().trim() || r.stderr.toString();
	try {
		const j = JSON.parse(text) as {
			ok?: boolean;
			data?: unknown;
			error?: unknown;
		};
		return {
			ok: j.ok === true,
			data: j.data,
			...(j.ok ? {} : { error: errorText(j.error ?? j) }),
		};
	} catch {
		return {
			ok: false,
			data: null,
			error: `centrs: no JSON (${r.stderr.toString().slice(0, 300)})`,
		};
	}
}

function errorText(e: unknown): string {
	const x = e as { code?: string; context?: { detail?: string } };
	return `${x.code ?? "error"}: ${x.context?.detail ?? JSON.stringify(e).slice(0, 200)}`;
}

export const isUndoNotify = (r: PumpRecord) =>
	r.direction === "rx" &&
	JSON.stringify(r.from) === "[17]" &&
	r.cmd === 0xfe000b;

/** History rows (Mfe0002 entries) of one [17] message. */
export function rowsOf(rec: PumpRecord): LetterMsg[] {
	const m = decodeLetters(hexToBytes(rec.plaintextHex)).msg;
	return (m["Mfe0002"] ?? []) as LetterMsg[];
}

export class UndoListener {
	private reqId = 10;
	private constructor(
		readonly pump: MessagePump,
		private readonly sourceId: number,
		private readonly close: () => void,
	) {}

	/** Open a session and SUBSCRIBE [17]; the replay stays in the inbox. */
	static async open(
		t: LabTarget,
		label: string,
		capturePath: string,
		mark: () => string,
	): Promise<UndoListener> {
		const s = await openSession(t.host, t.port, t.user, t.pass, {
			timeoutMs: 8000,
		});
		const pump = new MessagePump(s.transport, {
			label,
			onCapture: (r) =>
				appendFileSync(
					capturePath,
					`${JSON.stringify({ ...r, mark: mark() })}\n`,
				),
		});
		const l = new UndoListener(pump, s.sourceId, s.close);
		try {
			const sub = await l.request(CMD_SUBSCRIBE);
			if (sub.status !== "ok")
				throw new Error(`SUBSCRIBE [17] failed: ${sub.status}`);
		} catch (e) {
			// The caller gets no handle on failure: release the session here.
			await l.stop();
			throw e;
		}
		return l;
	}

	async request(
		cmd: number,
		to: number[] = UNDO_ROUTE,
		extra: EncEntry[] = [],
	) {
		const id = this.reqId++;
		return this.pump.request(
			buildRequest(to, cmd, this.sourceId, id, extra),
			id,
			8000,
		);
	}

	/** Native write (e.g. CMD_SET) to any route; returns the outcome status. */
	async write(to: number[], cmd: number, extra: EncEntry[]) {
		return (await this.request(cmd, to, extra)).status;
	}

	/**
	 * Page GETALL [17] by the server's 0xfe0003 token. Returns the total
	 * (ufe0019 on the first page), the row ids in reply order and the
	 * number of pages.
	 */
	async getall(maxPages = 500) {
		const ids: number[] = [];
		let total: number | null = null;
		let token: number | null = null;
		let pages = 0;
		while (pages < maxPages) {
			const o = await this.request(
				CMD_GETALL,
				UNDO_ROUTE,
				token === null ? [] : [encU32(0xfe0003, token)],
			);
			if (o.status !== "ok") throw new Error(`GETALL [17]: ${o.status}`);
			pages++;
			const m = decodeLetters(hexToBytes(o.rx.plaintextHex)).msg;
			total ??= (m["ufe0019"] as number | undefined) ?? null;
			for (const r of (m["Mfe0002"] ?? []) as LetterMsg[])
				ids.push(r["ufe0001"] as number);
			const next = m["ufe0003"] as number | undefined;
			if (next === undefined || next === token) break;
			token = next;
		}
		return { total, ids, pages };
	}

	/** Undo-family command on [17]; returns the reply letters and error flag. */
	async undoCmd(cmd: number): Promise<{ error: boolean; reply: LetterMsg }> {
		const o = await this.request(cmd);
		if (o.status === "timeout") throw new Error(`[17] cmd ${cmd} timed out`);
		const reply = decodeLetters(hexToBytes(o.rx.plaintextHex)).msg;
		return { error: o.status === "router-error", reply };
	}

	/** Wait for [17] notifications (up to maxMs, then settleMs) and return their rows. */
	async rows(maxMs = 2500, settleMs = 300): Promise<LetterMsg[]> {
		const got = await this.pump.listenFor(isUndoNotify, maxMs, settleMs);
		return got.filter(isUndoNotify).flatMap(rowsOf);
	}

	async stop(): Promise<void> {
		await this.pump.stop(this.close);
	}
}

/** REST print data as rows: an array stays, {} is empty, one object is one row. */
export function restRows(data: unknown): Array<Record<string, string>> {
	if (Array.isArray(data)) return data as Array<Record<string, string>>;
	if (typeof data === "object" && data !== null) {
		const o = data as Record<string, string>;
		return Object.keys(o).length === 0 || "ret" in o ? [] : [o];
	}
	return [];
}
