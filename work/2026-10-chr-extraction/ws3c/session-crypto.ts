// WS-3C: post-handshake session crypto for the WinBox wire prober.
// See profiles/winbox-ipc/session-crypto.yaml + transport.yaml hkdf-info,
// grounded against libucrypto `makeSessionKey`/`HKPDF`/`CBC_MAC_Cipher`
// (../ucrypto-grounding.md §3) and MarginResearch `encryption.py`.
import {
	createCipheriv,
	createDecipheriv,
	createHash,
	createHmac,
	randomBytes,
	timingSafeEqual,
} from "node:crypto";

export const SEND_MAGIC =
	"On the client side, this is the send key; on the server side, it is the receive key.";
export const RECEIVE_MAGIC =
	"On the client side, this is the receive key; on the server side, it is the send key.";

const ZERO40 = new Uint8Array(40);
const FILL40 = new Uint8Array(40).fill(0xf2);

export interface SessionKeys {
	sendAes: Uint8Array;
	receiveAes: Uint8Array;
	sendHmac: Uint8Array;
	receiveHmac: Uint8Array;
}

function sha1(...chunks: Uint8Array[]): Uint8Array {
	const h = createHash("sha1");
	for (const c of chunks) h.update(c);
	return new Uint8Array(h.digest());
}

function hmacSha1(key: Uint8Array, ...chunks: Uint8Array[]): Uint8Array {
	const h = createHmac("sha1", key);
	for (const c of chunks) h.update(c);
	return new Uint8Array(h.digest());
}

function hkdfExpand16(seed16: Uint8Array): Uint8Array {
	// HKDF-Extract with empty salt (empty key ≡ 64 zero bytes), then
	// HKDF-Expand with empty info to 36 bytes.
	const prk = hmacSha1(new Uint8Array(64), seed16);
	const t1 = hmacSha1(prk, new Uint8Array([1]));
	const t2 = hmacSha1(prk, t1, new Uint8Array([2]));
	return new Uint8Array([...t1, ...t2]).subarray(0, 36);
}

/**
 * Derive the four session keys from `secret = SHA-256(z)`. Client role:
 * SEND magic for tx, RECEIVE magic for rx (server swaps the two).
 */
export function deriveClientKeys(secret: Uint8Array): SessionKeys {
	const enc = new TextEncoder();
	const txSeed = sha1(secret, ZERO40, enc.encode(SEND_MAGIC), FILL40).subarray(
		0,
		16,
	);
	const rxSeed = sha1(
		secret,
		ZERO40,
		enc.encode(RECEIVE_MAGIC),
		FILL40,
	).subarray(0, 16);
	const tx = hkdfExpand16(txSeed);
	const rx = hkdfExpand16(rxSeed);
	return {
		sendAes: tx.subarray(0, 16),
		sendHmac: tx.subarray(16, 36),
		receiveAes: rx.subarray(0, 16),
		receiveHmac: rx.subarray(16, 36),
	};
}

/**
 * Encrypt one M2 message: MAC-then-pad-then-encrypt. Returns the
 * assembled [ciphertext-length:u2be][iv:16][ciphertext] envelope (transport.yaml
 * `encrypted_m2`), ready for chunk framing with tag 0x06.
 */
export function encryptEnvelope(
	sendAes: Uint8Array,
	sendHmac: Uint8Array,
	msg: Uint8Array,
	iv?: Uint8Array,
): Uint8Array {
	const useIv = iv ?? new Uint8Array(randomBytes(16));
	if (useIv.length !== 16) throw new Error("ws3c: IV must be 16 bytes");
	const mac = hmacSha1(sendHmac, msg);
	// Pad value == pad length - 1, repeated (padLen+1) times.
	const padLen = 15 - ((msg.length + mac.length) % 16);
	const padded = new Uint8Array(msg.length + 20 + padLen + 1);
	padded.set(msg, 0);
	padded.set(mac, msg.length);
	padded.fill(padLen, msg.length + 20);
	const cipher = createCipheriv("aes-128-cbc", sendAes, useIv);
	cipher.setAutoPadding(false);
	const ct = new Uint8Array(
		Buffer.concat([cipher.update(padded), cipher.final()]),
	);
	const out = new Uint8Array(2 + 16 + ct.length);
	out[0] = (ct.length >> 8) & 0xff;
	out[1] = ct.length & 0xff;
	out.set(useIv, 2);
	out.set(ct, 18);
	return out;
}

/**
 * Decrypt one assembled envelope. Verifies the length prefix, every
 * pad byte, and the MAC — any mismatch throws (explicit failure, no
 * silent fallback). Returns the M2 message bytes.
 */
export function decryptEnvelope(
	receiveAes: Uint8Array,
	receiveHmac: Uint8Array,
	envelope: Uint8Array,
): Uint8Array {
	if (envelope.length < 18) throw new Error("ws3c: envelope too short");
	const ctLen = ((envelope[0] ?? 0) << 8) | (envelope[1] ?? 0);
	const iv = envelope.subarray(2, 18);
	const ct = envelope.subarray(18);
	if (ct.length !== ctLen) {
		throw new Error(`ws3c: ct length prefix ${ctLen} != ${ct.length} actual`);
	}
	if (ct.length % 16 !== 0 || ct.length === 0) {
		throw new Error("ws3c: ciphertext not block-aligned");
	}
	const decipher = createDecipheriv("aes-128-cbc", receiveAes, iv);
	decipher.setAutoPadding(false);
	const pt = new Uint8Array(
		Buffer.concat([decipher.update(ct), decipher.final()]),
	);
	const padLen = pt[pt.length - 1] ?? 0;
	const padCount = padLen + 1;
	if (padCount > pt.length - 20) throw new Error("ws3c: pad length insane");
	for (let i = pt.length - padCount; i < pt.length; i++) {
		if (pt[i] !== padLen) throw new Error("ws3c: pad byte mismatch");
	}
	const macStart = pt.length - padCount - 20;
	const gotMac = pt.subarray(macStart, macStart + 20);
	const msg = pt.subarray(0, macStart);
	const wantMac = hmacSha1(receiveHmac, msg);
	if (!timingSafeEqual(gotMac, wantMac)) throw new Error("ws3c: MAC mismatch");
	return new Uint8Array(msg);
}
