/**
 * Setting studies on the hub segment (`hub.ts`): change one setting on one router, then ask for
 * an announcement with a TLV 6 request (it draws a reply and, unlike a bare header-0 request,
 * does not add the host to the routers' neighbor tables), and record that router's
 * announcement plus how the observer's `/ip/neighbor` renders it.
 *
 *   bun work/2026-11-mndp-grounding/hubstudy.ts <study> <out.json> observer=machine name=machine ...
 *
 * Studies: `ipv6` (TLV 14 vs `/ipv6/settings disable-ipv6` on every non-observer router,
 * including across a reboot) and `running` (TLV 18 with CAPsMAN and CMR, alone and together).
 */
import { parseMndp, summary } from "./mndp-wire.ts";

const HUB = "http://127.0.0.1:15699";
const REQUEST = "0000000000060000"; // header 0 + empty TLV 6
const [study, out, ...specs] = process.argv.slice(2);
if (!study || !out || specs.length < 2) {
	console.error(
		"usage: hubstudy.ts <ipv6|running> <out.json> observer=machine name=machine ...",
	);
	process.exit(2);
}

interface Rest {
	url: string;
	auth: string;
}
function rest(machine: string): Rest {
	const j = JSON.parse(
		Bun.spawnSync(["quickchr", "inspect", machine, "--json"]).stdout.toString(),
	);
	const r = j.services["rest-api"];
	return {
		url: r.url,
		auth: `Basic ${btoa(`${r.auth.username}:${r.auth.password}`)}`,
	};
}
async function call(
	r: Rest,
	method: string,
	path: string,
	body?: unknown,
): Promise<unknown> {
	try {
		const res = await fetch(`${r.url}${path}`, {
			method,
			headers: { authorization: r.auth, "content-type": "application/json" },
			body: body === undefined ? undefined : JSON.stringify(body),
			signal: AbortSignal.timeout(20_000),
		});
		const text = await res.text();
		let data: unknown = text;
		try {
			data = JSON.parse(text);
		} catch {}
		return res.ok ? data : { error: res.status, data };
	} catch (e) {
		return { error: String(e) };
	}
}
const execute = (r: Rest, script: string) =>
	call(r, "POST", "/execute", { script, "as-string": "" });

interface Router {
	name: string;
	machine: string;
	rest: Rest;
	mac: string;
	version: string;
}
const routers: Router[] = [];
for (const s of specs) {
	const [name = "", machine = ""] = s.split("=");
	const r = rest(machine);
	const ifs = (await call(r, "GET", "/interface")) as Array<
		Record<string, string>
	>;
	const res = (await call(r, "GET", "/system/resource")) as Record<
		string,
		string
	>;
	routers.push({
		name,
		machine,
		rest: r,
		mac:
			ifs.find((i) => i["name"] === "ether2")?.["mac-address"]?.toLowerCase() ??
			"",
		version: res["version"] ?? "?",
	});
}
const observer = routers.find((r) => r.name === "observer");
if (!observer) throw new Error("need observer=<machine>");
const obs: Router = observer;
const subjects = routers.filter((r) => r !== obs);

async function hubNow(): Promise<number> {
	return (
		(await (await fetch(`${HUB}/frames?since=1e15`)).json()) as { now: number }
	).now;
}
async function framesSince(t: number) {
	return (
		(await (await fetch(`${HUB}/frames?since=${t}`)).json()) as {
			frames: Array<{
				t: number;
				srcMac: string;
				family: number;
				payloadHex: string;
			}>;
		}
	).frames;
}

interface StepRecord {
	id: string;
	router: string;
	commands: Array<{ cmd: string; result: unknown }>;
	/** IPv4 announcements from the router after the change (triggered, then the requested reply). */
	announcements: Array<{ t: number; payloadHex: string; summary: string }>;
	tlv?: Record<string, string[]>;
	neighbor?: Record<string, string> | null;
}
const steps: StepRecord[] = [];

