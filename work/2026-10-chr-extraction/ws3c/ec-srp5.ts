// WS-3C: EC-SRP5 client math for the WinBox wire prober.
//
// Curve constants + field/point math follow tikoci/centrs
// `src/protocols/ec-srp5.ts` (itself a BigInt port of haakonnessjoen
// `mtwei.c`), cross-checked against MarginResearch
// `mikrotik_authentication/src/elliptic_curves.py` — all three agree,
// and the constants are verified byte-for-byte against libucrypto.so
// .rodata (see ../ucrypto-grounding.md §2).
//
// Byte encodings follow libucrypto.so instead: minimal-length BigNum
// bin(), NOT padded-32 (grounding §7c). Pass padded32=true to select
// the MarginResearch/centrs padded behavior for A/B testing.
import { createHash, randomBytes } from "node:crypto";

/** Client/server public key length: 32-byte Montgomery X + 1 parity byte. */
export const PUBKEY_LEN = 33;
/** Authentication proof / confirmation length. */
export const PROOF_LEN = 32;

// ── Curve constants (Curve25519 in short-Weierstrass form) ───────────────
/** Field prime: 2^255 − 19. */
const P = BigInt(
	"0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffed",
);
/** Short-Weierstrass coefficient a. */
const A = BigInt(
	"0x2aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa984914a144",
);
/** Short-Weierstrass coefficient b. */
const B = BigInt(
	"0x7b425ed097b425ed097b425ed097b425ed097b425ed097b4260b5e9c7710c864",
);
/** Group order. */
const N = BigInt(
	"0x1000000000000000000000000000000014def9dea2f79cd65812631a5cf5d3ed",
);
/** Generator X (Weierstrass affine). */
const GX = BigInt(
	"0x2aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaad245a",
);
/** Generator Y (Weierstrass affine). */
const GY = BigInt(
	"0x5f51e65e475f794b1fe122d388b72eb36dc2b28192839e4dd6163a5d81312c14",
);
/** Weierstrass-X → Montgomery-X additive conversion. */
const W2M = BigInt(
	"0x555555555555555555555555555555555555555555555555555555555552db9c",
);
/** Montgomery-X → Weierstrass-X additive conversion. */
const M2W = BigInt(
	"0x2aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaad2451",
);
/** sqrt(−1) mod P, for the p ≡ 5 (mod 8) square-root path. */
const SQRT_M1 = modPow(2n, (P - 1n) / 4n, P);

/** An affine point, or null for the point at infinity. */
export type Point = { x: bigint; y: bigint } | null;

export const G: Point = { x: GX, y: GY };

// ── Field arithmetic (mod P) ────────────────────────────────────────────

function mod(value: bigint, m: bigint): bigint {
	const r = value % m;
	return r < 0n ? r + m : r;
}

function modPow(base: bigint, exp: bigint, m: bigint): bigint {
	let result = 1n;
	let b = mod(base, m);
	let e = exp;
	while (e > 0n) {
		if (e & 1n) result = (result * b) % m;
		b = (b * b) % m;
		e >>= 1n;
	}
	return result;
}

/** Modular inverse via Fermat's little theorem (P is prime). */
function modInv(value: bigint): bigint {
	return modPow(value, P - 2n, P);
}

/**
 * Square root mod P. P ≡ 5 (mod 8), so a candidate is `a^((P+3)/8)`,
 * adjusted by sqrt(−1) when needed. Returns null for non-residues.
 */
function modSqrt(a: bigint): bigint | null {
	const aa = mod(a, P);
	if (aa === 0n) return 0n;
	let x = modPow(aa, (P + 3n) / 8n, P);
	if ((x * x) % P === aa) return x;
	x = mod(x * SQRT_M1, P);
	if ((x * x) % P === aa) return x;
	return null;
}

// ── Byte/BigInt helpers (big-endian) ─────────────────────────────────────

export function bytesToBigIntBE(bytes: Uint8Array): bigint {
	let value = 0n;
	for (const byte of bytes) value = (value << 8n) | BigInt(byte);
	return value;
}

export function bigIntToBytesBE(value: bigint, length: number): Uint8Array {
	const out = new Uint8Array(length);
	let v = value;
	for (let i = length - 1; i >= 0; i -= 1) {
		out[i] = Number(v & 0xffn);
		v >>= 8n;
	}
	return out;
}

/**
 * Minimal-length big-endian encoding (libucrypto `BigNum::bin()`).
 * Strips all leading zero bytes but keeps at least one byte, so 0n
 * encodes as a single 0x00 rather than an empty preimage (the exact
 * zero behavior of libucrypto is unknown; 0n occurs with probability
 * 2^-256, so this never matters live — it only avoids a degenerate
 * empty hash input).
 */
