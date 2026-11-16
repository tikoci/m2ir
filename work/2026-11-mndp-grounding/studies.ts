/**
 * Study definitions for lab.ts. Each step changes one thing on the subject (or observer), waits,
 * and records announcements tagged with the step id. "Toggle" steps come in pairs (change, then
 * revert) so a TLV change can be attributed to one setting and shown to reverse.
 */
export interface Step {
	id: string;
	subject?: string[];
	observer?: string[];
	/** Seconds to wait after the commands (default 8). */
	wait?: number;
	/** Subject REST paths to GET after the wait (recorded with the step). */
	read?: string[];
	/** Read the observer's /ip/neighbor row for the subject (default true). */
	neighbor?: boolean;
	/** The step reboots the subject: wait for REST, then re-arm the sniffer. */
	reboot?: boolean;
}

export interface Study {
	sniff?: string;
	steps: Step[];
}

const toggle = (id: string, on: string, off: string, wait = 8): Step[] => [
	{ id: `${id}:on`, subject: [on], wait },
	{ id: `${id}:off`, subject: [off], wait },
];

// RouterOS 7.26beta5 rejects anything under 5s: "out of range (00:00:05 .. 09:06:07)".
const FAST = "/ip/neighbor/discovery-settings/set discover-interval=5s";

