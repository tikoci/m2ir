// Phase B harness: live session adapter (ChunkConn + session crypto as
// a CorrelatedTransport). Read path for smoke/experiments; mutations go
// through requireMutationGate in target.ts before any write verb.
import { frameMessage } from "../../2026-10-chr-extraction/ws3c/chunk.ts";
import { login } from "../../2026-10-chr-extraction/ws3c/probe.ts";
import {
	decryptEnvelope,
	encryptEnvelope,
} from "../../2026-10-chr-extraction/ws3c/session-crypto.ts";
import type { CorrelatedTransport } from "./correlate.ts";

export interface WinboxSession {
	transport: CorrelatedTransport;
	sourceId: number;
	close: () => void;
}

export interface SessionOptions {
	timeoutMs: number;
	fromGuess?: number;
}

/**
 * Authenticate (EC-SRP5) and adopt a source id. Throws on auth failure
 * or the MSCHAP-33 branch: this harness is SRP-only, explicitly.
 * Socket death is a thrown error; reqid-level timeouts stay outcomes
 * in correlate.ts. The socket timeout is deliberately generous so the
 * correlation timer drives outcome timeouts first.
 */
export async function openSession(
	host: string,
	port: number,
	user: string,
	pass: string,
	opts: SessionOptions,
): Promise<WinboxSession> {
	const s = await login(host, port, user, pass, {
		innerTag: false,
		padded32: false,
		timeoutMs: Math.max(opts.timeoutMs * 3, 15000),
		fromGuess: opts.fromGuess ?? 11,
	});
	if ("mschap" in s) {
		throw new Error(
			"session: server took the MSCHAP-33 branch; SRP-only harness stops here",
		);
	}
	const transport: CorrelatedTransport = {
		send: async (plain: Uint8Array): Promise<void> => {
			await s.conn.write(
				frameMessage(
					0x06,
					encryptEnvelope(s.keys.sendAes, s.keys.sendHmac, plain),
				),
			);
		},
		recv: async (): Promise<Uint8Array> => {
			const r = await s.conn.readMessage();
			if (r.tag !== 0x06)
				throw new Error(`session: reply tag ${r.tag}, want 0x06`);
			return decryptEnvelope(s.keys.receiveAes, s.keys.receiveHmac, r.payload);
		},
	};
	return { transport, sourceId: s.sourceId, close: () => s.conn.close() };
}
