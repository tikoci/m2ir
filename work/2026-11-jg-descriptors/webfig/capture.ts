// cspell:ignore webfig jsproxy quickchr typevalue
/**
 * Plan step 3: record the plaintext M2 that MikroTik's own WebFig client
 * exchanges, by running it in headless Chromium with hook.js above the
 * /jsproxy cipher.
 *
 *   bun capture.ts <quickchr-name> <out-dir> [--explore] [--headed]
 *
 * Writes <out-dir>/raw.jsonl (hook events, unsanitized: the login message
 * carries the password and the reply a session token; keep it in scratch)
 * and <out-dir>/meta.json (RouterOS build, WebFig asset hashes, .jg unique
 * names, lab object ids). transcript.ts turns these into a sanitized
 * fixture. --explore logs in and prints the menu hashes only.
 *
 * Lab: needs a running disposable quickchr CHR. The Bridge scenario
 * creates bridge m2ir-br and VLAN m2ir-vl (vlan-id 3999 on ether1) as its
 * port through REST, changes their comments from that second session, and
 * removes them at the end. Browser: CHROME_PATH, else /usr/bin/chromium,
 * else Playwright's own download.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright-core";

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const [chrName, outDir] = args.filter((a) => !a.startsWith("--"));
if (!chrName || !outDir) {
	console.error(
		"usage: bun capture.ts <quickchr-name> <out-dir> [--explore] [--headed]",
	);
	process.exit(2);
}

// ── lab target ──────────────────────────────────────────────────────────

interface Lab {
	base: string;
	user: string;
	pass: string;
	version: string;
}
function quickchrJson(cmd: string[]): unknown {
	const r = Bun.spawnSync(["quickchr", ...cmd]);
	if (!r.success)
		throw new Error(`quickchr ${cmd.join(" ")}: ${r.stderr.toString()}`);
	return JSON.parse(r.stdout.toString());
}
function resolveLab(name: string): Lab {
	const insp = quickchrJson(["inspect", name, "--json"]) as {
		version?: string;
		status?: string;
		services?: Record<
			string,
			{ host?: number; auth?: { username?: string; password?: string } }
		>;
	};
	const list = quickchrJson(["list", "--json"]) as {
		name: string;
		ports?: Record<string, { host?: number }>;
	}[];
	const port = list.find((m) => m.name === name)?.ports?.["http"]?.host;
	const auth = insp.services?.["rest-api"]?.auth;
	if (typeof port !== "number")
		throw new Error(`quickchr ${name}: no http port (is it running?)`);
	if (typeof auth?.username !== "string" || typeof auth.password !== "string") {
		throw new Error(`quickchr ${name}: no rest-api auth in inspect output`);
	}
	return {
		base: `http://127.0.0.1:${port}`,
		user: auth.username,
		pass: auth.password,
		version: insp.version ?? "unknown",
	};
}
const lab = resolveLab(chrName);

async function rest(
	method: string,
	path: string,
	body?: unknown,
): Promise<unknown> {
	const r = await fetch(`${lab.base}/rest${path}`, {
		method,
		headers: {
			authorization: `Basic ${btoa(`${lab.user}:${lab.pass}`)}`,
			"content-type": "application/json",
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const text = await r.text();
	if (!r.ok)
		throw new Error(`REST ${method} ${path}: HTTP ${r.status} ${text}`);
	return text ? JSON.parse(text) : null;
}
type Row = Record<string, string>;
async function findOne(path: string, name: string): Promise<Row | undefined> {
	const rows = (await rest(
		"GET",
		`${path}?name=${encodeURIComponent(name)}`,
	)) as Row[];
	return rows[0];
}
/** REST ".id" "*1A" -> numeric row id as WebFig's ufe0001 carries it. */
const rowId = (row: Row) => Number.parseInt((row[".id"] ?? "").slice(1), 16);

// ── assets ──────────────────────────────────────────────────────────────

async function assetMeta(): Promise<Record<string, string>> {
	const html = await (await fetch(`${lab.base}/webfig/`)).text();
	const out: Record<string, string> = {};
	for (const [, src] of html.matchAll(/src="([^"]+\.js)"/g)) {
		const url = new URL(src as string, `${lab.base}/webfig/`);
		const body = new Uint8Array(await (await fetch(url)).arrayBuffer());
		out[url.pathname] = createHash("sha256").update(body).digest("hex");
	}
	return out;
}

