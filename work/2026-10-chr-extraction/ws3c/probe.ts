// WS-3C: WinBox wire prober vs a quickchr CHR.
//
// Usage:
//   bun work/2026-10-chr-extraction/ws3c/probe.ts --quickchr twin3 auth
//   bun work/2026-10-chr-extraction/ws3c/probe.ts --quickchr twin3 adopt
//   bun work/2026-10-chr-extraction/ws3c/probe.ts --quickchr twin3 getone 24 2
//   bun work/2026-10-chr-extraction/ws3c/probe.ts --quickchr twin3 getall 20 0
//   bun work/2026-10-chr-extraction/ws3c/probe.ts --quickchr twin3 getobj 24 34 0
//   bun work/2026-10-chr-extraction/ws3c/probe.ts --quickchr twin3 getone 24 31 --xfield 16646156=268435456
//   bun work/2026-10-chr-extraction/ws3c/probe.ts --quickchr twin3 getone 13 6 --xstr 1=admin
//   bun work/2026-10-chr-extraction/ws3c/probe.ts --quickchr twin3 sweep
//   bun work/2026-10-chr-extraction/ws3c/probe.ts --quickchr twin3 redp1sweep 300
//
// Target: --quickchr NAME (ports/credentials via quickchr list+inspect) or
// --host/--port/--user/--pass explicitly. Passwords are used, never printed.
//
// Experiments:
//   --inner-tag  send handshake payloads with an inner 0x06 prefix byte
//                (tests the schema's "conventional, not validated" claim;
//                default MarginResearch framing has NO inner tag)
//   --padded32   padded-32 REDP1/z encodings (MarginResearch/centrs style)
//                instead of minimal-length libucrypto bin() (default)
import { ChunkConn, frameMessage } from "./chunk.ts";
import { clientShared, keygen, type SharedDiag, srpId } from "./ec-srp5.ts";
import {
	decodeM2,
	type EncEntry,
	encBool,
	encodeM2,
	encStr,
	encU32,
	encU32Array,
	findEntry,
	fmtHex,
	fmtMessage,
	type M2Message,
	type M2Value,
	tcodeName,
} from "./m2.ts";
import {
	decryptEnvelope,
	deriveClientKeys,
	encryptEnvelope,
	type SessionKeys,
} from "./session-crypto.ts";

// ── CLI args ────────────────────────────────────────────────────────────

interface Args {
	quickchr: string | null;
	host: string;
	port: number;
	user: string;
	pass: string;
	innerTag: boolean;
	padded32: boolean;
	json: boolean;
	timeoutMs: number;
	fromGuess: number;
	getallMode: string;
	xfields: Array<{ key: number; val: number }>;
	xstrs: Array<{ key: number; val: string }>;
	reqId: number;
	holdMs: number;
	cmd: string;
	rest: string[];
}

function parseArgs(argv: string[]): Args {
	const a: Args = {
		quickchr: null,
		host: "127.0.0.1",
		port: 8291,
		user: "admin",
		pass: "",
		innerTag: false,
		padded32: false,
		json: false,
		timeoutMs: 8000,
		fromGuess: 11,
		getallMode: "auto",
		xfields: [],
		xstrs: [],
		reqId: 2,
		holdMs: 0,
		cmd: "auth",
		rest: [],
	};
	const pos: string[] = [];
	for (let i = 0; i < argv.length; i++) {
		const t = argv[i] ?? "";
		if (t === "--quickchr") a.quickchr = argv[++i] ?? "";
		else if (t === "--host") a.host = argv[++i] ?? "";
		else if (t === "--port") a.port = Number(argv[++i] ?? "8291");
		else if (t === "--user") a.user = argv[++i] ?? "";
		else if (t === "--pass") a.pass = argv[++i] ?? "";
		else if (t === "--inner-tag") a.innerTag = true;
		else if (t === "--padded32") a.padded32 = true;
		else if (t === "--json") a.json = true;
		else if (t === "--timeout") a.timeoutMs = Number(argv[++i] ?? "8000");
		else if (t === "--from-guess") a.fromGuess = Number(argv[++i] ?? "11");
		else if (t === "--getall-mode") a.getallMode = argv[++i] ?? "auto";
		else if (t === "--reqid") a.reqId = Number(argv[++i] ?? "2");
		else if (t === "--hold") a.holdMs = Number(argv[++i] ?? "0");
		else if (t === "--xfield") {
			const spec = argv[++i] ?? "";
			const [ks, vs] = spec.split("=");
			const key = Number(ks);
			const val = Number(vs);
			if (!Number.isInteger(key) || !Number.isInteger(val)) {
				throw new Error("--xfield <fullkey>=<value>");
			}
			a.xfields.push({ key, val });
		} else if (t === "--xstr") {
			const spec = argv[++i] ?? "";
			const eq = spec.indexOf("=");
			const key = Number(spec.slice(0, eq));
			const val = spec.slice(eq + 1);
			if (!Number.isInteger(key) || eq < 0) {
				throw new Error("--xstr <fullkey>=<string>");
			}
			a.xstrs.push({ key, val });
		} else if (t.startsWith("--")) throw new Error(`unknown flag ${t}`);
		else pos.push(t);
	}
	if (pos.length > 0) a.cmd = pos[0] ?? "auth";
	a.rest = pos.slice(1);
	return a;
}

