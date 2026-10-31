# WS-1B/WS-3 working notes — server-side crypto grounding (6.49.23 + 7.25)

First-party grounding for `ec-srp5-handshake.yaml` + `session-crypto.yaml`
from `lib/libucrypto.so` + the `user`/`mproxy` binaries that call it.
Method: `nm -D` + `objdump -d` + `.rodata` bytes (dynsym is intact on
both versions, so no engine needed). Regenerable dumps:
`/tmp/ucrypto-v{6,7}.asm`, `/tmp/mproxy-v{6,7}.asm`,
`/tmp/user-v{6,7}.asm`; slicer `/tmp/ucut.ts`.
Cross-checked against `tikoci/centrs` `src/protocols/ec-srp5.ts`
(a BigInt port of `mtwei.c` that logs into real CHR): every formula
below matches it except two minimal-length edges (§7).

## 1. Architecture: who does what

| binary | role | imports (both versions unless noted) |
|---|---|---|
| `user` (0x0d) | SRP **server**: password check, salt+server key, session keys | `makeChallenge`, `makeSessionKey`, `pwdHash`, `pwdVerifier`, `redp1`, `Curve25519::{ctor,fromBin,toBin,map,getX,isValid}`, `WCurve::{mul,add}` |
| `mproxy` (0x02) | SRP **client** (outgoing proxied sessions) + session channel | `ECSRP::{ctor,getChallenge,generateResponse,verifyReply}`, `makeSessionKey`, `HKPDF`, `CBC_MAC_Cipher` (v6) / `createCipher`+`createHMAC` (v7) |
| `btest`, `mactel` | SRP clients (bandwidth test, outgoing MAC-Telnet) | `ECSRP::{ctor,getChallenge,generateResponse[,verifyReply]}` |
| `figman` (v7) | SRP client + KDF | `ECSRP::*`, `HKPDF`, `WCurve::*` |
| `cloud` (v7) | custom ECDH (cloud relay) | `HKPDF_Expand`, raw `WCurve::*` |

`libucrypto.so` exports the full `ECSRP` class, `redp1`,
`Curve25519`/`WCurve`/`MontgomeryReducer`, `HKPDF[+_Expand]` (v7 only
for the split form), `CBC_MAC_Cipher` (v6) /
`CBC_MAC_MP_Cipher` (v7), `makeSessionKey`, `makeChallenge`,
`pwdHash`, `pwdVerifier`. v7 adds ML-KEM, AEAD, kernel-crypto
(AF_ALG) and `Curve25519::getMod`; the WinBox suite is unchanged (§6).

## 2. Handshake: schema claims vs first-party code (v6 addrs)

- Point encoding `toBin` (`0xd244`) = 32B big-endian X left-padded
  with zeros + 1 parity byte (`y & 1`, literal 0/1 — `getY`,
  `0xf060`, negates `y` on mismatch). `fromBin` (`0xf3f0`)
  requires exactly `0x21` bytes. Wire X is **Montgomery** X:
  `map(Point&&)` (`0xd188`) converts via `map_to_25519`.
- `i = SHA-256(salt || SHA-256(user || ':' || pass))`: `pwdHash`
  (`0x10c3f`) does exactly this, `':'` = byte `0x3a` at `0x1ed68`.
  The server recomputes `i` per login from the stored password
  (`user` calls `pwdHash` at `0x804f78e`), so the salt is fresh
  randomness, not a database lookup.
- `xGamma` = `getX(pwdVerifier(i))`; `pwdVerifier` (`0x110c0`) =
  `toBin(i*G)` with `G = map(9, parity 0)` (Montgomery base).
- `v`: `redp1` (`0x10ef6`) = `x = SHA-256(seed)`; loop
  `h = SHA-256(bin(x))`, `P = map(BigNum(h), parity 0)`,
  return on `isValid`, else `x += 1`. The **client** negates this
  point (static helper `0x11a1c`, `BigNum::operator-=`), which
  flips parity 0→1, then `w = serverPoint + (-v)`. So the
  schema's "`v` parity 1, `wB = serverPoint + v`" and the
  binary's "redp1 parity 0, subtract" are the same math; the
  server blinds with `wB_sent = sB*G + redp1(0)` (`user`
  `0x80541b9` cluster). Oracle agrees on both parities.
