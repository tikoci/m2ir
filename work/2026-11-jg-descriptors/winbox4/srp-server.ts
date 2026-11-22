// cspell:ignore REDP
/**
 * Plan step 5: the server side of EC-SRP5, so a lab proxy can accept a
 * WinBox login with a known password. Mirrors the client math in
 * ../../2026-10-chr-extraction/ws3c/ec-srp5.ts:
 *
 *   v      = SHA-256(salt ‖ SHA-256(user ‖ ':' ‖ pass)),  V = v·G
 *   pubB   = sB·G + REDP1(MontX(V), parity 0)   (the client adds parity 1)
 *   j      = SHA-256(MontX(pubA) ‖ MontX(pubB))
 *   Z      = sB·(pubA + j·V)                      (= (v·j + sA)·sB·G)
 *   z      = MontX(Z), secret = SHA-256(z)
 *   client confirm = SHA-256(j ‖ z), server confirm = SHA-256(j ‖ cc ‖ z)
 *
 * Session keys are the client's with the two directions swapped. Lab use
 * only: the proxy knows the password because it is the lab's.
 */
import { randomBytes } from "node:crypto";
import {
	bigIntToBytesBE,
	bigIntToBytesMinimal,
	bytesToBigIntBE,
	decodePoint,
	encodePoint,
	G,
	pointAdd,
	redp1,
	scalarMul,
	sha256,
	srpId,
} from "../../2026-10-chr-extraction/ws3c/ec-srp5.ts";
import {
	deriveClientKeys,
	type SessionKeys,
} from "../../2026-10-chr-extraction/ws3c/session-crypto.ts";

const P = (1n << 255n) - 19n;
const N = BigInt(
	"0x1000000000000000000000000000000014def9dea2f79cd65812631a5cf5d3ed",
);
const W2M = BigInt(
	"0x555555555555555555555555555555555555555555555555555555555552db9c",
);
const mod = (a: bigint, m: bigint) => ((a % m) + m) % m;

export interface ServerHello {
	salt: Uint8Array;
	/** 33-byte blinded server public key, sent before the salt. */
	publicKey: Uint8Array;
	/** Phase-1 reply payload: publicKey ‖ salt (49 bytes). */
	reply: Uint8Array;
	v: bigint;
	privateKey: bigint;
	padded32: boolean;
}

/** Phase 1: fresh salt and ephemeral key for this login. */
export function serverHello(
	user: string,
	pass: string,
	padded32 = false,
	salt: Uint8Array = new Uint8Array(randomBytes(16)),
	privateKey: bigint = bytesToBigIntBE(new Uint8Array(randomBytes(32))),
): ServerHello {
	const v = bytesToBigIntBE(srpId(user, pass, salt));
	const V = scalarMul(v, G);
	if (V === null) throw new Error("srp-server: validator hit infinity");
	const xGamma = bigIntToBytesBE(mod(V.x + W2M, P), 32);
	const gamma = redp1(xGamma, 0, padded32).point;
	const pub = pointAdd(scalarMul(privateKey, G), gamma);
	if (pub === null) throw new Error("srp-server: public key hit infinity");
	const publicKey = encodePoint(pub);
	const reply = new Uint8Array(49);
	reply.set(publicKey, 0);
	reply.set(salt, 33);
	return { salt, publicKey, reply, v, privateKey, padded32 };
}

export interface ServerFinish {
	ok: boolean;
	/** Phase-2 reply payload (32 bytes); only meaningful when ok. */
	serverConfirm: Uint8Array;
	/** Server-role keys: send = client's receive, receive = client's send. */
	keys: SessionKeys;
}

/** Phase 2: check the client's confirmation and derive server-role keys. */
export function serverFinish(
	hello: ServerHello,
	clientKey: Uint8Array,
	clientConfirm: Uint8Array,
): ServerFinish {
	const V = scalarMul(hello.v, G);
	const j = sha256(clientKey.subarray(0, 32), hello.publicKey.subarray(0, 32));
	const q = pointAdd(
		decodePoint(clientKey),
		scalarMul(mod(bytesToBigIntBE(j), N), V),
	);
	const Z = scalarMul(hello.privateKey, q);
	if (Z === null) throw new Error("srp-server: shared point is infinity");
	const zv = mod(Z.x + W2M, P);
	const z = hello.padded32 ? bigIntToBytesBE(zv, 32) : bigIntToBytesMinimal(zv);
	const cc = sha256(j, z);
	const ok =
		cc.length === clientConfirm.length &&
		cc.every((b, i) => b === clientConfirm[i]);
	const c = deriveClientKeys(sha256(z));
	return {
		ok,
		serverConfirm: sha256(j, cc, z),
		keys: {
			sendAes: c.receiveAes,
			sendHmac: c.receiveHmac,
			receiveAes: c.sendAes,
			receiveHmac: c.sendHmac,
		},
	};
}