// ── target resolution ───────────────────────────────────────────────────

function asRecord(v: unknown): Record<string, unknown> {
	if (typeof v !== "object" || v === null) throw new Error("want object");
	return v as Record<string, unknown>;
}

function quickchrJson(args: string[]): unknown {
	const r = Bun.spawnSync(["bunx", "@tikoci/quickchr@latest", ...args]);
	if (!r.success) throw new Error(`quickchr ${args.join(" ")} failed`);
	return JSON.parse(r.stdout.toString());
}

function resolveQuickchr(name: string): {
	host: string;
	port: number;
	user: string;
	pass: string;
} {
	const list = quickchrJson(["list", "--json"]);
	if (!Array.isArray(list)) throw new Error("quickchr list: want array");
	// biome-ignore lint/complexity/useLiteralKeys: TS4111 requires bracket access on index signatures
	const m = list.map(asRecord).find((x) => x["name"] === name);
	if (!m) throw new Error(`quickchr: no machine ${name}`);
	// biome-ignore lint/complexity/useLiteralKeys: TS4111 requires bracket access on index signatures
	const ports = asRecord(m["ports"]);
	// biome-ignore lint/complexity/useLiteralKeys: TS4111 requires bracket access on index signatures
	const wb = asRecord(ports["winbox"] ?? {});
	// biome-ignore lint/complexity/useLiteralKeys: TS4111 requires bracket access on index signatures
	const port = wb["host"];
	if (typeof port !== "number") throw new Error("quickchr: no winbox port");
	const insp = asRecord(quickchrJson(["inspect", name, "--json"]));
	// biome-ignore lint/complexity/useLiteralKeys: TS4111 requires bracket access on index signatures
	const services = asRecord(insp["services"] ?? {});
	const rest = asRecord(services["rest-api"] ?? {});
	// biome-ignore lint/complexity/useLiteralKeys: TS4111 requires bracket access on index signatures
	const auth = asRecord(rest["auth"] ?? {});
	// biome-ignore lint/complexity/useLiteralKeys: TS4111 requires bracket access on index signatures
	const user = auth["username"];
	// biome-ignore lint/complexity/useLiteralKeys: TS4111 requires bracket access on index signatures
	const pass = auth["password"];
	if (typeof user !== "string" || typeof pass !== "string") {
		throw new Error("quickchr: no rest-api auth");
	}
	return { host: "127.0.0.1", port, user, pass };
}

// ── auth ────────────────────────────────────────────────────────────────

export interface Authed {
	conn: ChunkConn;
	keys: SessionKeys;
	sourceId: number;
	diag: SharedDiag;
	saltHex: string;
}

function hexEq(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}

/** MarginResearch's capture of WinBox.exe's first post-auth message. */
const MR_FIRST_MSG_HEX =
	"4d320500ff010600ff09010700ff09070100ff88" +
	"02000d000000040000000200ff880200000000000b000000";

/**
 * EC-SRP5 handshake + source-id adoption. Returns the live session.
 * Throws on auth failure; returns {mschap:true} when the server answers
 * the 33-byte MSCHAP branch instead of 49-byte SRP.
 */