- `j = SHA-256(clientX || serverX)` **on both sides**: client
  hashes own-first (`generateSRPResponse`, `0x11372`); server
  hashes peer-first (`user` `0x804f0f3`, client key is the
  validated one). The schema's "independent of role order" is
  wrong; it is always client-first.
- `u = (i*j + sA) mod order` (`mul`, `operator+=`,
  `div`-remainder), `Z = u*w`, `z` = minimal-length big-endian
  `MontX(Z)` (helper `0x11942`: `map` → `bin()`, **no** 32B
  padding — see §7), `secret = SHA-256(z)` stored at
  `ECSRP+0x20`.
- `clientConfirm = SHA-256(j || z)`,
  `serverConfirm = SHA-256(j || clientConfirm || z)`, stored at
  `ECSRP+0x1c`; `verifyReply` (`0x10bd0`) `memcmp`s the peer
  reply. `generateResponse` (`0x118aa`) dispatches on length:
  33B → MSCHAP, 49B → SRP (33B pubkey + 16B salt split).
- `getChallenge` (`0x10b8a`) = `username || 0x00 || pubkey33`.
- Curve constants byte-exact vs the oracle: prime `2^255-19` at
  `0x209c8`, Weierstrass `a` at `0x1e5f0`, order at `0x1e574`,
  `A = 486662` (`0x76d06`) immediate in `getY`/ctor.
- No scalar clamping in the `ECSRP` ctor path (`sA =
  BigNum(vec)` verbatim); the oracle clamps, RouterOS does not
  (harmless for interop — any 32B scalar works).

## 3. Session crypto: exact preimage, KDF, and wiring

`makeSessionKey(secret, b1, b2)` (`0x1054f`):
`SHA-1(secret || zeros(40) || MAGIC || fill(40, 0xF2))`,
truncated to 16B. Equal bools → RECEIVE magic (`0x20a40`),
differing → SEND magic (`0x209e8`); both 84B, byte-identical on
v7. Client (mproxy) calls `(1,0)` for tx then `(0,0)` for rx;
server (user) calls `(1,1)` then `(1,0)` — the schema's role-swap
note is exactly right.

`HKPDF(hash, salt, info, ikm, len)` (`0x12964`) = RFC 5869
Extract+Expand over HMAC: `PRK = HMAC(salt, ikm)`,
`T(i) = HMAC(PRK, T(i-1) || info || i)`. mproxy calls it with
salt = info = empty vecs, `len = 0x24` (empty HMAC key ≡ 64
zero bytes, matching the schema), then splits `aes = [0:16]`,
`hmac = [16:36]`.

Wiring (v6 mproxy `0x80558bb`, proved by `R_386_COPY` relocs, not
by guessing): `AES128::AES128(aes16)` + `HMAC(SHA1, hmac20)`
over an inline static SHA1 (COPY of `vtable for SHA1` at
`0x8058678`; mproxy hand-installs the vtable + zeroed counters,
which works because `update()` re-runs `init()` when the byte
count is zero — §5). So: **AES-128-CBC + HMAC-SHA1**, keys as
the schema says, secret (`ECSRP+0x20`) → `makeSessionKey` chain
closed in mproxy `0x80521bb`.