export function bigIntToBytesMinimal(value: bigint): Uint8Array {
	if (value === 0n) return new Uint8Array([0]);
	const full = bigIntToBytesBE(value, 32);
	let start = 0;
	while (start < 31 && full[start] === 0) start++;
	return full.subarray(start);
}

function encodeScalar(value: bigint, padded32: boolean): Uint8Array {
	return padded32 ? bigIntToBytesBE(value, 32) : bigIntToBytesMinimal(value);
}

export function sha256(...chunks: readonly Uint8Array[]): Uint8Array {
	const hash = createHash("sha256");
	for (const chunk of chunks) hash.update(chunk);
	return new Uint8Array(hash.digest());
}

export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
	const total = parts.reduce((sum, part) => sum + part.length, 0);
	const out = new Uint8Array(total);
	let cursor = 0;
	for (const part of parts) {
		out.set(part, cursor);
		cursor += part.length;
	}
	return out;
}

// ── Point arithmetic (y² = x³ + A·x + B mod P) ───────────────────────────

export function pointAdd(p: Point, q: Point): Point {
	if (p === null) return q;
	if (q === null) return p;
	if (p.x === q.x) {
		if (mod(p.y + q.y, P) === 0n) return null; // p + (−p) = ∞
		return pointDouble(p);
	}
	const slope = mod((q.y - p.y) * modInv(mod(q.x - p.x, P)), P);
	const x = mod(slope * slope - p.x - q.x, P);
	const y = mod(slope * (p.x - x) - p.y, P);
	return { x, y };
}

export function pointDouble(p: Point): Point {
	if (p === null) return null;
	if (p.y === 0n) return null;
	const slope = mod((3n * p.x * p.x + A) * modInv(mod(2n * p.y, P)), P);
	const x = mod(slope * slope - 2n * p.x, P);
	const y = mod(slope * (p.x - x) - p.y, P);
	return { x, y };
}

export function scalarMul(scalar: bigint, point: Point): Point {
	let result: Point = null;
	let addend = point;
	let k = scalar;
	while (k > 0n) {
		if (k & 1n) result = pointAdd(result, addend);
		addend = pointDouble(addend);
		k >>= 1n;
	}
	return result;
}

/**
 * Recover the point with the given Weierstrass X and Y parity (low bit of
 * Y), or null if X is not on the curve.
 */
export function liftX(xWeier: bigint, parity: number): Point {
	const x = mod(xWeier, P);
	const rhs = mod(x * x * x + A * x + B, P);
	const y0 = modSqrt(rhs);
	if (y0 === null) return null;
	const y = Number(y0 & 1n) === (parity & 1) ? y0 : mod(-y0, P);
	return { x, y };
}

// ── Point encoding: 32-byte big-endian Montgomery X + 1 parity byte ─────

export function encodePoint(point: Point): Uint8Array {
	if (point === null) throw new Error("ec-srp5: cannot encode infinity");
	const out = new Uint8Array(PUBKEY_LEN);
	out.set(bigIntToBytesBE(mod(point.x + W2M, P), 32), 0);
	out[32] = Number(point.y & 1n);
	return out;
}

export function decodePoint(key: Uint8Array): Point {
	if (key.length !== PUBKEY_LEN) {
		throw new Error(`ec-srp5: pubkey must be ${PUBKEY_LEN} bytes`);
	}
	const parity = key[32] ?? 0;
	const xWeier = mod(bytesToBigIntBE(key.subarray(0, 32)) + M2W, P);
	const point = liftX(xWeier, parity);
	if (point === null) throw new Error("ec-srp5: pubkey X not on curve");
	return point;
}

// ── EC-SRP5 client ──────────────────────────────────────────────────────

export interface Keypair {
	privateKey: bigint;
	publicKey: Uint8Array;
}

/**
 * Generate a keypair from a fresh random 32-byte scalar, used verbatim
 * with NO clamping — matching RouterOS (grounding §2: `sA =
 * BigNum(vec)` verbatim) and MarginResearch. (centrs clamps; harmless
 * either way since any 32-byte scalar works.)
 */
export function keygen(): Keypair {
	const priv = new Uint8Array(randomBytes(32));
	const privateKey = bytesToBigIntBE(priv);
	const pub = scalarMul(privateKey, G);
	if (pub === null) throw new Error("ec-srp5: keygen hit infinity");
	return { privateKey, publicKey: encodePoint(pub) };
}