export async function login(
	host: string,
	port: number,
	user: string,
	pass: string,
	opts: {
		innerTag: boolean;
		padded32: boolean;
		timeoutMs: number;
		fromGuess: number;
	},
): Promise<Authed | { mschap: true }> {
	const conn = await ChunkConn.open(host, port, opts.timeoutMs);
	try {
		const kp = keygen();
		const enc = new TextEncoder().encode(user);
		const p1parts = [enc, new Uint8Array([0]), kp.publicKey];
		if (opts.innerTag) p1parts.unshift(new Uint8Array([0x06]));
		const p1len = p1parts.reduce((n, p) => n + p.length, 0);
		const p1 = new Uint8Array(p1len);
		let c = 0;
		for (const p of p1parts) {
			p1.set(p, c);
			c += p.length;
		}
		await conn.write(frameMessage(0x06, p1));
		const r1 = await conn.readMessage();
		if (r1.tag !== 0x06) throw new Error(`phase1 reply tag ${r1.tag}`);
		if (r1.payload.length === 33) return { mschap: true };
		if (r1.payload.length !== 49) {
			throw new Error(`phase1 reply ${r1.payload.length}B, want 49`);
		}
		const serverKey = r1.payload.subarray(0, 33);
		const salt = r1.payload.subarray(33, 49);
		const validator = srpId(user, pass, salt);
		const { shared, diag } = clientShared(
			kp.privateKey,
			serverKey,
			kp.publicKey,
			validator,
			opts.padded32,
		);
		const cc = opts.innerTag
			? new Uint8Array([0x06, ...shared.clientConfirm])
			: shared.clientConfirm;
		await conn.write(frameMessage(0x06, cc));
		const r2 = await conn.readMessage();
		if (r2.tag !== 0x06) throw new Error(`phase2 reply tag ${r2.tag}`);
		const got = opts.innerTag ? r2.payload.subarray(1) : r2.payload;
		if (!hexEq(got, shared.serverConfirm)) {
			const err = new Error(
				"server confirmation mismatch (bad user/pass/math?)",
			) as Error & {
				diag?: SharedDiag;
			};
			err.diag = diag;
			throw err;
		}
		const keys = deriveClientKeys(shared.secret);
		const saltHex = fmtHex(salt);
		// Source-id adoption: GET [13,4] CMD=7 u8 — with the default
		// guess (11) this must encode byte-identical to the
		// real-client capture.
		const adoptReq = buildRequest([13, 4], 7, opts.fromGuess, 1, []);
		if (opts.fromGuess === 11 && fmtHex(adoptReq) !== MR_FIRST_MSG_HEX) {
			throw new Error("M2 encoder diverged from real-client capture");
		}
		const reply = await roundTrip(conn, keys, adoptReq);
		const to = findEntry(reply, 0xff0001);
		const toVal = to?.value;
		if (!Array.isArray(toVal) || typeof toVal[1] !== "number") {
			throw new Error("adoption reply has no SYS_TO pair");
		}
		return { conn, keys, sourceId: toVal[1] as number, diag, saltHex };
	} catch (e) {
		conn.close();
		throw e;
	}
}

// ── requests ────────────────────────────────────────────────────────────

/** Build a request in real-client field order: REPLYEXP, REQID, CMD, TO, FROM. */
function encodeExtras(a: Args): EncEntry[] {
	return [
		...a.xfields.map((f) => encU32(f.key, f.val)),
		...a.xstrs.map((f) => encStr(f.key, f.val)),
	];
}

function customSpec(a: Args): string {
	const parts = [
		...a.xfields.map((f) => `0x${f.key.toString(16)}=${f.val}`),
		...a.xstrs.map((f) => `0x${f.key.toString(16)}=${JSON.stringify(f.val)}`),
	];
	return parts.length > 0 ? ` custom ${parts.join(" ")}` : "";
}

function buildRequest(
	to: number[],
	cmd: number,
	fromId: number,
	reqId: number,
	extra: EncEntry[],
): Uint8Array {
	return encodeM2([
		encBool(0xff0005, true),
		encU32(0xff0006, reqId),
		encU32(0xff0007, cmd),
		encU32Array(0xff0001, to),
		encU32Array(0xff0002, [0, fromId]),
		...extra,
	]);
}

