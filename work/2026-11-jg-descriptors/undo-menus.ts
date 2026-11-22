// cspell:ignore quickchr restraml psk
/**
 * Menu selection for the [17] undo-history oracle (plan step 4b, q2/q3).
 *
 *   bun undo-menus.ts survey --deep-inspect <restraml>/docs/7.25/deep-inspect.json \
 *       --quickchr <name> --out <survey.json>
 *
 * The CLI tree comes from restraml's deep-inspect.json (/console/inspect
 * of the same RouterOS version). A menu is a candidate when it has a
 * `set` command: a singleton when `set` takes no `numbers`, a table
 * otherwise. The survey reads each candidate once over REST (read-only)
 * and records whether the menu exists on the CHR and how many rows it has.
 *
 * Safety rules (q2), applied before any write:
 * - SECRET_ARG: an argument whose value is a credential. The oracle never
 *   writes it, and the fixture and report redact its value wherever it
 *   appears (S9, Sa, m1, m2).
 * - SKIP_MENUS: whole menus left out, because a full-record inverse
 *   (remove, or a handler that sends the whole record on SET, like /snmp)
 *   would carry a credential, or because a write has side effects even
 *   when the value is unchanged.
 * - SKIP_ARGS: arguments never written (clock, actions, row identity).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { centrsExec, restRows } from "./undo-lib.ts";

/** Credential-valued argument names (values redacted, never written). */
export const SECRET_ARG =
	/(^|-)(password|passphrase|secret|secrets|psk|token|community)$|(^|-)(private|preshared|pre-shared|auth|shared|encryption|authentication)-(key|password|secret)$|^(key|private-key|pre-shared-key|preshared-key|ipsec-secret|radius-password|trap-community|wpa2?-pre-shared-key)$/;

/** Menus never written by the oracle, with the reason. */
export const SKIP_MENUS: Record<string, string> = {
	"/user": "credentials (password); session identity",
	"/user/group": "policy changes can lock the session out",
	"/user/settings": "password policy",
	"/user/aaa": "RADIUS login path",
	"/user/ssh-keys": "public keys tied to users",
	"/ppp/secret": "credentials (password)",
	"/snmp/community":
		"credentials (authentication/encryption passwords, community name)",
	"/radius": "shared secret",
	"/tool/e-mail": "password",
	"/tool/romon": "secrets",
	"/tool/sms": "secret",
	"/system/package/local-update/mirror": "password",
	"/interface/wireguard": "private-key (an [20,0] interface anyway)",
	"/interface/wireguard/peers": "preshared-key, private-key",
	"/ip/ipsec/identity": "secret, certificates",
	"/ip/ipsec/peer": "secret via identity; keep IPsec out",
	"/ip/hotspot/user": "password",
	"/ip/smb/users": "password",
	"/interface/wifi/security": "passphrase",
	"/certificate": "private keys",
	"/certificate/settings": "CRL / CA behaviour",
	"/ip/ssh": "host key handling (regenerate on some writes)",
	"/ip/service": "a write can restart the service the lab uses (REST, WinBox)",
	"/ip/service/webserver": "REST lives on www",
	"/system/clock": "time (wall clock moves)",
	"/system/clock/manual": "time zone and DST rules",
	"/system/identity": "already modeled ([24,1]); machine name in fixtures",
	"/system/package/update": "channel change triggers a check",
	"/system/watchdog": "can reboot the CHR",
	"/disk/settings": "storage",
	"/interface/l2tp-server/server": "ipsec-secret",
	"/ip/dhcp-server/config": "radius-password",
	"/ip/cloud": "contacts MikroTik's DDNS service",
	"/ip/cloud/advanced": "contacts MikroTik's DDNS service",
	"/tool/mac-server/mac-winbox": "lab access path",
	"/tool/mac-server": "lab access path",
	"/system/console/screen": "console",
	"/console/settings": "console",
};

