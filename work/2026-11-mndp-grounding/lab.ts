/**
 * MNDP grounding lab: change one RouterOS setting at a time on a subject CHR and record the
 * MNDP announcements it sends, plus how an observer CHR's /ip/neighbor renders them.
 *
 * Topology (quickchr 0.5.2): every machine has `user` first (REST, host gateway 10.0.2.2) and
 * one `socket::<link>` per neighbor. Both routers stream their socket link to the host with
 * `/tool/sniffer` over TZSP, each to its own port, so every frame records which side saw it
 * (`via`). The observer's copy survives the subject's reboot (dying-gasp). The host never
 * touches the socket link itself.
 *
 *   bun work/2026-11-mndp-grounding/lab.ts <subject> <observer> <study> <out.json> [observer-iface]
 *
 * Studies are defined in `studies.ts`. Each step is a list of RouterOS commands sent over
 * REST `/rest/execute`, a settle time, and an optional observer neighbor read.
 */
import { createSocket } from "node:dgram";
import { parseMndp, summary, tzspFrame, udp5678 } from "./mndp-wire.ts";
import { STUDIES, type Step } from "./studies.ts";

interface Rest {
	url: string;
	auth: string;
}

async function rest(name: string): Promise<Rest> {
	const proc = Bun.spawnSync(["quickchr", "inspect", name, "--json"]);
	const j = JSON.parse(proc.stdout.toString());
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
	if (!res.ok) return { error: res.status, data };
	return data;
}

/** Run one CLI statement; RouterOS returns `ret` text or an error object. */
const execute = (r: Rest, script: string) =>
	call(r, "POST", "/execute", { script, "as-string": "" });

const [subjectName, observerName, studyName, out, OBSERVER_IFACE = "ether2"] =
	process.argv.slice(2);
if (!subjectName || !observerName || !studyName || !out) {
	console.error("usage: lab.ts <subject> <observer> <study> <out.json>");
	process.exit(2);
}
const study = STUDIES[studyName];
if (!study)
	throw new Error(
		`unknown study ${studyName}; known: ${Object.keys(STUDIES).join(", ")}`,
	);

const subject = await rest(subjectName);
const observer = await rest(observerName);
const t0 = Date.now();
const now = () => Date.now() - t0;

interface Seen {
	t: number;
	via: string;
	step: string;
	family: number;
	src: string;
	srcMac: string;
	payloadHex: string;
	summary: string;
}
const seen: Seen[] = [];
let stepId = "setup";
/** One TZSP receiver per router, so every frame records which sniffer saw it. */
async function receiver(
	via: string,
): Promise<{ port: number; close: () => void }> {
	const sock = createSocket("udp4");
	sock.on("message", (d) => {
		const f = tzspFrame(d);
		const u = f && udp5678(f);
		if (!u) return;
		seen.push({
			t: now(),
			via,
			step: stepId,
			family: u.family,
			src: u.src,
			srcMac: u.srcMac,
			payloadHex: u.payload.toString("hex"),
			summary: summary(parseMndp(u.payload)),
		});
	});
	const port: number = await new Promise((res) =>
		sock.bind(0, "127.0.0.1", () => res(sock.address().port)),
	);
	return { port, close: () => sock.close() };
}
const rxSubject = await receiver("subject");
const rxObserver = await receiver("observer");

const subjectRes = (await call(subject, "GET", "/system/resource")) as Record<
	string,
	string
>;
const observerRes = (await call(observer, "GET", "/system/resource")) as Record<
	string,
	string
>;
const subjectMacs = (
	(await call(subject, "GET", "/interface")) as Array<Record<string, string>>
).map((i) => i["mac-address"]?.toLowerCase());

async function arm(r: Rest, port: number, iface: string) {
	await execute(r, "/tool/sniffer/stop");
	await execute(
		r,
		`/tool/sniffer/set filter-interface=${iface} filter-ip-protocol=udp filter-port=5678 streaming-enabled=yes streaming-server=10.0.2.2:${port} filter-stream=yes memory-limit=100`,
	);
	await execute(r, "/tool/sniffer/start");
}
const armSubject = () => arm(subject, rxSubject.port, study.sniff ?? "ether2");

const steps: Array<{
	id: string;
	t: number;
	commands: Array<{ cmd: string; result: unknown }>;
	neighbor?: unknown;
	read?: Record<string, unknown>;
}> = [];
await armSubject();
await arm(observer, rxObserver.port, OBSERVER_IFACE);
for (const step of study.steps as Step[]) {
	stepId = step.id;
	const rec: (typeof steps)[number] = { id: step.id, t: now(), commands: [] };
	for (const cmd of step.subject ?? [])
		rec.commands.push({ cmd, result: await execute(subject, cmd) });
	for (const cmd of step.observer ?? [])
		rec.commands.push({
			cmd: `observer: ${cmd}`,
			result: await execute(observer, cmd),
		});
	if (step.reboot) {
		// Wait for REST to come back, then re-arm the sniffer (it does not survive a reboot).
		const deadline = Date.now() + 180_000;
		await Bun.sleep(5_000);
		while (Date.now() < deadline) {
			try {
				await call(subject, "GET", "/system/identity");
				break;
			} catch {
				await Bun.sleep(2_000);
			}
		}
		await armSubject();
	}
	await Bun.sleep((step.wait ?? 8) * 1000);
	if (step.read) {
		rec.read = {};
		for (const p of step.read) rec.read[p] = await call(subject, "GET", p);
	}
	if (step.neighbor !== false) {
		const rows = (await call(observer, "GET", "/ip/neighbor")) as Array<
			Record<string, string>
		>;
		rec.neighbor = Array.isArray(rows)
			? rows.filter((r) =>
					subjectMacs.includes(r["mac-address"]?.toLowerCase()),
				)
			: rows;
	}
	steps.push(rec);
	const mine = seen.filter(
		(s) =>
			s.step === step.id &&
			s.via === "subject" &&
			subjectMacs.includes(s.srcMac),
	);
	console.log(
		`${step.id}: ${mine.length} subject announcements; last ${mine.at(-1)?.summary ?? "-"}`,
	);
}
await execute(subject, "/tool/sniffer/stop");
await execute(observer, "/tool/sniffer/stop");
rxSubject.close();
rxObserver.close();

await Bun.write(
	out,
	JSON.stringify(
		{
			study: studyName,
			date: new Date().toISOString(),
			subject: {
				name: subjectName,
				version: subjectRes["version"],
				arch: subjectRes["architecture-name"],
				board: subjectRes["board-name"],
				macs: subjectMacs,
			},
			observer: { name: observerName, version: observerRes["version"] },
			steps,
			announcements: seen,
		},
		null,
		"\t",
	),
);
console.log(`wrote ${out}: ${seen.length} announcements`);