async function roundTrip(
	conn: ChunkConn,
	keys: SessionKeys,
	plain: Uint8Array,
): Promise<M2Message> {
	const env = encryptEnvelope(keys.sendAes, keys.sendHmac, plain);
	await conn.write(frameMessage(0x06, env));
	const r = await conn.readMessage();
	if (r.tag !== 0x06) throw new Error(`reply tag ${r.tag}, want 0x06`);
	return decodeM2(
		decryptEnvelope(keys.receiveAes, keys.receiveHmac, r.payload),
	);
}

const CMD_GET = 0xfe000d;
const CMD_GETALL = 0xfe0004;
const CMD_GETOBJ = 0xfe0002;
const CMD_SET = 0xfe000e;

function toJSON(m: M2Message): unknown {
	return m.entries.map((e) => ({
		key: `0x${e.fullKey.toString(16).padStart(6, "0")}`,
		tcode: `0x${e.tcode.toString(16)}`,
		value: jsonValue(e.value as M2Value),
	}));
}

function jsonValue(v: M2Value): unknown {
	if (typeof v === "bigint") return `u64:${v}`;
	if (v instanceof Uint8Array) return `bytes:${fmtHex(v, 256)}`;
	if (Array.isArray(v)) {
		if (
			v.length > 0 &&
			typeof v[0] === "object" &&
			!(v[0] instanceof Uint8Array)
		) {
			return (v as M2Message[]).map(toJSON);
		}
		return (v as unknown[]).map((x) =>
			x instanceof Uint8Array ? `bytes:${fmtHex(x, 256)}` : x,
		);
	}
	if (typeof v === "object") return toJSON(v as M2Message);
	return v;
}

// ── subcommands ─────────────────────────────────────────────────────────

async function cmdAuth(
	a: Args,
	t: { host: string; port: number; user: string; pass: string },
): Promise<void> {
	const s = await login(t.host, t.port, t.user, t.pass, a);
	if ("mschap" in s) {
		console.log("MSCHAP-33 branch: server answered 33B (not SRP-49)");
		return;
	}
	console.log(`auth OK  salt=${s.saltHex} sourceId=${s.sourceId}`);
	console.log(
		`diag redp1iters=${s.diag.redp1Iters}/${s.diag.redp1ItersOther} zLen=${s.diag.zLen} encodingsAgree=${s.diag.encodingsAgree}`,
	);
	if (a.holdMs > 0) await Bun.sleep(a.holdMs);
	s.conn.close();
}

async function cmdGetOne(
	a: Args,
	t: { host: string; port: number; user: string; pass: string },
	pid: number,
	hid?: number,
): Promise<void> {
	const s = await login(t.host, t.port, t.user, t.pass, a);
	if ("mschap" in s) {
		console.log("MSCHAP-33 branch");
		return;
	}
	const to = hid === undefined ? [pid] : [pid, hid];
	const extra = encodeExtras(a);
	const reply = await roundTrip(
		s.conn,
		s.keys,
		buildRequest(to, CMD_GET, s.sourceId, 2, extra),
	);
	if (a.json) console.log(JSON.stringify(toJSON(reply)));
	else {
		console.log(`GET_ONE [${to}] (sourceId=${s.sourceId})${customSpec(a)}:`);
		console.log(fmtMessage(reply));
	}
	s.conn.close();
}

type GetAllMode = "bare" | "flags-fe" | "flags-user";

async function getAllOnce(
	s: Authed,
	to: number[],
	mode: GetAllMode,
	reqId: number,
): Promise<M2Message> {
	let extra: EncEntry[] = [];
	if (mode === "flags-fe") {
		// gui-handlers.yaml fixture as 0xfe-namespace fields.
		extra = [encU32(0xfe000c, 0x20000000), encU32(0xfe0004, 0)];
	} else if (mode === "flags-user") {
		// Same fixture as USER-namespace (0x00) fields.
		extra = [encU32(0x00000c, 0x20000000), encU32(0x000004, 0)];
	}
	return roundTrip(
		s.conn,
		s.keys,
		buildRequest(to, CMD_GETALL, s.sourceId, reqId, extra),
	);
}

