/**
 * MNDP request study: send candidate discovery requests from the host station (`hub.ts`) and
 * record which routers answer, how fast, to which destination, and with what header.
 *
 *   bun work/2026-11-mndp-grounding/requests.ts <out.json> [--set=main|forms] [--rounds=N] name=quickchr-machine ...
 *
 * `--set=forms` sends payload variants only (broadcast, ephemeral port) to find which bytes count
 * as a request; `--set=fresh` sends each request from a never-seen MAC and IPv4 and then reads
 * every 7.x router's neighbor table for that MAC; `--rounds=N` sends every request N times in a shuffled order per round.
 *
 * Needs `hub.ts` running with the same machines. Each router's ether2 MAC identifies its
 * frames. 7.x routers are read over REST; a 6.x router has no REST, so its MAC is taken from
 * the observer's neighbor table by IPv4 (pass `name=machine@192.168.77.N`).
 */
const HUB = "http://127.0.0.1:15699";
const args = process.argv.slice(2);
const opt = (k: string) =>
	args.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
const [out, ...specs] = args.filter((a) => !a.startsWith("--"));
const SET = opt("set") ?? "main";
const ROUNDS = Number(opt("rounds") ?? 1);
if (!out || specs.length === 0) {
	console.error("usage: requests.ts <out.json> name=machine[@ipv4] ...");
	process.exit(2);
}

interface Router {
	name: string;
	machine: string;
	version?: string;
	mac?: string;
	ipv4?: string;
}

async function rest(machine: string) {
	const j = JSON.parse(
		Bun.spawnSync(["quickchr", "inspect", machine, "--json"]).stdout.toString(),
	);
	const r = j.services["rest-api"];
	return {
		url: r.url as string,
		auth: `Basic ${btoa(`${r.auth.username}:${r.auth.password}`)}`,
	};
}
async function get(machine: string, path: string): Promise<unknown> {
	const r = await rest(machine);
	const res = await fetch(`${r.url}${path}`, {
		headers: { authorization: r.auth },
	});
	return res.json();
}

const routers: Router[] = [];
for (const s of specs) {
	const [name, rhs = ""] = s.split("=");
	const [machine = "", ipv4] = rhs.split("@");
	routers.push({ name: name as string, machine, ipv4 });
}
const observer = routers[0] as Router;
const neighbors = (await get(observer.machine, "/ip/neighbor")) as Array<
	Record<string, string>
>;
for (const r of routers) {
	if (r.ipv4) {
		const n = neighbors.find((x) => x["address"] === r.ipv4);
		r.mac = n?.["mac-address"]?.toLowerCase();
		r.version = n?.["version"];
		continue;
	}
	const ifs = (await get(r.machine, "/interface")) as Array<
		Record<string, string>
	>;
	r.mac = ifs
		.find((i) => i["name"] === "ether2")
		?.["mac-address"]?.toLowerCase();
	r.version = (
		(await get(r.machine, "/system/resource")) as Record<string, string>
	)["version"];
	const addr = (await get(r.machine, "/ip/address")) as Array<
		Record<string, string>
	>;
	r.ipv4 = addr
		.find((a) => a["interface"] === "ether2")
		?.["address"]?.split("/")[0];
}
const byMac = new Map(routers.map((r) => [r.mac, r.name]));
const target = routers[1] as Router; // the unicast target

interface Request {
	id: string;
	note: string;
	family?: 4 | 6;
	dst?: string;
	dstMac?: string;
	src?: string;
	srcMac?: string;
	sport?: number;
	payloadHex: string;
	repeat?: number;
	gapMs?: number;
	round?: number;
}
const fakeAnnouncement = (header: string) =>
	`${header}000100060244444444440005000570726f6265`; // TLV 1 = 02:44:44:44:44:44, TLV 5 = "probe"