export const STUDIES: Record<string, Study> = {
	/** Baseline at defaults, then the per-setting toggles for TLV 14, 18 and 19. */
	probe: {
		steps: [
			{
				id: "baseline-default",
				wait: 35,
				read: [
					"/ip/neighbor/discovery-settings",
					"/ip/packing",
					"/tool/mac-server",
					"/tool/mac-server/mac-winbox",
					"/tool/mac-server/ping",
					"/tool/romon",
					"/tool/bandwidth-server",
					"/ip/service",
					"/ipv6/settings",
					"/system/device-mode",
					"/interface/wifi/capsman",
				],
			},
			{ id: "fast-interval", subject: [FAST], wait: 8 },
			// TLV 14: /ip/packing unpacking on the sending interface.
			{
				id: "packing:add-none",
				subject: [
					"/ip/packing/add interface=ether2 packing=none unpacking=none",
				],
				wait: 8,
				read: ["/ip/packing"],
			},
			{
				id: "packing:simple",
				subject: ["/ip/packing/set [find interface=ether2] unpacking=simple"],
				wait: 8,
			},
			{
				id: "packing:compress-headers",
				subject: [
					"/ip/packing/set [find interface=ether2] unpacking=compress-headers",
				],
				wait: 8,
			},
			{
				id: "packing:compress-all",
				subject: [
					"/ip/packing/set [find interface=ether2] unpacking=compress-all",
				],
				wait: 8,
			},
			{
				id: "packing:disabled",
				subject: ["/ip/packing/disable [find interface=ether2]"],
				wait: 8,
			},
			{
				id: "packing:removed",
				subject: ["/ip/packing/remove [find interface=ether2]"],
				wait: 8,
			},
			{
				id: "packing:other-iface-all",
				subject: [
					"/ip/packing/add interface=ether1 packing=none unpacking=compress-all",
				],
				wait: 8,
			},
			{
				id: "packing:other-iface-removed",
				subject: ["/ip/packing/remove [find interface=ether1]"],
				wait: 8,
			},
			// TLV 18: services that /ip/neighbor shows as running=.
			...toggle(
				"capsman",
				"/interface/wifi/capsman/set enabled=yes",
				"/interface/wifi/capsman/set enabled=no",
			),
			// TLV 19 candidates: L2 management services, then IP services, then other features.
			...toggle(
				"mac-server",
				"/tool/mac-server/set allowed-interface-list=none",
				"/tool/mac-server/set allowed-interface-list=all",
			),
			...toggle(
				"mac-winbox",
				"/tool/mac-server/mac-winbox/set allowed-interface-list=none",
				"/tool/mac-server/mac-winbox/set allowed-interface-list=all",
			),
			...toggle(
				"mac-ping",
				"/tool/mac-server/ping/set enabled=no",
				"/tool/mac-server/ping/set enabled=yes",
			),
			...toggle(
				"romon",
				"/tool/romon/set enabled=yes",
				"/tool/romon/set enabled=no",
			),
			...toggle(
				"btest",
				"/tool/bandwidth-server/set enabled=no",
				"/tool/bandwidth-server/set enabled=yes",
			),
			...toggle(
				"svc-winbox",
				"/ip/service/set winbox disabled=yes",
				"/ip/service/set winbox disabled=no",
			),
			...toggle(
				"svc-api",
				"/ip/service/set api disabled=yes",
				"/ip/service/set api disabled=no",
			),
			...toggle(
				"svc-ssh",
				"/ip/service/set ssh disabled=yes",
				"/ip/service/set ssh disabled=no",
			),
			...toggle(
				"svc-telnet",
				"/ip/service/set telnet disabled=yes",
				"/ip/service/set telnet disabled=no",
			),
			...toggle(
				"svc-ftp",
				"/ip/service/set ftp disabled=yes",
				"/ip/service/set ftp disabled=no",
			),
			...toggle(
				"svc-api-ssl",
				"/ip/service/set api-ssl disabled=yes",
				"/ip/service/set api-ssl disabled=no",
			),
			...toggle(
				"svc-www-ssl",
				"/ip/service/set www-ssl disabled=no",
				"/ip/service/set www-ssl disabled=yes",
			),
			...toggle(
				"ipv6",
				"/ipv6/settings/set disable-ipv6=yes",
				"/ipv6/settings/set disable-ipv6=no",
				12,
			),
			...toggle(
				"proto-mndp-only",
				"/ip/neighbor/discovery-settings/set protocol=mndp",
				"/ip/neighbor/discovery-settings/set protocol=cdp,lldp,mndp",
			),
			...toggle(
				"lldp-med",
				"/ip/neighbor/discovery-settings/set lldp-med=yes",
				"/ip/neighbor/discovery-settings/set lldp-med=no",
			),
			...toggle(
				"cloud-ddns",
				"/ip/cloud/set ddns-enabled=yes",
				"/ip/cloud/set ddns-enabled=no",
			),
			...toggle(
				"dns-remote",
				"/ip/dns/set allow-remote-requests=yes",
				"/ip/dns/set allow-remote-requests=no",
			),
			...toggle(
				"ip-forward",
				"/ip/settings/set ip-forward=no",
				"/ip/settings/set ip-forward=yes",
			),
			// Content changes, for the record.
			{
				id: "identity-utf8",
				subject: [`/system/identity/set name="mndp-ü-subject"`],
				wait: 8,
			},
			{
				id: "identity-restore",
				subject: ["/system/identity/set name=mndp-subject"],
				wait: 8,
			},
			// mode rx-only must stop announcements.
			{
				id: "mode:rx-only",
				subject: ["/ip/neighbor/discovery-settings/set mode=rx-only"],
				wait: 10,
			},
			{
				id: "mode:tx-and-rx",
				subject: ["/ip/neighbor/discovery-settings/set mode=tx-and-rx"],
				wait: 8,
			},
		],
	},
	/** TLV 19 candidates again at a 5 s interval, so every step sees periodic announcements. */
	tlv19: {
		steps: [
			{ id: "fast-interval", subject: [FAST], wait: 12 },
			...toggle(
				"mac-server",
				"/tool/mac-server/set allowed-interface-list=none",
				"/tool/mac-server/set allowed-interface-list=all",
				12,
			),
			...toggle(
				"mac-winbox",
				"/tool/mac-server/mac-winbox/set allowed-interface-list=none",
				"/tool/mac-server/mac-winbox/set allowed-interface-list=all",
				12,
			),
			...toggle(
				"mac-ping",
				"/tool/mac-server/ping/set enabled=no",
				"/tool/mac-server/ping/set enabled=yes",
				12,
			),
			...toggle(
				"romon",
				"/tool/romon/set enabled=yes",
				"/tool/romon/set enabled=no",
				12,
			),
			...toggle(
				"btest",
				"/tool/bandwidth-server/set enabled=no",
				"/tool/bandwidth-server/set enabled=yes",
				12,
			),
			...toggle(
				"svc-winbox",
				"/ip/service/set winbox disabled=yes",
				"/ip/service/set winbox disabled=no",
				12,
			),
			...toggle(
				"svc-www",
				"/ip/service/set www disabled=yes",
				"/ip/service/set www disabled=no",
				12,
			),
			...toggle(
				"svc-api",
				"/ip/service/set api disabled=yes",
				"/ip/service/set api disabled=no",
				12,
			),
			...toggle(
				"svc-ssh",
				"/ip/service/set ssh disabled=yes",
				"/ip/service/set ssh disabled=no",
				12,
			),
			...toggle(
				"svc-telnet",
				"/ip/service/set telnet disabled=yes",
				"/ip/service/set telnet disabled=no",
				12,
			),
			...toggle(
				"svc-ftp",
				"/ip/service/set ftp disabled=yes",
				"/ip/service/set ftp disabled=no",
				12,
			),
			...toggle(
				"svc-api-ssl",
				"/ip/service/set api-ssl disabled=yes",
				"/ip/service/set api-ssl disabled=no",
				12,
			),
			...toggle(
				"svc-www-ssl",
				"/ip/service/set www-ssl disabled=no",
				"/ip/service/set www-ssl disabled=yes",
				12,
			),
			...toggle(
				"lldp-med",
				"/ip/neighbor/discovery-settings/set lldp-med=no",
				"/ip/neighbor/discovery-settings/set lldp-med=yes",
				12,
			),
			...toggle(
				"proto-mndp-only",
				"/ip/neighbor/discovery-settings/set protocol=mndp",
				"/ip/neighbor/discovery-settings/set protocol=cdp,lldp,mndp",
				12,
			),
			...toggle(
				"cloud-ddns",
				"/ip/cloud/set ddns-enabled=yes",
				"/ip/cloud/set ddns-enabled=no",
				12,
			),
			...toggle(
				"dns-remote",
				"/ip/dns/set allow-remote-requests=yes",
				"/ip/dns/set allow-remote-requests=no",
				12,
			),
			...toggle(
				"ip-forward",
				"/ip/settings/set ip-forward=no",
				"/ip/settings/set ip-forward=yes",
				12,
			),
			...toggle(
				"bridge-ether2",
				"/interface/bridge/add name=br-lab",
				"/interface/bridge/remove [find name=br-lab]",
				12,
			),
			...toggle(
				"dhcp-server",
				"/ip/pool/add name=lab-pool ranges=192.0.2.100-192.0.2.110",
				"/ip/pool/remove [find name=lab-pool]",
				12,
			),
			{
				id: "packing:simple-1000",
				subject: [
					"/ip/packing/add interface=ether2 packing=none unpacking=simple aggregated-size=1000",
				],
				wait: 12,
				read: ["/ip/packing"],
			},
			{
				id: "packing:removed",
				subject: ["/ip/packing/remove [find interface=ether2]"],
				wait: 12,
			},
			{
				id: "packing:packing-only",
				subject: [
					"/ip/packing/add interface=ether2 packing=compress-all unpacking=none",
				],
				wait: 12,
			},
			{
				id: "packing:removed-2",
				subject: ["/ip/packing/remove [find interface=ether2]"],
				wait: 12,
			},
		],
	},
	/** TLV 19 = TTL hypothesis: TTL = discover-interval * 4 + 1. Values past 255 show the width. */
	ttl: {
		steps: [
			{
				id: "interval-5s",
				subject: ["/ip/neighbor/discovery-settings/set discover-interval=5s"],
				wait: 8,
			},
			{
				id: "interval-7s",
				subject: ["/ip/neighbor/discovery-settings/set discover-interval=7s"],
				wait: 10,
			},
			{
				id: "interval-60s",
				subject: ["/ip/neighbor/discovery-settings/set discover-interval=60s"],
				wait: 6,
			},
			{
				id: "interval-64s",
				subject: ["/ip/neighbor/discovery-settings/set discover-interval=64s"],
				wait: 6,
			},
			{
				id: "interval-300s",
				subject: ["/ip/neighbor/discovery-settings/set discover-interval=300s"],
				wait: 6,
			},
			{
				id: "interval-9h",
				subject: ["/ip/neighbor/discovery-settings/set discover-interval=9h"],
				wait: 6,
				read: ["/ip/neighbor/discovery-settings"],
			},
			{
				id: "interval-5s-again",
				subject: ["/ip/neighbor/discovery-settings/set discover-interval=5s"],
				wait: 8,
			},
		],
	},
	/**
	 * Age-out with LLDP and CDP excluded on both sides, so the observer's row can only come from
	 * MNDP. Answers whether expiry follows TLV 19 or LLDP's own TTL (the `ageout` rows were
	 * `discovered-by: lldp,mndp`). Neighbor rows carry `age` (time since the last announcement).
	 */
	"ageout-mndp": {
		steps: [
			{
				id: "mndp-only",
				subject: [
					"/ip/neighbor/discovery-settings/set protocol=mndp discover-interval=5s mode=tx-and-rx",
				],
				observer: ["/ip/neighbor/discovery-settings/set protocol=mndp"],
				wait: 10,
			},
			// Let any LLDP-learned part of the row lapse before the subject goes quiet.
			{ id: "mndp-only+130s", wait: 120 },
			{
				id: "5s:rx-only+12s",
				subject: ["/ip/neighbor/discovery-settings/set mode=rx-only"],
				wait: 12,
			},
			{ id: "5s:rx-only+16s", wait: 4 },
			{ id: "5s:rx-only+20s", wait: 4 },
			{ id: "5s:rx-only+24s", wait: 4 },
			{ id: "5s:rx-only+28s", wait: 4 },
			{ id: "5s:rx-only+40s", wait: 12 },
			{
				id: "30s:tx-and-rx",
				subject: [
					"/ip/neighbor/discovery-settings/set mode=tx-and-rx discover-interval=30s",
				],
				wait: 8,
			},
			{
				id: "30s:rx-only+110s",
				subject: ["/ip/neighbor/discovery-settings/set mode=rx-only"],
				wait: 110,
			},
			{ id: "30s:rx-only+118s", wait: 8 },
			{ id: "30s:rx-only+126s", wait: 8 },
			{ id: "30s:rx-only+134s", wait: 8 },
			{ id: "30s:rx-only+142s", wait: 8 },
			{ id: "30s:rx-only+150s", wait: 8 },
			// The 30 s expiry removed the row, so this 5 s phase starts from a row only MNDP created.
			{
				id: "5s-clean:tx-and-rx",
				subject: [
					"/ip/neighbor/discovery-settings/set mode=tx-and-rx discover-interval=5s",
				],
				wait: 10,
			},
			{
				id: "5s-clean:rx-only+12s",
				subject: ["/ip/neighbor/discovery-settings/set mode=rx-only"],
				wait: 12,
			},
			{ id: "5s-clean:rx-only+16s", wait: 4 },
			{ id: "5s-clean:rx-only+20s", wait: 4 },
			{ id: "5s-clean:rx-only+24s", wait: 4 },
			{ id: "5s-clean:rx-only+28s", wait: 4 },
			{
				id: "restore",
				subject: [
					"/ip/neighbor/discovery-settings/set protocol=cdp,lldp,mndp mode=tx-and-rx discover-interval=30s",
				],
				observer: [
					"/ip/neighbor/discovery-settings/set protocol=cdp,lldp,mndp",
				],
				wait: 8,
			},
		],
	},
	/** Does the receiver honour TLV 19? TTL 21 s at a 5 s interval, then stop announcing (rx-only). */
	ageout: {
		steps: [
			{
				id: "interval-5s",
				subject: ["/ip/neighbor/discovery-settings/set discover-interval=5s"],
				wait: 8,
			},
			{
				id: "rx-only+10s",
				subject: ["/ip/neighbor/discovery-settings/set mode=rx-only"],
				wait: 10,
			},
			{ id: "rx-only+20s", wait: 10 },
			{ id: "rx-only+30s", wait: 10 },
			{
				id: "tx-and-rx",
				subject: ["/ip/neighbor/discovery-settings/set mode=tx-and-rx"],
				wait: 8,
			},
			{
				id: "interval-60s",
				subject: ["/ip/neighbor/discovery-settings/set discover-interval=60s"],
				wait: 4,
			},
			{
				id: "60s:rx-only+30s",
				subject: ["/ip/neighbor/discovery-settings/set mode=rx-only"],
				wait: 30,
			},
			{ id: "60s:rx-only+130s", wait: 100 },
			{ id: "60s:rx-only+250s", wait: 120 },
			{
				id: "restore",
				subject: [
					"/ip/neighbor/discovery-settings/set mode=tx-and-rx discover-interval=5s",
				],
				wait: 8,
			},
			// TLV 9 and the packing direction.
			{
				id: "packing:simple-1000",
				subject: [
					"/ip/packing/add interface=ether2 packing=none unpacking=simple aggregated-size=1000",
				],
				wait: 8,
				read: ["/ip/packing"],
			},
			{
				id: "packing:removed",
				subject: ["/ip/packing/remove [find interface=ether2]"],
				wait: 8,
			},
			{
				id: "packing:packing-only",
				subject: [
					"/ip/packing/add interface=ether2 packing=compress-all unpacking=none",
				],
				wait: 8,
			},
			{
				id: "packing:removed-2",
				subject: ["/ip/packing/remove [find interface=ether2]"],
				wait: 8,
			},
		],
	},
	/** Age-out timing, read every 5 s: TTL 21 s (5 s interval), then TTL 121 s (30 s interval). */
	ageout2: {
		steps: [
			{
				id: "i5:steady",
				subject: [
					"/ip/neighbor/discovery-settings/set mode=tx-and-rx discover-interval=5s",
				],
				wait: 12,
			},
			{
				id: "i5:rx-only",
				subject: ["/ip/neighbor/discovery-settings/set mode=rx-only"],
				wait: 1,
			},
			...Array.from({ length: 12 }, (_, i) => ({
				id: `i5:+${(i + 1) * 5}s`,
				wait: 5,
			})),
			{
				id: "i30:steady",
				subject: [
					"/ip/neighbor/discovery-settings/set mode=tx-and-rx discover-interval=30s",
				],
				wait: 35,
			},
			{
				id: "i30:rx-only",
				subject: ["/ip/neighbor/discovery-settings/set mode=rx-only"],
				wait: 1,
			},
			...Array.from({ length: 36 }, (_, i) => ({
				id: `i30:+${(i + 1) * 5}s`,
				wait: 5,
			})),
			{
				id: "restore",
				subject: [
					"/ip/neighbor/discovery-settings/set mode=tx-and-rx discover-interval=5s",
				],
				wait: 8,
			},
		],
	},
	/** Push the header counter past 255. Not run: 7.26beta5's 5 s minimum makes it ~22 min. */
	counter: {
		steps: [
			{
				id: "interval-5s",
				subject: ["/ip/neighbor/discovery-settings/set discover-interval=5s"],
				wait: 1300,
				read: ["/ip/neighbor/discovery-settings", "/system/resource"],
				neighbor: true,
			},
			{
				id: "interval-restore",
				subject: ["/ip/neighbor/discovery-settings/set discover-interval=30s"],
				wait: 2,
			},
		],
	},
	/** dying-gasp=yes, then reboot: capture the last announcement before the reboot. */
	"dying-gasp": {
		steps: [
			{ id: "dg-off-baseline", subject: [FAST], wait: 8 },
			{
				id: "dg-on",
				subject: ["/ip/neighbor/discovery-settings/set dying-gasp=yes"],
				wait: 8,
			},
			{
				id: "dg-reboot",
				subject: [":execute {/system/reboot}"],
				wait: 15,
				reboot: true,
			},
			{ id: "dg-after", wait: 10 },
		],
	},
	/** Just the defaults: for version sweeps (no changes). */
	baseline: {
		steps: [
			{
				id: "baseline-default",
				wait: 65,
				read: ["/ip/neighbor/discovery-settings", "/ip/packing"],
			},
		],
	},
};