async function cmdGetAll(
	a: Args,
	t: { host: string; port: number; user: string; pass: string },
	pid: number,
	hid?: number,
): Promise<void> {
	const s = await login(t.host, t.port, t.user, t.pass, a);
	if ("mschap" in s) {
		console.log("MSCHAP-33 branch");
		return;
	}
	const to = hid === undefined ? [pid] : [pid, hid];
	if (a.xfields.length > 0 || a.xstrs.length > 0) {
		const extra = encodeExtras(a);
		const rq = a.reqId;
		const reply = await roundTrip(
			s.conn,
			s.keys,
			buildRequest(to, CMD_GETALL, s.sourceId, rq, extra),
		);
		const rows = findEntry(reply, 0xfe0002);
		const spec = customSpec(a).replace(/^ custom /, "");
		console.log(
			`--- GET_ALL [${to}] custom ${spec} rows=${rows && Array.isArray(rows.value) ? (rows.value as M2Message[]).length : "none"} ---`,
		);
		console.log(a.json ? JSON.stringify(toJSON(reply)) : fmtMessage(reply));
		s.conn.close();
		return;
	}
	const modes: GetAllMode[] =
		a.getallMode === "auto"
			? ["bare", "flags-fe", "flags-user"]
			: [a.getallMode as GetAllMode];
	let reqId = 2;
	for (const mode of modes) {
		try {
			const reply = await getAllOnce(s, to, mode, reqId++);
			const rows = findEntry(reply, 0xfe0002);
			const nrows =
				rows && Array.isArray(rows.value)
					? (rows.value as M2Message[]).length
					: -1;
			if (a.json) console.log(JSON.stringify({ mode, reply: toJSON(reply) }));
			else {
				console.log(
					`--- GET_ALL [${to}] mode=${mode} rows@0xfe0002=${nrows} ---`,
				);
				console.log(fmtMessage(reply));
			}
			if (nrows >= 0 && mode === "bare") break; // bare works; skip fixtures
		} catch (e) {
			console.log(
				`--- GET_ALL [${to}] mode=${mode} ERROR: ${(e as Error).message} ---`,
			);
		}
	}
	s.conn.close();
}

async function cmdGetObj(
	a: Args,
	t: { host: string; port: number; user: string; pass: string },
	pid: number,
	hid: number,
	objId: number,
): Promise<void> {
	const s = await login(t.host, t.port, t.user, t.pass, a);
	if ("mschap" in s) {
		console.log("MSCHAP-33 branch");
		return;
	}
	const to = [pid, hid];
	const extra = [encU32(0xfe0001, objId), ...encodeExtras(a)];
	const reply = await roundTrip(
		s.conn,
		s.keys,
		buildRequest(to, CMD_GETOBJ, s.sourceId, 2, extra),
	);
	if (a.json) console.log(JSON.stringify(toJSON(reply)));
	else {
		console.log(`GET_OBJ [${to}] obj=${objId} (sourceId=${s.sourceId}):`);
		console.log(fmtMessage(reply));
	}
	s.conn.close();
}

async function cmdSetOne(
	a: Args,
	t: { host: string; port: number; user: string; pass: string },
	pid: number,
	hid?: number,
): Promise<void> {
	const s = await login(t.host, t.port, t.user, t.pass, a);
	if ("mschap" in s) {
		console.log("MSCHAP-33 branch");
		return;
	}
	const to = hid === undefined ? [pid] : [pid, hid];
	const extra = encodeExtras(a);
	const reply = await roundTrip(
		s.conn,
		s.keys,
		buildRequest(to, CMD_SET, s.sourceId, 2, extra),
	);
	if (a.json) console.log(JSON.stringify(toJSON(reply)));
	else {
		console.log(`SET_ONE [${to}] (sourceId=${s.sourceId})${customSpec(a)}:`);
		console.log(fmtMessage(reply));
	}
	s.conn.close();
}