/** Arguments never written (identity, clock, actions). */
export const SKIP_ARGS =
	/^(numbers|number|\.id|name|time|date|time-zone-name|copy-from|place-before)$/;

/**
 * One oracle target. `singleton`: no-op SET of every settable property.
 * `row`: the same on an existing table row picked by `find` (REST print
 * filter, e.g. "name=ftp"; default the first static row). `add`: add a
 * row with `add` (disabled where possible, documentation addresses),
 * no-op SET its properties, then remove it, so the remove's inverse
 * carries the full record.
 */
export type MenuPlan = {
	path: string;
	how: "singleton" | "row" | "add";
	add?: string[];
	find?: string;
	/** Already modeled in gui-handlers.yaml: run as a control. */
	control?: string;
};

/** Wave 1 (7.25): 34 menus across singletons, existing rows and added rows. */
export const WAVE1: MenuPlan[] = [
	// singletons
	{ path: "/ip/dns", how: "singleton" },
	{ path: "/ip/settings", how: "singleton" },
	{ path: "/ipv6/settings", how: "singleton" },
	{ path: "/ip/firewall/connection/tracking", how: "singleton" },
	{ path: "/ip/proxy", how: "singleton" },
	{ path: "/ip/socks", how: "singleton" },
	{ path: "/ip/upnp", how: "singleton" },
	{ path: "/ip/traffic-flow", how: "singleton" },
	{ path: "/ip/smb", how: "singleton" },
	{
		path: "/ip/neighbor/discovery-settings",
		how: "singleton",
		control: "[20, 17]",
	},
	{ path: "/routing/settings", how: "singleton" },
	{ path: "/system/ntp/client", how: "singleton" },
	{ path: "/system/note", how: "singleton" },
	{ path: "/tool/bandwidth-server", how: "singleton" },
	{ path: "/tool/graphing", how: "singleton" },
	{ path: "/tool/sniffer", how: "singleton" },
	{ path: "/ipv6/nd/settings", how: "singleton" },
	{ path: "/interface/detect-internet", how: "singleton" },
	{ path: "/interface/bridge/settings", how: "singleton" },
	{ path: "/snmp", how: "singleton" },
	// existing rows
	{ path: "/ip/firewall/service-port", how: "row", find: "name=ftp" },
	{ path: "/queue/type", how: "row", find: "name=default" },
	{ path: "/system/logging/action", how: "row", find: "name=memory" },
	{ path: "/ppp/profile", how: "row", find: "name=default" },
	{ path: "/ip/ipsec/proposal", how: "row", find: "name=default" },
	// added rows
	{
		path: "/ip/firewall/address-list",
		how: "add",
		add: ["list=m2ir", "address=192.0.2.1", "comment=m2ir"],
	},
	{
		path: "/ip/dns/static",
		how: "add",
		add: [
			"name=m2ir.test",
			"address=192.0.2.5",
			"disabled=yes",
			"comment=m2ir",
		],
	},
	{
		path: "/ip/pool",
		how: "add",
		add: ["name=m2ir-pool", "ranges=192.0.2.100-192.0.2.110", "comment=m2ir"],
	},
	{
		path: "/queue/simple",
		how: "add",
		add: [
			"name=m2ir-q",
			"target=192.0.2.0/24",
			"max-limit=1M/2M",
			"disabled=yes",
			"comment=m2ir",
		],
	},
	{
		path: "/ip/firewall/mangle",
		how: "add",
		add: [
			"chain=prerouting",
			"action=passthrough",
			"disabled=yes",
			"comment=m2ir",
		],
	},
	{
		path: "/system/scheduler",
		how: "add",
		add: ["name=m2ir-job", "interval=1d", "disabled=yes", "comment=m2ir"],
	},
	{
		path: "/tool/netwatch",
		how: "add",
		add: ["host=192.0.2.1", "disabled=yes", "comment=m2ir"],
	},
	{
		path: "/ipv6/firewall/address-list",
		how: "add",
		add: ["list=m2ir", "address=2001:db8::1/128", "comment=m2ir"],
	},
	{
		path: "/ip/arp",
		how: "add",
		add: [
			"address=192.0.2.9",
			"mac-address=02:00:00:00:00:09",
			"interface=ether1",
			"disabled=yes",
			"comment=m2ir",
		],
	},
];

