// Phase B harness: correlated request/reply over a WinBox session.
//
// Replaces probe.ts roundTrip's "accept the next message" behavior: this
// module matches replies by SYS_REQID (0xff0006), stashes mismatched
// (async/notification) traffic separately, and returns explicit outcomes.
// Error, timeout, empty list, and absent field stay distinct; batch callers
// get a structured cause, never an exception for a router-level outcome.
import {
	decodeM2,
	findEntry,
	type M2Message,
} from "../../2026-10-chr-extraction/ws3c/m2.ts";
import { type CaptureRecord, captureMessage } from "./capture.ts";

/** Minimal session transport: plaintext M2 bytes in each direction. */
export interface CorrelatedTransport {
	send(plain: Uint8Array): Promise<void>;
	recv(): Promise<Uint8Array>;
}

export interface CorrelatedOk {
	status: "ok";
	reqId: number;
	reply: M2Message;
	rawHex: string;
	/** Router status word when present; null = field absent (not assumed). */
	statusWord: number | null;
	errno: number | null;
	errstr: string | null;
	asyncSeen: CaptureRecord[];
	attempts: number;
}

export interface CorrelatedRouterError {
	status: "router-error";
	reqId: number;
	reply: M2Message;
	rawHex: string;
	errno: number | null;
	errstr: string | null;
	asyncSeen: CaptureRecord[];
	attempts: number;
}

export interface CorrelatedTimeout {
	status: "timeout";
	reqId: number;
	waitedMs: number;
	attempts: number;
	asyncSeen: CaptureRecord[];
}

export interface CorrelatedDecodeError {
	status: "decode-error";
	reqId: number;
	error: string;
	rawHex: string;
	attempts: number;
	asyncSeen: CaptureRecord[];
}

export interface CorrelatedAsyncOverflow {
	status: "async-overflow";
	reqId: number;
	maxAsync: number;
	asyncSeen: CaptureRecord[];
	attempts: number;
}

export type CorrelatedOutcome =
	| CorrelatedOk
	| CorrelatedRouterError
	| CorrelatedTimeout
	| CorrelatedDecodeError
	| CorrelatedAsyncOverflow;

export interface CorrelateOptions {
	timeoutMs: number;
	/** Resend count on timeout only (default 1 = no retry). */
	attempts?: number;
	/** Max stashed async messages before async-overflow (default 100). */
	maxAsync?: number;
	/** First capture sequence number (default 0). */
	seqStart?: number;
	/** Optional sink for every captured tx/rx record. */
	onCapture?: (rec: CaptureRecord) => void;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Send one request and wait for the reply carrying the same SYS_REQID.
 * Async traffic (other request IDs, or replies without one) is captured
 * and stashed, never mistaken for the answer.
 */
export async function correlatedRequest(
	transport: CorrelatedTransport,
	requestPlain: Uint8Array,
	reqId: number,
	opts: CorrelateOptions,
): Promise<CorrelatedOutcome> {
	const attempts = opts.attempts ?? 1;
	if (attempts < 1) throw new Error("correlate: attempts must be >= 1");
	const maxAsync = opts.maxAsync ?? 100;
	let seq = opts.seqStart ?? 0;
	const asyncSeen: CaptureRecord[] = [];
	const emit = (rec: CaptureRecord): void => {
		seq = rec.seq + 1;
		opts.onCapture?.(rec);
	};

	for (let attempt = 1; attempt <= attempts; attempt++) {
		emit(captureMessage(seq, "tx", requestPlain, `attempt ${attempt}`));
		await transport.send(requestPlain);
		const deadline = Date.now() + opts.timeoutMs;
		for (;;) {
			const remaining = deadline - Date.now();
			if (remaining <= 0) {
				return {
					status: "timeout",
					reqId,
					waitedMs: opts.timeoutMs,
					attempts: attempt,
					asyncSeen,
				};
			}
			const rx = await Promise.race([
				transport.recv().then((b) => ({ bytes: b as Uint8Array | null })),
				sleep(remaining).then(() => ({ bytes: null })),
			]);
			if (rx.bytes === null) {
				break; // attempt timeout -> retry or report below
			}
			const rec = captureMessage(seq, "rx", rx.bytes);
			emit(rec);
			let reply: M2Message;
			try {
				reply = decodeM2(rx.bytes);
			} catch (e) {
				return {
					status: "decode-error",
					reqId,
					error: (e as Error).message,
					rawHex: rec.plaintextHex,
					attempts: attempt,
					asyncSeen,
				};
			}
			const gotReq = findEntry(reply, 0xff0006)?.value;
			if (gotReq !== reqId) {
				asyncSeen.push(rec);
				if (asyncSeen.length > maxAsync) {
					return {
						status: "async-overflow",
						reqId,
						maxAsync,
						asyncSeen,
						attempts: attempt,
					};
				}
				continue;
			}
			const statusWord = findEntry(reply, 0xff0004)?.value;
			const errnoRaw = findEntry(reply, 0xff0008)?.value;
			const errstrRaw = findEntry(reply, 0xff0009)?.value;
			const errno = typeof errnoRaw === "number" ? errnoRaw : null;
			const errstr = typeof errstrRaw === "string" ? errstrRaw : null;
			if (statusWord === 2) {
				return {
					status: "router-error",
					reqId,
					reply,
					rawHex: rec.plaintextHex,
					errno,
					errstr,
					asyncSeen,
					attempts: attempt,
				};
			}
			return {
				status: "ok",
				reqId,
				reply,
				rawHex: rec.plaintextHex,
				statusWord: typeof statusWord === "number" ? statusWord : null,
				errno,
				errstr,
				asyncSeen,
				attempts: attempt,
			};
		}
		// Attempt timed out with no bytes at all; retry if attempts remain.
		if (attempt === attempts) {
			return {
				status: "timeout",
				reqId,
				waitedMs: opts.timeoutMs,
				attempts: attempt,
				asyncSeen,
			};
		}
	}
	throw new Error("correlate: unreachable");
}

/** Allocate request IDs from 2 upward (1 is the adoption leg). */
export function nextReqId(last: number): number {
	if (!Number.isInteger(last) || last < 1) {
		throw new Error(`correlate: bad last reqid ${last}`);
	}
	return last + 1;
}