async function cmdSweep(
	a: Args,
	t: { host: string; port: number; user: string; pass: string },
): Promise<void> {
	const s = await login(t.host, t.port, t.user, t.pass, a);
	if ("mschap" in s) {
		console.log("MSCHAP-33 branch");
		return;
	}
	console.log(
		`auth OK salt=${s.saltHex} sourceId=${s.sourceId} agree=${s.diag.encodingsAgree}`,
	);
	let reqId = 2;
	const one = async (label: string, to: number[]) => {
		try {
			const reply = await roundTrip(
				s.conn,
				s.keys,
				buildRequest(to, CMD_GET, s.sourceId, reqId++, []),
			);
			console.log(`--- GET_ONE [${to}] ${label} ---`);
			console.log(a.json ? JSON.stringify(toJSON(reply)) : fmtMessage(reply));
		} catch (e) {
			console.log(
				`--- GET_ONE [${to}] ${label} ERROR: ${(e as Error).message} ---`,
			);
		}
	};
	const all = async (label: string, to: number[]) => {
		for (const mode of ["bare", "flags-fe", "flags-user"] as const) {
			try {
				const reply = await getAllOnce(s, to, mode, reqId++);
				const rows = findEntry(reply, 0xfe0002);
				console.log(
					`--- GET_ALL [${to}] ${label} mode=${mode} rows@0xfe0002=${rows && Array.isArray(rows.value) ? (rows.value as M2Message[]).length : "none"} ---`,
				);
				console.log(a.json ? JSON.stringify(toJSON(reply)) : fmtMessage(reply));
				break; // first mode that answers wins; fixtures only on failure
			} catch (e) {
				console.log(
					`--- GET_ALL [${to}] ${label} mode=${mode} ERROR: ${(e as Error).message} ---`,
				);
			}
		}
	};
	await one("system-resource", [24, 2]);
	await one("system-identity", [24, 1]);
	await one("routerboard?", [24, 17]);
	await one("license?", [65]);
	await all("interface", [20, 0]);
	await all("ip-address", [20, 1]);
	s.conn.close();
}

async function cmdHscan(
	a: Args,
	t: { host: string; port: number; user: string; pass: string },
	pid: number,
	lo: number,
	hi: number,
): Promise<void> {
	const s = await login(t.host, t.port, t.user, t.pass, a);
	if ("mschap" in s) {
		console.log("MSCHAP-33 branch");
		return;
	}
	let reqId = 2;
	for (let h = lo; h <= hi; h++) {
		try {
			const reply = await roundTrip(
				s.conn,
				s.keys,
				buildRequest([pid, h], CMD_GET, s.sourceId, reqId++, []),
			);
			const status = findEntry(reply, 0xff0004)?.value;
			const errno = findEntry(reply, 0xff0008)?.value;
			const from = findEntry(reply, 0xff0002)?.value;
			const nfields = reply.entries.length;
			const keys = reply.entries
				.filter((e) => e.byte2 === 0x00)
				.map((e) => `${e.keyId}:${tcodeName(e.tcode)}`)
				.join(" ");
			console.log(
				`[${pid},${h}] status=${String(status)} errno=${typeof errno === "number" ? `0x${errno.toString(16)}` : String(errno)} from=${JSON.stringify(from)} nfields=${nfields} user={${keys}}`,
			);
		} catch (e) {
			console.log(`[${pid},${h}] TRANSPORT-ERROR ${(e as Error).message}`);
		}
	}
	s.conn.close();
}

