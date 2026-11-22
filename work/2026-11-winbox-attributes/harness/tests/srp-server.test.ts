// Plan step 5: the proxy's server-side EC-SRP5 must agree with the ws3c
// client math (which logs in to real routers) in both byte encodings, and
// its keys must open what the client role seals, in both directions.
import { describe, expect, test } from "bun:test";
import {
	clientShared,
	keygen,
	srpId,
} from "../../../2026-10-chr-extraction/ws3c/ec-srp5.ts";
import {
	decryptEnvelope,
	deriveClientKeys,
	encryptEnvelope,
} from "../../../2026-10-chr-extraction/ws3c/session-crypto.ts";
import {
	serverFinish,
	serverHello,
} from "../../../2026-11-jg-descriptors/winbox4/srp-server.ts";

describe("srp-server (step 5 proxy)", () => {
	for (const padded32 of [false, true]) {
		test(`agrees with clientShared, padded32=${padded32}`, () => {
			for (let i = 0; i < 6; i++) {
				const hello = serverHello("admin", "lab-pass", padded32);
				const kp = keygen();
				const { shared } = clientShared(
					kp.privateKey,
					hello.publicKey,
					kp.publicKey,
					srpId("admin", "lab-pass", hello.salt),
					padded32,
				);
				const fin = serverFinish(hello, kp.publicKey, shared.clientConfirm);
				expect(fin.ok).toBe(true);
				expect([...fin.serverConfirm]).toEqual([...shared.serverConfirm]);

				const client = deriveClientKeys(shared.secret);
				const msg = new TextEncoder().encode(`m2 message ${i}`);
				const up = encryptEnvelope(client.sendAes, client.sendHmac, msg);
				expect([
					...decryptEnvelope(fin.keys.receiveAes, fin.keys.receiveHmac, up),
				]).toEqual([...msg]);
				const down = encryptEnvelope(fin.keys.sendAes, fin.keys.sendHmac, msg);
				expect([
					...decryptEnvelope(client.receiveAes, client.receiveHmac, down),
				]).toEqual([...msg]);
			}
		});
	}

	test("rejects a wrong password", () => {
		const hello = serverHello("admin", "lab-pass");
		const kp = keygen();
		const { shared } = clientShared(
			kp.privateKey,
			hello.publicKey,
			kp.publicKey,
			srpId("admin", "wrong", hello.salt),
			false,
		);
		expect(serverFinish(hello, kp.publicKey, shared.clientConfirm).ok).toBe(
			false,
		);
	});

	test("phase-1 reply is public key then salt (49 bytes)", () => {
		const hello = serverHello("admin", "x");
		expect(hello.reply.length).toBe(49);
		expect([...hello.reply.subarray(33)]).toEqual([...hello.salt]);
	});

	test("rejects a salt override that is not 16 bytes", () => {
		expect(() => serverHello("admin", "x", false, new Uint8Array(15))).toThrow(
			"16 bytes",
		);
		expect(
			serverHello("admin", "x", false, new Uint8Array(16)).reply.length,
		).toBe(49);
	});
});