const MAIN: Request[] = [
	{
		id: "z4-bcast-sport5678",
		note: "4 zero bytes, 255.255.255.255, from port 5678 (as MAC-Telnet/centrs bind)",
		sport: 5678,
		payloadHex: "00000000",
	},
	{
		id: "z4-bcast",
		note: "4 zero bytes, 255.255.255.255, ephemeral source port",
		payloadHex: "00000000",
	},
	{
		id: "z9-bcast",
		note: "9 zero bytes (centrs mndpRefreshPacket)",
		payloadHex: "000000000000000000",
	},
	{
		id: "t6-8-bcast",
		note: "header 0 + empty TLV 6 (8 bytes)",
		payloadHex: "0000000000060000",
	},
	{
		id: "t6-9-bcast",
		note: "header 0 + empty TLV 6 + pad byte (9 bytes)",
		payloadHex: "000000000006000000",
	},
	{ id: "nz4-bcast", note: "4 bytes, header 01000000", payloadHex: "01000000" },
	{
		id: "nz-t6-bcast",
		note: "header 01000000 + empty TLV 6",
		payloadHex: "0100000000060000",
	},
	{
		id: "nzbe4-bcast",
		note: "4 bytes, header 00000001",
		payloadHex: "00000001",
	},
	{ id: "empty-bcast", note: "empty UDP payload", payloadHex: "" },
	{
		id: "z3-bcast",
		note: "3 zero bytes (short of a header)",
		payloadHex: "000000",
	},
	{
		id: "fake-ann-h0",
		note: "announcement-shaped (TLV 1 + TLV 5) with header 0",
		payloadHex: fakeAnnouncement("00000000"),
	},
	{
		id: "fake-ann-h5",
		note: "announcement-shaped (TLV 1 + TLV 5) with header 05000000",
		payloadHex: fakeAnnouncement("05000000"),
	},
	{
		id: "z4-subnet-bcast",
		note: "4 zero bytes to 192.168.77.255",
		dst: "192.168.77.255",
		payloadHex: "00000000",
	},
	{
		id: "z4-src0",
		note: "4 zero bytes, broadcast, source 0.0.0.0",
		src: "0.0.0.0",
		payloadHex: "00000000",
	},
	{
		id: "z4-unicast",
		note: `4 zero bytes, unicast to ${target.name}`,
		dst: target.ipv4,
		dstMac: target.mac,
		payloadHex: "00000000",
	},
	{
		id: "z4-v6",
		note: "4 zero bytes to ff02::1",
		family: 6,
		dst: "ff02::1",
		payloadHex: "00000000",
	},
	{
		id: "z4-twice-200ms",
		note: "two 4-zero-byte requests 200 ms apart",
		payloadHex: "00000000",
		repeat: 2,
		gapMs: 200,
	},
	{
		id: "z4-five-50ms",
		note: "five 4-zero-byte requests 50 ms apart",
		payloadHex: "00000000",
		repeat: 5,
		gapMs: 50,
	},
];
const FORMS: Request[] = [
	{ id: "z4", note: "header 0", payloadHex: "00000000" },
	{ id: "z5", note: "header 0 + 1 trailing byte", payloadHex: "0000000000" },
	{ id: "z8", note: "header 0 + empty TLV 0", payloadHex: "0000000000000000" },
	{
		id: "z9",
		note: "header 0 + empty TLV 0 + 1 byte (centrs)",
		payloadHex: "000000000000000000",
	},
	{
		id: "z0-garbage",
		note: "header 0 + empty TLV 0 + 3 bytes",
		payloadHex: "0000000000000000ffffff",
	},
	{
		id: "t6-8",
		note: "header 0 + empty TLV 6",
		payloadHex: "0000000000060000",
	},
	{
		id: "t6-9",
		note: "header 0 + empty TLV 6 + 1 byte",
		payloadHex: "000000000006000000",
	},
	{
		id: "t6-t0-9",
		note: "header 0 + empty TLV 6 + empty TLV 0 + 1 byte",
		payloadHex: "00000000000600000000000000",
	},
	{
		id: "t6-len1",
		note: "header 0 + TLV 6 with one value byte",
		payloadHex: "000000000006000100",
	},
	{
		id: "nz-t6-8",
		note: "header 01000000 + empty TLV 6",
		payloadHex: "0100000000060000",
	},
	{
		id: "nz-t6-9",
		note: "header 01000000 + empty TLV 6 + 1 byte",
		payloadHex: "010000000006000000",
	},
	{
		id: "nzbe-t6-8",
		note: "header 00000001 + empty TLV 6",
		payloadHex: "0000000100060000",
	},
	{ id: "nz4", note: "header 01000000", payloadHex: "01000000" },
	{
		id: "nz-t0-8",
		note: "header 01000000 + empty TLV 0",
		payloadHex: "0100000000000000",
	},
	{
		id: "ann-h0-trailing",
		note: "announcement-shaped, header 0, + 1 trailing byte",
		payloadHex: `${fakeAnnouncement("00000000")}00`,
	},
];
/** Fresh stations: 02:4d:4e:44:5<k>:<n>, 192.168.77.<100+n>. */
const run = Math.floor(Math.random() * 16).toString(16);
const fresh = (n: number) => ({
	srcMac: `02:4d:4e:44:5${run}:${(0x10 + n).toString(16)}`,
	src: `192.168.77.${100 + n}`,
});
const FRESH: Request[] = [
	{
		id: "fresh-z4",
		note: "header 0 from a never-seen host",
		payloadHex: "00000000",
		...fresh(1),
	},
	{
		id: "fresh-z9",
		note: "centrs 9-byte form from a never-seen host",
		payloadHex: "000000000000000000",
		...fresh(2),
	},
	{
		id: "fresh-z9-again",
		note: "the same host and form again",
		payloadHex: "000000000000000000",
		...fresh(2),
	},
	{
		id: "fresh-t6-9",
		note: "header 0 + TLV 6 + 1 byte from a never-seen host",
		payloadHex: "000000000006000000",
		...fresh(3),
	},
	{
		id: "fresh-z5",
		note: "header 0 + 1 byte from a never-seen host",
		payloadHex: "0000000000",
		...fresh(4),
	},
	{
		id: "fresh-nz4",
		note: "header 01000000 (not a request) from a never-seen host",
		payloadHex: "01000000",
		...fresh(5),
	},
	{
		id: "fresh-t6-8",
		note: "header 0 + TLV 6 from a never-seen host",
		payloadHex: "0000000000060000",
		...fresh(6),
	},
	{
		id: "fresh-z9-after-z4",
		note: "z9 from the host that sent fresh-z4 earlier in this run",
		payloadHex: "000000000000000000",
		...fresh(1),
	},
];
const SETS: Record<string, Request[]> = {
	main: MAIN,
	forms: FORMS,
	fresh: FRESH,
};
const base = SETS[SET];
if (!base) throw new Error(`unknown set ${SET}`);
const REQUESTS: Request[] = [];
for (let round = 0; round < ROUNDS; round++)
	// `fresh` depends on its order (a host's second request); a single round keeps the listed order too.
	REQUESTS.push(
		...(SET === "fresh" || ROUNDS === 1
			? base
			: [...base].sort(() => Math.random() - 0.5)
		).map((q) => ({ ...q, round })),
	);

