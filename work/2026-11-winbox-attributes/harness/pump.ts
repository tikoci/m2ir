// Phase B harness: message pump for sessions that receive unsolicited
// traffic (CMD_NOTIFY after CMD_SUBSCRIBE).
//
// correlate.ts reads only while a request is pending and stashes what it
// does not match. That loses the timing of notifications and leaves a
// dangling recv() when its timer wins the race. A pump has exactly one
// reader: a background loop that captures every rx message the moment it
// arrives. Requests wait for their SYS_REQID in that stream; everything
// else stays in an inbox that listen() drains after a fixed window.
import {
	decodeM2,
	type M2Message,
} from "../../2026-10-chr-extraction/ws3c/m2.ts";
import { type CaptureRecord, captureMessage } from "./capture.ts";
import type { CorrelatedTransport } from "./correlate.ts";

/** One captured message plus pump bookkeeping. */
export interface PumpRecord extends CaptureRecord {
	/** Pump label, e.g. "A" (listener) or "B" (other client). */
	session: string;
	/** ms since the shared clock origin (monotonic). */
	tMs: number;
}

export type PumpOutcome =
	| {
			status: "ok" | "router-error";
			reqId: number;
			tx: PumpRecord;
			rx: PumpRecord;
			reply: M2Message;
			errno: number | null;
			errstr: string | null;
	  }
	| { status: "timeout"; reqId: number; tx: PumpRecord; waitedMs: number };

export interface PumpOptions {
	label: string;
	/** Shared monotonic origin so several pumps share one timeline. */
	clock?: () => number;
	/** Sink for every tx/rx record, in capture order. */
	onCapture?: (rec: PumpRecord) => void;
}

interface Waiter {
	match: (rec: PumpRecord) => boolean;
	resolve: (rec: PumpRecord | null) => void;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MessagePump {
	readonly label: string;
	/** Every record this pump captured (tx and rx), in order. */
	readonly log: PumpRecord[] = [];
	private inbox: PumpRecord[] = [];
	private waiters: Waiter[] = [];
	private seq = 0;
	private stopped = false;
	private failure: Error | null = null;
	private readonly clock: () => number;
	private readonly onCapture: ((rec: PumpRecord) => void) | undefined;
	private readonly loop: Promise<void>;

	constructor(
		private readonly transport: CorrelatedTransport,
		opts: PumpOptions,
	) {
		this.label = opts.label;
		const t0 = performance.now();
		this.clock = opts.clock ?? (() => performance.now() - t0);
		this.onCapture = opts.onCapture;
		this.loop = this.readLoop();
	}

	private record(dir: "tx" | "rx", bytes: Uint8Array, note?: string) {
		const base = captureMessage(this.seq++, dir, bytes, note);
		const rec: PumpRecord = {
			...base,
			session: this.label,
			tMs: Math.round(this.clock() * 10) / 10,
		};
		this.log.push(rec);
		this.onCapture?.(rec);
		return rec;
	}

	private async readLoop(): Promise<void> {
		try {
			while (!this.stopped) {
				let bytes: Uint8Array;
				try {
					bytes = await this.transport.recv();
				} catch (e) {
					if (!this.stopped) this.failure = e as Error;
					break;
				}
				// A capture sink failure (onCapture) is a reader failure too.
				const rec = this.record("rx", bytes);
				const w = this.waiters.findIndex((x) => x.match(rec));
				if (w >= 0) {
					const [hit] = this.waiters.splice(w, 1);
					hit?.resolve(rec);
				} else {
					this.inbox.push(rec);
				}
			}
		} catch (e) {
			this.failure = e as Error;
		} finally {
			for (const w of this.waiters.splice(0)) w.resolve(null);
		}
	}

	/** Reader failure (socket death), or null while healthy. */
	get error(): Error | null {
		return this.failure;
	}

	async send(plain: Uint8Array, note?: string): Promise<PumpRecord> {
		if (this.failure) throw this.failure;
		const rec = this.record("tx", plain, note);
		await this.transport.send(plain);
		return rec;
	}

	/** Record tx now; the returned promise settles when the send does. */
	private startSend(
		plain: Uint8Array,
		note?: string,
	): { rec: PumpRecord; sent: Promise<void> } {
		if (this.failure) throw this.failure;
		const rec = this.record("tx", plain, note);
		return { rec, sent: this.transport.send(plain) };
	}

	/**
	 * Send and wait for the reply with the same SYS_REQID. Other traffic
	 * that arrives meanwhile stays in the inbox for listen().
	 */
	async request(
		plain: Uint8Array,
		reqId: number,
		timeoutMs: number,
		note?: string,
	): Promise<PumpOutcome> {
		let waiter: Waiter | null = null;
		// Register before sending so a fast reply still matches; the
		// timeout covers the send too (a stalled write has no own deadline).
		const got = new Promise<PumpRecord | null>((resolve) => {
			waiter = { match: (r) => r.reqId === reqId, resolve };
			this.waiters.push(waiter);
		});
		const timeout = sleep(timeoutMs).then(() => null);
		let tx: PumpRecord;
		let rx: PumpRecord | null;
		try {
			const s = this.startSend(plain, note);
			tx = s.rec;
			const sent = await Promise.race([s.sent.then(() => true), timeout]);
			rx = sent === null ? null : await Promise.race([got, timeout]);
		} finally {
			// On any exit without a reply (timeout, send failure) drop the
			// waiter; a late reply then lands in the inbox for listen().
			this.waiters = this.waiters.filter((w) => w !== waiter);
		}
		if (rx === null) {
			if (this.failure) throw this.failure;
			return { status: "timeout", reqId, tx, waitedMs: timeoutMs };
		}
		const reply = decodeM2(new Uint8Array(Buffer.from(rx.plaintextHex, "hex")));
		const field = (k: number) =>
			reply.entries.find((e) => e.fullKey === k)?.value;
		const st = field(0xff0004);
		const errno = field(0xff0008);
		const errstr = field(0xff0009);
		return {
			status: st === 2 ? "router-error" : "ok",
			reqId,
			tx,
			rx,
			reply,
			errno: typeof errno === "number" ? errno : null,
			errstr: typeof errstr === "string" ? errstr : null,
		};
	}

	/** Wait windowMs, then return (and remove) every unsolicited message. */
	async listen(windowMs: number): Promise<PumpRecord[]> {
		await sleep(windowMs);
		return this.drain();
	}

	/**
	 * Wait until an unsolicited message matching pred arrives or maxMs
	 * passes, then keep listening settleMs for stragglers; return all
	 * unsolicited messages seen (removed from the inbox).
	 */
	async listenFor(
		pred: (rec: PumpRecord) => boolean,
		maxMs: number,
		settleMs: number,
	): Promise<PumpRecord[]> {
		const deadline = this.clock() + maxMs;
		while (this.clock() < deadline && !this.inbox.some(pred)) {
			if (this.failure) throw this.failure;
			await sleep(20);
		}
		await sleep(settleMs);
		return this.drain();
	}

	/** Remove and return the current inbox. */
	drain(): PumpRecord[] {
		return this.inbox.splice(0);
	}

	/** Stop reading; call before closing the socket. */
	async stop(close: () => void): Promise<void> {
		this.stopped = true;
		close();
		await this.loop;
	}
}