`CBC_MAC_Cipher::encrypt` (`0x12468`): `MAC = H(input)` over the
message alone, append MAC, append `pad = 16 - ((len+mac) mod
16)` bytes of value `pad-1`, CBC-encrypt (head blocks direct,
tail assembled on the stack). `decrypt` (`0x125be`) returns -1
unless: block-aligned, `memcmp` MAC valid (**non-constant-time
but enforced** — contradicts the schema's client-side note),
pad length sane, and **every** pad byte equals the pad value.

## 4. `makeChallenge` is MSCHAP, not EC-SRP

`makeChallenge(str, vec, flag)` (`0x10a4e`) shares the
`SHA-1(x || zeros(40) || MAGIC || F2(40))[0:16]` shape with
26/28B magics `"This is for peer challenge"` (flag true,
`0x20b28`) and `"This is for auther challenge"` (sic, flag
false, `0x20b08`). Peer/authenticator 16B challenges are
MSCHAP version 2 vocabulary (cf. `"Magic server to client signing
constant"` at `0x20ac4`); the EC-SRP server flow needs no
derived challenge (salt/ephemeral are random). No EC-SRP caller
of `makeChallenge` was found.

## 5. Hash reuse is safe: `update()` re-inits after `digest()`

`HashImpl::finish` (`0x72a8`) zeroes only the byte counters, but
`HashImpl::update` (`0x7120`) calls `vtable[0x1c]` (= `init()`)
whenever the count is zero — so every `digest()` effectively
resets the context. All multi-digest readings above (pwdHash
nesting, redp1 loop, j/secret/confirms on one object) are fresh
SHA-256s, as the schema states.

## 6. v7 deltas: same suite, new plumbing

- Same wire behavior: magics, preimage shape, `HKPDF(36)`,
  16/20 split, AES-128-CBC (`createCipher` id 4 →
  jump-table-verified CBC-16 case), HMAC-SHA1 (`HashID` 4 =
  SHA1 — the v7 enum **shifted +1**: 3=MD5, 4=SHA1, 5=SHA256,
  6=SHA384, 7=SHA512), same client `(1,0)/(0,0)` and server
  `(1,1)/(1,0)` bools, same SRP math (redp1 parity 0,
  same-shape negated add, same server formulas).
- Structural: `HKPDF_Expand` split out (used by v7 `cloud`);
  `CBC_MAC_MP_Cipher` replaces `CBC_MAC_Cipher` (same length
  formula, same pad fill, verifying decrypt); `KernelAlg`
  (AF_ALG) + `DES`/`CBCCipher`/`CFB128Cipher` factories behind
  `createCipher`; ML-KEM-768, AEAD, `Curve25519::getMod` added.
- `HashID` shift is internal-only (v6 mproxy bypassed the enum
  via COPY-relocated vtables); no wire drift.

## 7. WS-4 corrections + WS-3C recipe

Corrections queued for the schema drain: (a) `j` is always
client-X-first, not role-order-independent; (b) the server
**does** enforce MAC + full pad (scope the non-enforcement
note to the private client impl); (c) `redp1` iterates on
**minimal-length** `bin()` preimages and `z` is minimal-length
too — padded-32 implementations (incl. the centrs port)
diverge when either value has leading zero bytes (~1/256
each; rare, untested live); (d) `makeChallenge` is
MSCHAP version 2, not EC-SRP; (e) RouterOS does not clamp the
ephemeral scalar.

Post-WS-4 close-out of (c) for the centrs upstream issue
(2026-10-31): the `redp1` INPUT seed is fixed-32B on both
versions and both roles — `redp1` hashes its input vector
as-passed (`0x10ef6`), and both callers pass `getX()` output
(client `generateSRPResponse` `0x114c4`, server `user`
`0x80541cd`), where `getX` (v6 `0xcd78`, v7 `0x18bf0`) drops
exactly the last (parity) byte of the 33B wire form. So the
centrs fix is exactly TWO sites (loop preimage + `z`); its
32B `xGamma` input padding is correct as-is. Deterministic
regression vector (offline-mined, z edge, centrs cross-checked):
[`srp5-minimal-vector.json`](./srp5-minimal-vector.json) via
`/tmp/srp5vec.ts` (seed index 88, fixed v6 sweep salt).

WS-3C prober: reuse `tikoci/centrs` `ec-srp5.ts` for the
client math (constants + formulas verified above), with the
(c) caveat; wire shapes are `getChallenge` (phase 1),
49B server reply, 32B proof; keys via §3 with SEND-magic tx.
`user`'s exact salt RNG was not traced (imports `rand`/
`srand`; schema keeps salt opaque).