/** Replies come 0.2–2 s after a request (random), so wait well past that. */
const WINDOW_MS = 4000;
const results: unknown[] = [];
let sport = 40000;
for (const q of REQUESTS) {
	const sends: number[] = [];
	const s = q.sport ?? ++sport;
	for (let i = 0; i < (q.repeat ?? 1); i++) {
		const res = await fetch(`${HUB}/send`, {
			method: "POST",
			body: JSON.stringify({
				family: q.family ?? 4,
				dst: q.dst ?? "255.255.255.255",
				dstMac: q.dstMac,
				srcMac: q.srcMac,
				src: q.src,
				sport: s,
				payloadHex: q.payloadHex,
			}),
		});
		sends.push(((await res.json()) as { t: number }).t);
		if (q.gapMs) await Bun.sleep(q.gapMs);
	}
	await Bun.sleep(WINDOW_MS);
	const got = (await (
		await fetch(`${HUB}/frames?since=${sends[0]}`)
	).json()) as {
		frames: Array<{
			t: number;
			srcMac: string;
			dstMac: string;
			family: number;
			src: string;
			dst: string;
			sport: number;
			dport: number;
			payloadHex: string;
		}>;
		other: unknown[];
	};
	const replies = got.frames
		.filter((f) => f.t <= (sends[0] as number) + WINDOW_MS)
		.map((f) => ({
			router: byMac.get(f.srcMac) ?? f.srcMac,
			ms: f.t - (sends[0] as number),
			family: f.family,
			dstMac: f.dstMac,
			dst: `${f.dst}:${f.dport}`,
			sport: f.sport,
			header: f.payloadHex.slice(0, 8),
			bytes: f.payloadHex.length / 2,
			payloadHex: f.payloadHex,
		}));
	/** For a fresh host: does a router now list it as a neighbor (7.x routers, over REST)? */
	let listedBy: Record<string, unknown> | undefined;
	if (q.srcMac) {
		listedBy = {};
		for (const r of routers.filter((x) => !x.machine.endsWith("-v6"))) {
			const rows = (await get(r.machine, "/ip/neighbor")) as Array<
				Record<string, string>
			>;
			const row = rows.find(
				(x) => x["mac-address"]?.toLowerCase() === q.srcMac,
			);
			listedBy[r.name] = row
				? {
						identity: row["identity"],
						address: row["address"],
						age: row["age"],
					}
				: null;
		}
	}
	results.push({
		...q,
		sport: s,
		sends,
		replies,
		other: got.other,
		...(listedBy ? { listedBy } : {}),
	});
	const who = [...new Set(replies.map((r) => r.router))].join(",");
	console.log(
		`${q.round ?? 0} ${q.id}: ${replies.length} frames from [${who}]`,
	);
	await Bun.sleep(3000); // keep requests apart, so one burst never coalesces two requests
}

await Bun.write(
	out,
	JSON.stringify(
		{
			date: new Date().toISOString(),
			set: SET,
			rounds: ROUNDS,
			windowMs: WINDOW_MS,
			routers,
			requests: results,
		},
		null,
		"\t",
	),
);
console.log(`wrote ${out}`);
