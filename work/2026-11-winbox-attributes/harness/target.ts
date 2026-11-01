// Phase B harness: explicit target/version checks and mutation opt-in.
//
// Live traffic stays in the native harness; validated CLI/REST control
// operations go through centrs. Mutations require an explicit gate:
// disposable lab instance AND caller opt-in, otherwise throw.
import { resolveQuickchr } from "../../2026-10-chr-extraction/ws3c/probe.ts";

export interface MutationGate {
	allowMutations: boolean;
	disposable: boolean;
}

/** Throw unless both mutation conditions hold. No silent writes. */
export function requireMutationGate(gate: MutationGate, what: string): void {
	if (!gate.allowMutations || !gate.disposable) {
		throw new Error(
			`refusing ${what}: mutations need { allowMutations: true, disposable: true } ` +
				`(got allowMutations=${gate.allowMutations} disposable=${gate.disposable})`,
		);
	}
}

export interface LabTarget {
	host: string;
	port: number;
	user: string;
	/** Password is resolved, never printed or logged. */
	pass: string;
	quickchrName: string;
	version: string;
}

export interface TargetOptions {
	/** Exact RouterOS versions allowed (e.g. ["7.25"]); null = any. */
	allowedVersions?: string[];
}

interface QuickchrListEntry {
	name?: unknown;
	version?: unknown;
}

/**
 * Resolve a quickchr machine to a WinBox target, checking the exact
 * RouterOS version when allowedVersions is set. Version mismatch is
 * an explicit failure naming the actual version.
 */
export function resolveLabTarget(
	name: string,
	opts?: TargetOptions,
): LabTarget {
	const t = resolveQuickchr(name);
	let version = "unknown";
	try {
		const r = Bun.spawnSync(["quickchr", "list", "--json"]);
		if (r.success) {
			const list = JSON.parse(r.stdout.toString()) as QuickchrListEntry[];
			const hit = Array.isArray(list)
				? list.find((x) => x.name === name)
				: undefined;
			if (typeof hit?.version === "string") version = hit.version;
		}
	} catch {
		// Version lookup failure is not fatal here; the mismatch check
		// below treats "unknown" as not-allowed when a list is set.
	}
	if (opts?.allowedVersions && !opts.allowedVersions.includes(version)) {
		throw new Error(
			`target ${name} runs RouterOS ${version}, want one of ${opts.allowedVersions.join(", ")}`,
		);
	}
	return { ...t, quickchrName: name, version };
}