export type CliMenu = {
	path: string;
	kind: "singleton" | "table";
	setArgs: string[];
	addArgs: string[];
	secretArgs: string[];
	completions: Record<string, string[]>;
};

type Node = { _type?: string; [k: string]: unknown };

/** Every menu with a `set` command in a deep-inspect tree. */
export function cliMenus(deepInspectPath: string): Map<string, CliMenu> {
	const root = JSON.parse(readFileSync(deepInspectPath, "utf8")) as Node;
	const out = new Map<string, CliMenu>();
	const argsOf = (cmd: unknown) =>
		Object.entries((cmd ?? {}) as Record<string, Node>)
			.filter(([, x]) => typeof x === "object" && x?._type === "arg")
			.map(([a]) => a);
	const walk = (n: Node, path: string) => {
		for (const [k, v] of Object.entries(n)) {
			if (typeof v !== "object" || v === null) continue;
			const child = v as Node;
			if (child._type !== "dir" && child._type !== "path") continue;
			const p = `${path}/${k}`;
			const set = child["set"] as Node | undefined;
			if (set?._type === "cmd") {
				const setArgs = argsOf(set);
				const completions: Record<string, string[]> = {};
				for (const a of setArgs) {
					const c = (set[a] as Node)["_completion"];
					if (c && typeof c === "object")
						completions[a] = Object.keys(c as object);
				}
				out.set(p, {
					path: p,
					kind: setArgs.includes("numbers") ? "table" : "singleton",
					setArgs,
					addArgs: argsOf(child["add"]),
					secretArgs: setArgs.filter((a) => SECRET_ARG.test(a)),
					completions,
				});
			}
			walk(child, p);
		}
	};
	walk(root, "");
	return out;
}

export type SurveyRow = {
	path: string;
	kind: CliMenu["kind"];
	present: boolean;
	rows: number | null;
	/** Table rows that are neither dynamic nor builtin (safe no-op SET targets). */
	staticRows: number | null;
	setArgs: number;
	secretArgs: string[];
	skip: string | null;
	error?: string;
};

if (import.meta.main) {
	const argv = process.argv.slice(2);
	const opt = (n: string) => {
		const i = argv.indexOf(n);
		return i >= 0 ? argv[i + 1] : undefined;
	};
	const di = opt("--deep-inspect");
	const machine = opt("--quickchr");
	const out = opt("--out");
	if (argv[0] !== "survey" || !di || !machine || !out) {
		console.error(
			"usage: undo-menus.ts survey --deep-inspect <file> --quickchr <name> --out <file>",
		);
		process.exit(2);
	}
	const rows: SurveyRow[] = [];
	for (const m of cliMenus(di).values()) {
		const r = centrsExec(machine, [`${m.path}/print`]);
		const list = m.kind === "table" ? restRows(r.data) : null;
		rows.push({
			path: m.path,
			kind: m.kind,
			present: r.ok,
			rows: list ? list.length : restRows(r.data).length,
			staticRows: list
				? list.filter((x) => x["dynamic"] !== "true" && x["builtin"] !== "true")
						.length
				: null,
			setArgs: m.setArgs.length,
			secretArgs: m.secretArgs,
			skip: SKIP_MENUS[m.path] ?? null,
			...(r.ok ? {} : { error: r.error?.slice(0, 160) }),
		});
	}
	writeFileSync(out, `${JSON.stringify(rows, null, "\t")}\n`);
	const present = rows.filter((r) => r.present);
	console.log(
		`survey: ${rows.length} menus, ${present.length} present, ${present.filter((r) => r.kind === "singleton").length} singletons, ${present.filter((r) => (r.staticRows ?? 0) > 0).length} tables with static rows`,
	);
}
