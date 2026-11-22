// cspell:ignore quickchr lhost lport
/**
 * Plan step 5: a decrypting WinBox proxy for a lab CHR. WinBox logs in to
 * the proxy (server-side EC-SRP5 with the lab password, srp-server.ts);
 * the proxy logs in to the router with the same user and relays every M2
 * message, decrypted, logged and encrypted again for the other side.
 *
 *   bun proxy.ts --quickchr twin3 --listen 127.0.0.1:18291 --out <dir>
 *
 * Then point WinBox at 127.0.0.1:18291. Output: <dir>/capture.jsonl with
 * one line per message ({conn, seq, dir, tMs, wallMs, tag, hex}; c2s is
 * WinBox -> router) and connection events. The plaintext holds no
 * credentials: SRP runs before logging starts and only the user name is
 * recorded. Marks come from drive.ts into <dir>/marks.jsonl. Lab use only;
 * never runs in CI.
 */
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { join } from "node:path";
import {
	ChunkConn,
	frameMessage,
} from "../../2026-10-chr-extraction/ws3c/chunk.ts";
import {
	clientShared,
	keygen,
	srpId,
} from "../../2026-10-chr-extraction/ws3c/ec-srp5.ts";
import {
	decryptEnvelope,
	deriveClientKeys,
	encryptEnvelope,
	type SessionKeys,
} from "../../2026-10-chr-extraction/ws3c/session-crypto.ts";
import { resolveLabTarget } from "../../2026-11-winbox-attributes/harness/target.ts";
import { serverFinish, serverHello } from "./srp-server.ts";

function usage(): never {
	console.error(
		"usage: proxy.ts --quickchr <name> --listen <host:port> --out <dir> [--padded32]",
	);
	process.exit(2);
}
const argv = process.argv.slice(2);
let machine = "";
let listen = "127.0.0.1:18291";
let outDir = "";
let padded32 = false;
for (let i = 0; i < argv.length; i++) {
	const t = argv[i];
	if (t === "--quickchr") machine = argv[++i] ?? "";
	else if (t === "--listen") listen = argv[++i] ?? "";
	else if (t === "--out") outDir = argv[++i] ?? "";
	else if (t === "--padded32") padded32 = true;
	else usage();
}
if (!machine || !outDir) usage();
const [lhost, lport] = listen.split(":");
mkdirSync(outDir, { recursive: true });
const capPath = join(outDir, "capture.jsonl");
if (existsSync(capPath)) throw new Error(`refusing to overwrite ${capPath}`);

const target = resolveLabTarget(machine, {
	allowedVersions: ["7.25", "7.26beta4"],
});
const t0 = performance.now();
const stamp = () => ({
	tMs: Math.round((performance.now() - t0) * 10) / 10,
	wallMs: Date.now(),
});
const write = (o: object) =>
	appendFileSync(capPath, `${JSON.stringify({ ...o, ...stamp() })}\n`);
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
write({
	event: "proxy-start",
	machine,
	routeros_version: target.version,
	upstream: `${target.host}:${target.port}`,
	listen,
});
console.log(
	`proxy: ${listen} -> ${machine} (${target.version}) ${target.host}:${target.port}; capture ${capPath}`,
);

/** Client-side login to the router, stopping after phase 2 (no adoption). */
async function upstreamLogin(): Promise<{
	conn: ChunkConn;
	keys: SessionKeys;
}> {
	const conn = await ChunkConn.open(target.host, target.port, 3_600_000);
	const kp = keygen();
	const user = new TextEncoder().encode(target.user);
	const p1 = new Uint8Array([...user, 0, ...kp.publicKey]);
	await conn.write(frameMessage(0x06, p1));
	const r1 = await conn.readMessage();
	if (r1.tag !== 0x06 || r1.payload.length !== 49)
		throw new Error(`upstream phase 1: tag ${r1.tag} len ${r1.payload.length}`);
	const { shared } = clientShared(
		kp.privateKey,
		r1.payload.subarray(0, 33),
		kp.publicKey,
		srpId(target.user, target.pass, r1.payload.subarray(33, 49)),
		false,
	);
	await conn.write(frameMessage(0x06, shared.clientConfirm));
	const r2 = await conn.readMessage();
	if (!Buffer.from(r2.payload).equals(Buffer.from(shared.serverConfirm)))
		throw new Error("upstream phase 2: server confirmation mismatch");
	return { conn, keys: deriveClientKeys(shared.secret) };
}