// ── browser ─────────────────────────────────────────────────────────────

mkdirSync(outDir, { recursive: true });
const rawPath = join(outDir, "raw.jsonl");
const rawLines: string[] = [];
const fetched = new Set<string>();

function chromePath(): string | undefined {
	if (process.env["CHROME_PATH"]) return process.env["CHROME_PATH"];
	return existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined;
}

const browser = await chromium.launch({
	executablePath: chromePath(),
	headless: !flags.has("--headed"),
});
const context = await browser.newContext({
	viewport: { width: 1400, height: 900 },
});
await context.exposeBinding("__m2irEmit", (_src, ev: unknown) => {
	rawLines.push(JSON.stringify(ev));
});
// WebFig's autoLogin() reads sessionStorage name/password, logs in, then
// clears them; seed them so no form is driven.
await context.addInitScript(
	({ user, pass }) => {
		sessionStorage.setItem("name", user);
		sessionStorage.setItem("password", pass);
	},
	{ user: lab.user, pass: lab.pass },
);
await context.addInitScript({
	content: readFileSync(new URL("./hook.js", import.meta.url), "utf8"),
});
const page = await context.newPage();
page.on("request", (req) => {
	const u = new URL(req.url());
	if (u.pathname.startsWith("/webfig/") || u.pathname.startsWith("/assets/")) {
		fetched.add(u.pathname);
	}
});
page.on("pageerror", (e) =>
	rawLines.push(JSON.stringify({ k: "page-error", err: String(e) })),
);

// Browser-side code is passed as strings: tsconfig has no DOM lib.
const mark = (label: string, extra?: Record<string, unknown>) =>
	page.evaluate(
		`window.__m2irMark(${JSON.stringify(label)}, ${JSON.stringify(extra ?? {})})`,
	);
const pause = (ms: number) => page.waitForTimeout(ms);

async function login(p: Page) {
	await p.goto(`${lab.base}/webfig/`);
	// start() fills #identity from the [24,0] identity subscription.
	await p.waitForFunction(
		'(document.getElementById("identity")?.textContent ?? "").length > 0',
		null,
		{
			timeout: 30_000,
		},
	);
}

async function go(hash: string, label: string, wait: number) {
	await mark(`open ${label}`, { hash });
	await page.evaluate(`location.hash = ${JSON.stringify(hash)}`);
	await pause(wait);
}

const meta: Record<string, unknown> = {
	routeros_version: lab.version,
	chr: chrName,
	captured: new Date().toISOString(),
	browser: browser.version(),
	assets_sha256: await assetMeta(),
};

try {
	await login(page);
	await pause(2000);
	if (flags.has("--explore")) {
		const links = await page.evaluate<string[]>(
			`[...document.querySelectorAll("a[href^='#']")].map((a) => a.getAttribute("href") + "\\t" + a.textContent.trim())`,
		);
		console.log([...new Set(links)].join("\n"));
		const at = process.env["M2IR_EXPLORE_HASH"];
		if (at) {
			await go(at, at, 4000);
			const inner = await page.evaluate<string[]>(
				`[...document.querySelectorAll("#content a, #content [role=tab], main a, main [role=tab]")].map(
					(a) => (a.getAttribute("href") ?? "") + "\\t" + (a.getAttribute("role") ?? "") + "\\t" + a.textContent.trim())`,
			);
			console.log(`-- inside ${at}:\n${[...new Set(inner)].join("\n")}`);
			const click = process.env["M2IR_EXPLORE_CLICK"];
			if (click) {
				await mark(`click ${click}`);
				await page.locator(click).first().click();
				await pause(6000);
				console.log(
					`-- after click: ${await page.evaluate<string>("location.hash")}`,
				);
			}
			await page.screenshot({ path: join(outDir, "explore.png") });
		}
	} else {
		await bridgeScenario();
	}
} finally {
	meta["fetched"] = [...fetched].sort();
	writeFileSync(rawPath, `${rawLines.join("\n")}\n`);
	writeFileSync(
		join(outDir, "meta.json"),
		`${JSON.stringify(meta, null, "\t")}\n`,
	);
	await browser.close();
	console.log(`${rawLines.length} events -> ${rawPath}`);
}