/** `SHA-256(salt ‖ SHA-256(username ‖ ':' ‖ password))`. */
export function srpId(
	username: string,
	password: string,
	salt: Uint8Array,
): Uint8Array {
	const inner = sha256(new TextEncoder().encode(`${username}:${password}`));
	return sha256(salt, inner);
}

/**
 * REDP1: deterministically derive a curve point from a 32-byte
 * Montgomery-X seed, incrementing until X lands on the curve. The
 * hashed preimage is minimal-length `bin()` per libucrypto, or
 * padded-32 per MarginResearch/centrs when padded32=true.
 */
export function redp1(
	montgomeryX: Uint8Array,
	parity: number,
	padded32: boolean,
): { point: Point; iters: number } {
	let seed = bytesToBigIntBE(sha256(montgomeryX));
	for (let iters = 1; ; iters++) {
		const candidate = sha256(encodeScalar(seed, padded32));
		const xWeier = mod(bytesToBigIntBE(candidate) + M2W, P);
		const point = liftX(xWeier, parity);
		if (point !== null) return { point, iters };
		seed = mod(seed + 1n, 1n << 256n);
	}
}

export interface Shared {
	j: Uint8Array;
	z: Uint8Array;
	secret: Uint8Array;
	clientConfirm: Uint8Array;
	serverConfirm: Uint8Array;
}

export interface SharedDiag {
	/** REDP1 loop iterations under the selected encoding. */
	redp1Iters: number;
	/** REDP1 loop iterations under the other encoding. */
	redp1ItersOther: number;
	/** Encoded z length (32 unless minimal-length hit leading zeros). */
	zLen: number;
	/** Leading zero bytes of the Montgomery X of Z. */
	zLeadingZeros: number;
	/**
	 * True when padded-32 and minimal-length agree on this instance
	 * (same REDP1 point AND same z bytes). A successful login on a
	 * disagreeing instance proves the selected encoding.
	 */
	encodingsAgree: boolean;
}

/**
 * Client shared secret (ECPESVDP-SRP-A):
 *   v      = REDP1(MontX(i·G), parity 1) — undoes the server's blind
 *   wB     = serverPoint + v             — = serverEphemeral·G
 *   j      = SHA-256(clientMontX ‖ serverMontX), always client-X-first
 *   scalar = (i·j + sA) mod N
 *   Z      = scalar·wB; z = MontX(Z); secret = SHA-256(z)
 */
export function clientShared(
	privateKey: bigint,
	serverKey: Uint8Array,
	clientKey: Uint8Array,
	validator: Uint8Array,
	padded32: boolean,
): { shared: Shared; diag: SharedDiag } {
	const serverPoint = decodePoint(serverKey);
	const v = bytesToBigIntBE(validator);

	const vG = scalarMul(v, G);
	if (vG === null) throw new Error("ec-srp5: validator hit infinity");
	const xGamma = bigIntToBytesBE(mod(vG.x + W2M, P), 32);
	const { point: gamma, iters } = redp1(xGamma, 1, padded32);
	// Discriminator for the padded-vs-minimal question (grounding §7c):
	// also derive REDP1 under the other encoding and compare points.
	const other = redp1(xGamma, 1, !padded32);
	const wB = pointAdd(serverPoint, gamma);

	const j = sha256(clientKey.subarray(0, 32), serverKey.subarray(0, 32));
	const scalar = mod(v * bytesToBigIntBE(j) + privateKey, N);
	const pt = scalarMul(scalar, wB);
	if (pt === null) throw new Error("ec-srp5: shared point is infinity");
	const montZ = mod(pt.x + W2M, P);
	const z = encodeScalar(montZ, padded32);
	const secret = sha256(z);
	const clientConfirm = sha256(j, z);
	const serverConfirm = sha256(j, clientConfirm, z);

	const zFull = bigIntToBytesBE(montZ, 32);
	const zLeading = leadingZeros(zFull);
	const samePoint =
		gamma !== null &&
		other.point !== null &&
		gamma.x === other.point.x &&
		gamma.y === other.point.y;
	return {
		shared: { j, z, secret, clientConfirm, serverConfirm },
		diag: {
			redp1Iters: iters,
			redp1ItersOther: other.iters,
			zLen: z.length,
			zLeadingZeros: zLeading,
			encodingsAgree: samePoint && zLeading === 0,
		},
	};
}

function leadingZeros(bytes: Uint8Array): number {
	let n = 0;
	for (const b of bytes) {
		if (b !== 0) break;
		n++;
	}
	return n;
}