let connCount = 0;
async function handle(sock: Socket): Promise<void> {
	const conn = ++connCount;
	const down = ChunkConn.fromSocket(sock);
	sock.setNoDelay(true);
	write({
		event: "accept",
		conn,
		peer: `${sock.remoteAddress}:${sock.remotePort}`,
	});
	let up: ChunkConn | null = null;
	try {
		// Phase 1 from WinBox: [user]\0[pubkey:33], optionally behind an
		// inner 0x06 byte (ws3c probe --inner-tag); mirror whatever it used.
		const m1 = await down.readMessage();
		let p = m1.payload;
		// A user name never starts with 0x06, so a leading 0x06 is the inner tag.
		const inner = p[0] === 0x06 ? 1 : 0;
		if (inner) p = p.subarray(1);
		const nul = p.indexOf(0);
		if (m1.tag !== 0x06 || nul < 0 || p.length !== nul + 34) {
			write({
				event: "unexpected-phase1",
				conn,
				tag: m1.tag,
				hex: hex(m1.payload),
			});
			throw new Error(`conn ${conn}: unexpected first message tag ${m1.tag}`);
		}
		const user = new TextDecoder().decode(p.subarray(0, nul));
		const clientKey = p.subarray(nul + 1);
		write({ event: "phase1", conn, user, innerTag: inner === 1 });
		if (user !== target.user)
			throw new Error(`conn ${conn}: WinBox user ${user} is not the lab user`);

		const u = await upstreamLogin();
		up = u.conn;
		const hello = serverHello(user, target.pass, padded32);
		const pre = inner ? [0x06] : [];
		await down.write(
			frameMessage(0x06, new Uint8Array([...pre, ...hello.reply])),
		);
		const m2 = await down.readMessage();
		const fin = serverFinish(hello, clientKey, m2.payload.subarray(inner));
		write({ event: "phase2", conn, ok: fin.ok });
		if (!fin.ok) throw new Error(`conn ${conn}: WinBox confirmation mismatch`);
		await down.write(
			frameMessage(0x06, new Uint8Array([...pre, ...fin.serverConfirm])),
		);
		console.log(`proxy: conn ${conn} logged in as ${user}`);

		let seq = 0;
		const relay = async (
			from: ChunkConn,
			to: ChunkConn,
			dir: "c2s" | "s2c",
			rx: [Uint8Array, Uint8Array],
			tx: [Uint8Array, Uint8Array],
		) => {
			for (;;) {
				const m = await from.readMessage();
				if (m.tag !== 0x06) {
					write({
						conn,
						seq: ++seq,
						dir,
						tag: m.tag,
						raw: true,
						hex: hex(m.payload),
					});
					await to.write(frameMessage(m.tag, m.payload));
					continue;
				}
				const plain = decryptEnvelope(rx[0], rx[1], m.payload);
				write({ conn, seq: ++seq, dir, tag: 6, hex: hex(plain) });
				await to.write(
					frameMessage(0x06, encryptEnvelope(tx[0], tx[1], plain)),
				);
			}
		};
		const upc = up;
		await Promise.race([
			relay(
				down,
				upc,
				"c2s",
				[fin.keys.receiveAes, fin.keys.receiveHmac],
				[u.keys.sendAes, u.keys.sendHmac],
			),
			relay(
				upc,
				down,
				"s2c",
				[u.keys.receiveAes, u.keys.receiveHmac],
				[fin.keys.sendAes, fin.keys.sendHmac],
			),
		]);
	} catch (e) {
		const msg = (e as Error).message;
		write({ event: "close", conn, reason: msg });
		console.log(`proxy: conn ${conn} closed: ${msg}`);
	} finally {
		down.close();
		up?.close();
	}
}

const server = createServer((s) => void handle(s));
server.listen(Number(lport), lhost);
const stop = () => {
	write({ event: "proxy-stop" });
	server.close();
	process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
