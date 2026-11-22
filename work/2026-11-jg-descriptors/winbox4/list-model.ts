/**
 * Plan step 5: the list a client displays, rebuilt from M2 messages only.
 * Shared by the offline check (test/profiles/winbox-ipc/
 * winbox4-bridge-workflow.test.ts) and trace.ts. Input is client-neutral:
 * each client's fixture is turned into ListEvents by its own adapter.
 *
 * Rules (std-commands 0xfe000b / 0xfe0007, std-keys 0xfe0005 / 0xfe0013,
 * plan step 4 q4):
 *   - a list read (GETALL reply) replaces the rows, in reply order;
 *   - a notification row merges by 0xfe0001; 0xfe0013 = 1 removes it;
 *   - a row that carries 0xfe0005 (next id) moves to just before that
 *     row, or to the end for 0xFFFFFFFF or an id not in the list.
 *     MOVE notifies only the moved row, so the row that used to point at
 *     it is never re-sent; ordering by "insert before next" needs nothing
 *     else.
 */

export const LAST = 0xffffffff;

export interface RowUpdate {
	id: number;
	next?: number;
	comment?: string;
	removed?: boolean;
}

export interface ListEvent {
	tMs: number;
	/**
	 * list = a list read; notify = CMD_NOTIFY rows; release = the client
	 * dropped its subscription (UNSUBSCRIBE), so the display may go stale
	 * until the next read and that read is not checked.
	 */
	kind: "list" | "notify" | "release";
	rows: RowUpdate[];
	/** Fixture record id, for messages. */
	ref: string;
}

export interface Displayed {
	ids: number[];
	comments: string[];
}

export class ListView {
	private order: number[] = [];
	private comments = new Map<number, string>();

	apply(ev: ListEvent): void {
		if (ev.kind === "release") return;
		if (ev.kind === "list") {
			this.order = ev.rows.map((r) => r.id);
			this.comments = new Map(ev.rows.map((r) => [r.id, r.comment ?? ""]));
			return;
		}
		for (const r of ev.rows) {
			if (r.removed) {
				this.order = this.order.filter((x) => x !== r.id);
				this.comments.delete(r.id);
				continue;
			}
			if (r.comment !== undefined) this.comments.set(r.id, r.comment);
			else if (!this.comments.has(r.id)) this.comments.set(r.id, "");
			const known = this.order.includes(r.id);
			if (r.next === undefined && known) continue;
			this.order = this.order.filter((x) => x !== r.id);
			const at =
				r.next === undefined || r.next === LAST
					? -1
					: this.order.indexOf(r.next);
			if (at < 0) this.order.push(r.id);
			else this.order.splice(at, 0, r.id);
		}
	}

	display(): Displayed {
		return {
			ids: [...this.order],
			comments: this.order.map((id) => this.comments.get(id) ?? ""),
		};
	}
}

export interface Replay {
	/** Display after each event, in order. */
	states: Array<{ ev: ListEvent; shown: Displayed }>;
	/**
	 * List reads whose rows differ from what the previous state plus the
	 * notifications since predicted (none means notifications alone kept
	 * the display right between reads). The first read after a release is
	 * a fresh start, not a check.
	 */
	mismatches: Array<{ ref: string; predicted: Displayed; read: Displayed }>;
}

/** Replay events in order; check every list read against the prediction. */
export function replay(events: ListEvent[]): Replay {
	const view = new ListView();
	const states: Replay["states"] = [];
	const mismatches: Replay["mismatches"] = [];
	let seeded = false;
	for (const ev of events) {
		if (ev.kind === "list" && seeded) {
			const predicted = view.display();
			const probe = new ListView();
			probe.apply(ev);
			const read = probe.display();
			if (JSON.stringify(predicted) !== JSON.stringify(read))
				mismatches.push({ ref: ev.ref, predicted, read });
		}
		view.apply(ev);
		seeded = ev.kind !== "release" && (seeded || ev.kind === "list");
		states.push({ ev, shown: view.display() });
	}
	return { states, mismatches };
}

/** The display in effect at time t (after every event at or before t). */
export function shownAt(r: Replay, tMs: number): Displayed | null {
	let cur: Displayed | null = null;
	for (const s of r.states) {
		if (s.ev.tMs > tMs) break;
		cur = s.shown;
	}
	return cur;
}