// ── Bridge workflow (plan.md step 3) ────────────────────────────────────

async function bridgeScenario() {
	// Lab objects through REST (the second session).
	for (const [path, name] of [
		["/interface/bridge/port", "m2ir-vl"],
		["/interface/vlan", "m2ir-vl"],
		["/interface/bridge", "m2ir-br"],
	] as const) {
		const rows = (await rest("GET", path)) as Row[];
		for (const r of rows.filter(
			(x) => x["name"] === name || x["interface"] === name,
		)) {
			await rest("DELETE", `${path}/${r[".id"]}`);
		}
	}
	await rest("PUT", "/interface/bridge", {
		name: "m2ir-br",
		comment: "step3-a",
	});
	await rest("PUT", "/interface/vlan", {
		name: "m2ir-vl",
		interface: "ether1",
		"vlan-id": "3999",
	});
	await rest("PUT", "/interface/bridge/port", {
		bridge: "m2ir-br",
		interface: "m2ir-vl",
		comment: "port-a",
	});
	const br = await findOne("/interface/bridge", "m2ir-br");
	const ports = (await rest("GET", "/interface/bridge/port")) as Row[];
	const port = ports.find((p) => p["interface"] === "m2ir-vl");
	if (!br || !port)
		throw new Error("lab setup: bridge or port missing after create");
	meta["lab_rows"] = {
		"bridge m2ir-br [20,0] ufe0001": rowId(br),
		"port m2ir-vl [16,2] ufe0001": rowId(port),
	};
	await pause(1000);
	await mark("lab ready", meta["lab_rows"] as Record<string, unknown>);

	// WebFig tab hashes (7.25; check with --explore on other builds). "away"
	// is a page that does not use [20,0] or [16,2].
	const hashes = {
		bridge: "#Bridge.Bridge",
		ports: "#Bridge.Ports",
		away: "#System:Clock",
	};

	// 1-4: Bridge list, then a comment change from REST.
	await go(hashes.bridge, "Bridge", 5000);
	await mark("rest set bridge comment", { value: "step3-b" });
	await rest("PATCH", `/interface/bridge/${br[".id"]}`, { comment: "step3-b" });
	await pause(6000);

	// Bridge Ports ([16,2], autorefresh 2000): watch at least 3 periods.
	await go(hashes.ports, "Bridge Ports", 7000);
	await mark("rest set port comment", { value: "port-b" });
	await rest("PATCH", `/interface/bridge/port/${port[".id"]}`, {
		comment: "port-b",
	});
	await pause(7000);

	// 5: close (navigate away) and reopen.
	await go(hashes.away, "away (close Bridge Ports)", 4000);
	await go(hashes.ports, "Bridge Ports (reopen)", 5000);
	await go(hashes.bridge, "Bridge (reopen)", 4000);
	await mark("rest set bridge comment while open", { value: "step3-c" });
	await rest("PATCH", `/interface/bridge/${br[".id"]}`, { comment: "step3-c" });
	await pause(5000);
	await go(hashes.away, "away (close Bridge)", 3000);
	// No CMD_UNSUBSCRIBE was seen on close in the first 7.25 run: does the
	// router still notify for pages WebFig has left?
	await mark("rest set comments while closed", {
		bridge: "step3-d",
		port: "port-c",
	});
	await rest("PATCH", `/interface/bridge/${br[".id"]}`, { comment: "step3-d" });
	await rest("PATCH", `/interface/bridge/port/${port[".id"]}`, {
		comment: "port-c",
	});
	await pause(6000);
	// Removal: expect rows flagged ufe0013 (STD_DEAD) in notifications.
	await go(hashes.ports, "Bridge Ports (before remove)", 3000);
	await mark("rest remove port, vlan, bridge");
	for (const [path, id] of [
		["/interface/bridge/port", port[".id"]],
		["/interface/vlan", (await findOne("/interface/vlan", "m2ir-vl"))?.[".id"]],
		["/interface/bridge", br[".id"]],
	] as const) {
		if (id) await rest("DELETE", `${path}/${id}`);
	}
	await pause(6000);
	await go(hashes.away, "away", 1000);
	// Quiet period: how long does the notification long poll hold?
	await mark("quiet");
	await pause(Number(process.env["M2IR_QUIET_MS"] ?? 45000));
	await mark("end");
}