/** Run commands on `r`, wait, request an announcement, and record what it sent and how the observer shows it. */
async function step(
	id: string,
	r: Router,
	cmds: string[],
	opts: { wait?: number; reboot?: boolean } = {},
) {
	const t0 = await hubNow();
	const rec: StepRecord = {
		id,
		router: r.name,
		commands: [],
		announcements: [],
	};
	for (const cmd of cmds)
		rec.commands.push({ cmd, result: await execute(r.rest, cmd) });
	if (opts.reboot) {
		await execute(r.rest, "/system/reboot");
		await Bun.sleep(10_000);
		const deadline = Date.now() + 240_000;
		while (Date.now() < deadline) {
			const v = (await call(r.rest, "GET", "/system/identity")) as Record<
				string,
				unknown
			>;
			if (v && !("error" in v)) break;
			await Bun.sleep(3_000);
		}
		await Bun.sleep(5_000);
	}
	await Bun.sleep((opts.wait ?? 4) * 1000);
	await fetch(`${HUB}/send`, {
		method: "POST",
		body: JSON.stringify({
			family: 4,
			dst: "255.255.255.255",
			sport: 43000,
			payloadHex: REQUEST,
		}),
	});
	await Bun.sleep(4_000);
	rec.announcements = (await framesSince(t0))
		.filter((f) => f.srcMac === r.mac && f.family === 4)
		.map((f) => ({
			t: f.t - t0,
			payloadHex: f.payloadHex,
			summary: summary(parseMndp(Buffer.from(f.payloadHex, "hex"))),
		}));
	const last = rec.announcements.at(-1);
	if (last) {
		const tlv: Record<string, string[]> = {};
		for (const t of parseMndp(Buffer.from(last.payloadHex, "hex")).tlvs) {
			if (![14, 15, 18].includes(t.type)) continue;
			const key = String(t.type);
			tlv[key] = [...(tlv[key] ?? []), t.hex];
		}
		rec.tlv = tlv;
	}
	const rows = (await call(obs.rest, "GET", "/ip/neighbor")) as Array<
		Record<string, string>
	>;
	const row = Array.isArray(rows)
		? rows.find((x) => x["mac-address"]?.toLowerCase() === r.mac)
		: undefined;
	rec.neighbor = row
		? Object.fromEntries(
				[
					"identity",
					"version",
					"ipv6",
					"address6",
					"running",
					"unpack",
					"age",
				].map((k) => [k, row[k] ?? "(absent)"]),
			)
		: null;
	steps.push(rec);
	console.log(
		`${id} [${r.name}]: tlv ${JSON.stringify(rec.tlv)} neighbor ipv6=${rec.neighbor?.["ipv6"]} running=${rec.neighbor?.["running"]}`,
	);
}

if (study === "ipv6") {
	for (const r of subjects) {
		await step("default", r, []);
		await step("disable-ipv6", r, ["/ipv6/settings/set disable-ipv6=yes"]);
		await step("disable-ipv6:after-reboot", r, [], { reboot: true });
		await step("enable-ipv6", r, ["/ipv6/settings/set disable-ipv6=no"]);
		await step("enable-ipv6:after-reboot", r, [], { reboot: true });
	}
} else if (study === "running") {
	for (const r of subjects) {
		await step("baseline", r, []);
		await step("capsman:on", r, ["/interface/wifi/capsman/set enabled=yes"]);
		await step("cmr:on (with capsman)", r, ["/cmr/set enabled=yes"]);
		await step("capsman:off (cmr only)", r, [
			"/interface/wifi/capsman/set enabled=no",
		]);
		await step("capsman:on again (with cmr)", r, [
			"/interface/wifi/capsman/set enabled=yes",
		]);
		await step("cmr:off (capsman only)", r, ["/cmr/set enabled=no"]);
		await step("capsman:off", r, ["/interface/wifi/capsman/set enabled=no"]);
	}
} else throw new Error(`unknown study ${study}`);

await Bun.write(
	out,
	JSON.stringify(
		{
			study,
			date: new Date().toISOString(),
			request: REQUEST,
			observer: {
				machine: observer.machine,
				version: observer.version,
				mac: observer.mac,
			},
			subjects: subjects.map((r) => ({
				name: r.name,
				machine: r.machine,
				version: r.version,
				mac: r.mac,
			})),
			steps,
		},
		null,
		"\t",
	),
);
console.log(`wrote ${out}`);