async function cmdRedp1Sweep(
	a: Args,
	t: { host: string; port: number; user: string; pass: string },
	n: number,
): Promise<void> {
	let ok = 0;
	let agreeOk = 0;
	let divergeOk = 0;
	let agreeFail = 0;
	let divergeFail = 0;
	let mschap = 0;
	let unknown = 0;
	const salts = new Set<string>();
	let prevSalt = "";
	for (let i = 0; i < n; i++) {
		try {
			const s = await login(t.host, t.port, t.user, t.pass, a);
			if ("mschap" in s) {
				mschap++;
				continue;
			}
			ok++;
			salts.add(s.saltHex);
			if (s.saltHex !== prevSalt) {
				if (prevSalt !== "")
					console.log(`[${i}] SALT-ROTATE ${prevSalt} -> ${s.saltHex}`);
				prevSalt = s.saltHex;
			}
			if (s.diag.encodingsAgree) agreeOk++;
			else {
				divergeOk++;
				console.log(
					`[${i}] DIVERGE ok iters=${s.diag.redp1Iters}/${s.diag.redp1ItersOther} zLen=${s.diag.zLen} salt=${s.saltHex}`,
				);
			}
			s.conn.close();
		} catch (e) {
			const diag = (e as { diag?: SharedDiag }).diag;
			if (!diag) {
				unknown++;
				console.log(`[${i}] FAIL(no-diag) ${(e as Error).message}`);
			} else if (diag.encodingsAgree) {
				agreeFail++;
				console.log(`[${i}] FAIL(agree) ${(e as Error).message}`);
			} else {
				divergeFail++;
				console.log(
					`[${i}] FAIL(DIVERGE) iters=${diag.redp1Iters}/${diag.redp1ItersOther} zLen=${diag.zLen} ${(e as Error).message}`,
				);
			}
		}
	}
	console.log(
		`redp1sweep n=${n} ok=${ok} agreeOk=${agreeOk} divergeOk=${divergeOk} agreeFail=${agreeFail} divergeFail=${divergeFail} mschap=${mschap} unknown=${unknown} distinctSalts=${salts.size}`,
	);
}

// ── main ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	const a = parseArgs(process.argv.slice(2));
	const t = a.quickchr
		? resolveQuickchr(a.quickchr)
		: { host: a.host, port: a.port, user: a.user, pass: a.pass };
	if (a.cmd === "auth") await cmdAuth(a, t);
	else if (a.cmd === "adopt") await cmdAuth(a, t);
	else if (a.cmd === "getone") {
		const pid = Number(a.rest[0]);
		const hid = a.rest[1] === undefined ? undefined : Number(a.rest[1]);
		if (!Number.isInteger(pid)) throw new Error("getone <pid> [hid]");
		await cmdGetOne(a, t, pid, hid);
	} else if (a.cmd === "getall") {
		const pid = Number(a.rest[0]);
		const hid = a.rest[1] === undefined ? undefined : Number(a.rest[1]);
		if (!Number.isInteger(pid)) throw new Error("getall <pid> [hid]");
		await cmdGetAll(a, t, pid, hid);
	} else if (a.cmd === "getobj") {
		const pid = Number(a.rest[0]);
		const hid = Number(a.rest[1]);
		const objId = Number(a.rest[2] ?? "0");
		if (
			!Number.isInteger(pid) ||
			!Number.isInteger(hid) ||
			!Number.isInteger(objId)
		) {
			throw new Error("getobj <pid> <hid> [obj-id]");
		}
		await cmdGetObj(a, t, pid, hid, objId);
	} else if (a.cmd === "setone") {
		const pid = Number(a.rest[0]);
		const hid = a.rest[1] === undefined ? undefined : Number(a.rest[1]);
		if (
			!Number.isInteger(pid) ||
			(hid !== undefined && !Number.isInteger(hid))
		) {
			throw new Error("setone <pid> [hid] (--xfield/--xstr payload)");
		}
		await cmdSetOne(a, t, pid, hid);
	} else if (a.cmd === "sweep") await cmdSweep(a, t);
	else if (a.cmd === "hscan") {
		const pid = Number(a.rest[0]);
		const lo = Number(a.rest[1] ?? "0");
		const hi = Number(a.rest[2] ?? "31");
		if (
			!Number.isInteger(pid) ||
			!Number.isInteger(lo) ||
			!Number.isInteger(hi)
		) {
			throw new Error("hscan <pid> [lo] [hi]");
		}
		await cmdHscan(a, t, pid, lo, hi);
	} else if (a.cmd === "redp1sweep") {
		const n = Number(a.rest[0] ?? "120");
		if (!Number.isInteger(n) || n < 1) throw new Error("redp1sweep <n>");
		await cmdRedp1Sweep(a, t, n);
	} else
		throw new Error(
			`unknown command ${a.cmd} (auth|getone|getall|getobj|setone|sweep|hscan|redp1sweep)`,
		);
	process.exit(0);
}

if (import.meta.main) {
	main().catch((e: unknown) => {
		console.error(`ws3c: ${(e as Error).message}`);
		process.exit(1);
	});
}
