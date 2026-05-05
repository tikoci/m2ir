import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseDocument } from "yaml";

import { findRepoRoot } from "./repo-paths.ts";

type JsonLike =
	| null
	| boolean
	| number
	| string
	| JsonLike[]
	| { [key: string]: JsonLike };

type JsonObject = { [key: string]: JsonLike };

type TcodeValue = number | string;

export interface DissectorValueEntry {
	value: number;
	hex: string;
	name: string;
	confidence?: string;
	notes?: string;
}

export interface DissectorField {
	fullKey: number;
	hex: string;
	name: string;
	abbrev: string;
	namespace: string;
	namespaceByte: number;
	semantic?: string;
	role?: string;
	tcodes: TcodeValue[];
	aliases: string[];
	valueTables: string[];
}

export interface DissectorValueTables {
	namespaces: DissectorValueEntry[];
	tcodes: DissectorValueEntry[];
	chunk_tags: DissectorValueEntry[];
	std_commands: DissectorValueEntry[];
	std_errors: DissectorValueEntry[];
	processes: DissectorValueEntry[];
	legacy_short_form: DissectorValueEntry[];
	handler_private: DissectorValueEntry[];
	[key: string]: DissectorValueEntry[] | undefined;
}

export interface DissectorCommandFieldRef {
	key: number;
	hex: string;
	name?: string;
	role?: string;
	tcodes?: TcodeValue[];
}

export interface DissectorCommandEntry {
	value: number;
	hex: string;
	name: string;
	confidence?: string;
	encodingTcodes: TcodeValue[];
	processId?: number;
	processName?: string;
	handlerId?: number;
	versionScope?: string;
	args: DissectorCommandFieldRef[];
	response: DissectorCommandFieldRef[];
	notes?: string;
}

export interface DissectorCommandSpace {
	id: string;
	name: string;
	scope: "global" | "handler";
	handlerPath?: {
		processId?: number;
		handlerId?: number;
		versionScope?: string;
	};
	commands: DissectorCommandEntry[];
}

export interface DissectorOpenQuestion {
	file: string;
	path: string;
	question: string;
}

export interface WinboxDissectorShape {
	profile: {
		id: string;
		title: string;
		classificationField: number;
		classificationFieldName: string;
	};
	transport: {
		chunkTags: DissectorValueEntry[];
	};
	physical: {
		tcodes: DissectorValueEntry[];
		compactPairs: Array<{ wide: number; compact: number; kind: string }>;
	};
	fields: DissectorField[];
	valueTables: DissectorValueTables;
	commandSpaces: DissectorCommandSpace[];
	handshakeMessages: Array<{
		name: string;
		direction?: string;
		phase?: number;
		role?: string;
		confidence?: string;
	}>;
	openQuestions: DissectorOpenQuestion[];
	summary: {
		fieldCount: number;
		valueTableCount: number;
		commandSpaceCount: number;
		commandCount: number;
		handshakeMessageCount: number;
		openQuestionCount: number;
	};
}

interface WinboxProfileDoc {
	id: string;
	title: string;
	"physical-ref": string;
	classification: {
		"target-field": number;
		"target-name": string;
	};
	namespaces?: Record<string, { name?: string }>;
	"compact-pairs"?: Array<{ wide: number; compact: number; kind: string }>;
	refs: Record<string, string>;
}

interface WinboxKeysDoc {
	keys: Record<
		string,
		{
			"canonical-name": string;
			physical?: { tcodes?: TcodeValue[] };
			semantic?: string;
			role?: string;
			values?: Record<string, string>;
			aliases?: Array<{ name?: string }> | Array<string>;
			notes?: string;
			confidence?: string;
		}
	>;
}

interface StdCommandsDoc {
	commands: Record<
		string,
		{
			"canonical-name": string;
			confidence?: string;
			notes?: string;
		}
	>;
}

interface StdErrorsDoc {
	errors: Record<
		string,
		{
			"canonical-name": string;
			confidence?: string;
			notes?: string;
		}
	>;
}

interface ProcessesDoc {
	processes: Record<
		string,
		{
			"canonical-name": string;
			confidence?: string;
			notes?: string;
		}
	>;
}

interface CommandsDoc {
	"handler-private"?: Record<
		string,
		{
			"canonical-name": string;
			"process-id"?: number;
			"process-name"?: string;
			confidence?: string;
			encoding?: { tcodes?: TcodeValue[] };
			args?: unknown[];
			response?: unknown[];
			notes?: string;
		}
	>;
	"handler-scoped-u8"?: Record<
		string,
		{
			"canonical-name"?: string;
			"handler-path"?: {
				"process-id"?: {
					value?: number;
					"version-range"?: string;
					notes?: string;
				};
				"handler-id"?: number;
			};
			commands?: Record<
				string,
				{
					"canonical-name": string;
					confidence?: string;
					encoding?: { tcodes?: TcodeValue[] };
					args?: unknown[];
					response?: unknown[];
					notes?: string;
				}
			>;
		}
	>;
	"legacy-short-form"?: Record<
		string,
		{
			"canonical-name": string;
			confidence?: string;
			notes?: string;
		}
	>;
}

interface TransportDoc {
	"chunk-tags": Record<
		string,
		{
			name: string;
			confidence?: string;
			notes?: string;
		}
	>;
}

interface PhysicalDoc {
	tcodes: Record<string, { name: string; confidence?: string; notes?: string }>;
}

interface HandshakeDoc {
	messages: Record<
		string,
		{
			direction?: string;
			phase?: number;
			role?: string;
			confidence?: string;
		}
	>;
}

interface MproxyDoc {
	"handler-surfaces"?: Record<
		string,
		{
			commands?: Record<
				string,
				{
					"canonical-name": string;
					confidence?: string;
					encoding?: { tcodes?: TcodeValue[] };
					args?: unknown[];
					response?: unknown[];
					notes?: string;
				}
			>;
		}
	>;
}

function ensureObject(value: unknown, context: string): JsonObject {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(
			`${context} must be a mapping; check the schema file shape before generating dissector data.`,
		);
	}

	return value as JsonObject;
}

function readYamlFile<T>(filePath: string): T {
	const doc = parseDocument(readFileSync(filePath, "utf8"));
	if (doc.errors.length > 0) {
		const messages = doc.errors.map((error) => error.message).join("; ");
		throw new Error(`Could not parse ${filePath}: ${messages}`);
	}

	return ensureObject(doc.toJS(), filePath) as T;
}

function parseNumericKey(key: string, context: string): number {
	const value = Number(key);
	if (!Number.isInteger(value)) {
		throw new Error(`${context} uses non-numeric key ${JSON.stringify(key)}.`);
	}

	return value;
}

function requiredRef(refs: Record<string, string>, key: string): string {
	const value = refs[key];
	if (!value) {
		throw new Error(
			`profiles/winbox-ipc/profile.yaml is missing refs.${key}, so dissector data cannot be generated reliably.`,
		);
	}

	return value;
}

function toHex(value: number): string {
	return `0x${value.toString(16).padStart(6, "0")}`;
}

function normalizeAbbrevSegment(name: string): string {
	return name
		.toLowerCase()
		.replaceAll(/[^a-z0-9]+/g, "_")
		.replaceAll(/^_+|_+$/g, "");
}

function buildValueEntries(
	record: Record<
		string,
		| {
				"canonical-name"?: string;
				name?: string;
				confidence?: string;
				notes?: string;
		  }
		| string
	>,
): DissectorValueEntry[] {
	return Object.entries(record)
		.map(([rawValue, rawEntry]) => {
			const value = parseNumericKey(rawValue, "value table");
			if (typeof rawEntry === "string") {
				return { value, hex: toHex(value), name: rawEntry };
			}

			return {
				value,
				hex: toHex(value),
				name:
					rawEntry["canonical-name"] ?? rawEntry.name ?? `value_${rawValue}`,
				confidence: rawEntry.confidence,
				notes: rawEntry.notes,
			};
		})
		.sort((left, right) => left.value - right.value);
}

function toAliasList(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value.flatMap((entry) => {
		if (typeof entry === "string") {
			return [entry];
		}

		if (entry && typeof entry === "object" && "name" in entry) {
			const name = (entry as { name?: unknown }).name;
			return typeof name === "string" ? [name] : [];
		}

		return [];
	});
}

function toCommandFieldRefs(entries: unknown): DissectorCommandFieldRef[] {
	if (!Array.isArray(entries)) {
		return [];
	}

	return entries.flatMap((entry) => {
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
			return [];
		}

		const item = entry as {
			key?: unknown;
			name?: unknown;
			role?: unknown;
			tcodes?: unknown;
		};
		if (typeof item.key !== "number") {
			return [];
		}

		return [
			{
				key: item.key,
				hex: toHex(item.key),
				name: typeof item.name === "string" ? item.name : undefined,
				role: typeof item.role === "string" ? item.role : undefined,
				tcodes: Array.isArray(item.tcodes)
					? (item.tcodes.filter(
							(value): value is TcodeValue =>
								typeof value === "number" || typeof value === "string",
						) as TcodeValue[])
					: undefined,
			},
		];
	});
}

function gatherOpenQuestions(
	value: unknown,
	file: string,
	path = "",
): DissectorOpenQuestion[] {
	if (Array.isArray(value)) {
		return value.flatMap((item, index) =>
			gatherOpenQuestions(item, file, `${path}[${index}]`),
		);
	}

	if (!value || typeof value !== "object") {
		return [];
	}

	const questions: DissectorOpenQuestion[] = [];
	for (const [key, child] of Object.entries(value)) {
		const nextPath = path === "" ? key : `${path}.${key}`;
		if (key === "open-questions" && Array.isArray(child)) {
			for (const item of child) {
				if (typeof item === "string") {
					questions.push({ file, path: nextPath, question: item });
				}
			}
			continue;
		}

		questions.push(...gatherOpenQuestions(child, file, nextPath));
	}

	return questions;
}

export function buildWinboxDissectorShape(
	repoRoot = findRepoRoot(),
): WinboxDissectorShape {
	const profilePath = resolve(repoRoot, "profiles/winbox-ipc/profile.yaml");
	const profile = readYamlFile<WinboxProfileDoc>(profilePath);
	const profileDir = dirname(profilePath);

	const sysKeys = readYamlFile<WinboxKeysDoc>(
		resolve(profileDir, requiredRef(profile.refs, "sys-keys")),
	);
	const stdKeys = readYamlFile<WinboxKeysDoc>(
		resolve(profileDir, requiredRef(profile.refs, "std-keys")),
	);
	const stdCommands = readYamlFile<StdCommandsDoc>(
		resolve(profileDir, requiredRef(profile.refs, "std-commands")),
	);
	const stdErrors = readYamlFile<StdErrorsDoc>(
		resolve(profileDir, requiredRef(profile.refs, "std-errors")),
	);
	const processes = readYamlFile<ProcessesDoc>(
		resolve(profileDir, requiredRef(profile.refs, "processes")),
	);
	const commands = readYamlFile<CommandsDoc>(
		resolve(profileDir, requiredRef(profile.refs, "commands")),
	);
	const transport = readYamlFile<TransportDoc>(
		resolve(profileDir, requiredRef(profile.refs, "transport")),
	);
	const handshake = readYamlFile<HandshakeDoc>(
		resolve(profileDir, requiredRef(profile.refs, "handshake-ec-srp5")),
	);
	const physical = readYamlFile<PhysicalDoc>(
		resolve(profileDir, profile["physical-ref"]),
	);
	const mproxy = readYamlFile<MproxyDoc>(
		resolve(profileDir, requiredRef(profile.refs, "mproxy")),
	);
	const undo = readYamlFile<JsonObject>(
		resolve(profileDir, requiredRef(profile.refs, "undo")),
	);

	const namespaceNames = Object.fromEntries(
		Object.entries(profile.namespaces ?? {}).map(([rawValue, entry]) => [
			parseNumericKey(rawValue, "namespace"),
			entry.name ?? `ns_${rawValue}`,
		]),
	);

	const fields = [
		...Object.entries(sysKeys.keys).map(([rawKey, entry]) => {
			const fullKey = parseNumericKey(rawKey, "system key");
			return {
				fullKey,
				hex: toHex(fullKey),
				name: entry["canonical-name"],
				abbrev: `winbox.${normalizeAbbrevSegment(entry["canonical-name"])}`,
				namespace: namespaceNames[fullKey >>> 16] ?? "system",
				namespaceByte: fullKey >>> 16,
				semantic: entry.semantic,
				role: entry.role,
				tcodes: entry.physical?.tcodes ?? ["*"],
				aliases: toAliasList(entry.aliases),
				valueTables: entry.values ? [entry["canonical-name"]] : [],
			} satisfies DissectorField;
		}),
		...Object.entries(stdKeys.keys).map(([rawKey, entry]) => {
			const fullKey = parseNumericKey(rawKey, "standard key");
			return {
				fullKey,
				hex: toHex(fullKey),
				name: entry["canonical-name"],
				abbrev: `winbox.${normalizeAbbrevSegment(entry["canonical-name"])}`,
				namespace: namespaceNames[fullKey >>> 16] ?? "standard",
				namespaceByte: fullKey >>> 16,
				semantic: entry.semantic,
				role: entry.role,
				tcodes: entry.physical?.tcodes ?? ["*"],
				aliases: toAliasList(entry.aliases),
				valueTables: entry.values ? [entry["canonical-name"]] : [],
			} satisfies DissectorField;
		}),
	].sort((left, right) => left.fullKey - right.fullKey);

	const valueTables: DissectorValueTables = {
		namespaces: buildValueEntries(
			Object.fromEntries(
				Object.entries(profile.namespaces ?? {}).map(([key, entry]) => [
					key,
					{ name: entry.name ?? key },
				]),
			),
		),
		tcodes: buildValueEntries(physical.tcodes),
		chunk_tags: buildValueEntries(transport["chunk-tags"]),
		std_commands: buildValueEntries(stdCommands.commands),
		std_errors: buildValueEntries(stdErrors.errors),
		processes: buildValueEntries(processes.processes),
		legacy_short_form: buildValueEntries(commands["legacy-short-form"] ?? {}),
		handler_private: buildValueEntries(commands["handler-private"] ?? {}),
	};

	for (const field of [
		...Object.values(sysKeys.keys),
		...Object.values(stdKeys.keys),
	]) {
		if (field.values) {
			valueTables[field["canonical-name"]] = buildValueEntries(field.values);
		}
	}

	const commandSpaces: DissectorCommandSpace[] = [
		{
			id: "standard-commands",
			name: "Standard commands",
			scope: "global" as const,
			commands: buildValueEntries(stdCommands.commands).map((entry) => ({
				value: entry.value,
				hex: entry.hex,
				name: entry.name,
				confidence: entry.confidence,
				encodingTcodes: [0x08, 0x09],
				args: [],
				response: [],
				notes: entry.notes,
			})),
		},
		{
			id: "legacy-short-form",
			name: "Legacy short-form SYS_CMD values",
			scope: "global" as const,
			commands: buildValueEntries(commands["legacy-short-form"] ?? {}).map(
				(entry) => ({
					value: entry.value,
					hex: entry.hex,
					name: entry.name,
					confidence: entry.confidence,
					encodingTcodes: [0x09],
					args: [],
					response: [],
					notes: entry.notes,
				}),
			),
		},
		{
			id: "handler-private",
			name: "Handler-private process-prefixed commands",
			scope: "global" as const,
			commands: Object.entries(commands["handler-private"] ?? {})
				.map(([rawValue, entry]) => ({
					value: parseNumericKey(rawValue, "handler-private command"),
					hex: toHex(parseNumericKey(rawValue, "handler-private command")),
					name: entry["canonical-name"],
					confidence: entry.confidence,
					encodingTcodes: entry.encoding?.tcodes ?? [0x08],
					processId: entry["process-id"],
					processName: entry["process-name"],
					args: toCommandFieldRefs(entry.args),
					response: toCommandFieldRefs(entry.response),
					notes: entry.notes,
				}))
				.sort((left, right) => left.value - right.value),
		},
		...Object.entries(commands["handler-scoped-u8"] ?? {}).map(
			([spaceId, space]) => ({
				id: spaceId,
				name: space["canonical-name"] ?? spaceId,
				scope: "handler" as const,
				handlerPath: {
					processId: space["handler-path"]?.["process-id"]?.value,
					handlerId: space["handler-path"]?.["handler-id"],
					versionScope:
						space["handler-path"]?.["process-id"]?.["version-range"],
				},
				commands: Object.entries(space.commands ?? {})
					.map(([rawValue, entry]) => ({
						value: parseNumericKey(
							rawValue,
							`handler-scoped command in ${spaceId}`,
						),
						hex: toHex(
							parseNumericKey(rawValue, `handler-scoped command in ${spaceId}`),
						),
						name: entry["canonical-name"],
						confidence: entry.confidence,
						encodingTcodes: entry.encoding?.tcodes ?? [0x09],
						processId: space["handler-path"]?.["process-id"]?.value,
						handlerId: space["handler-path"]?.["handler-id"],
						versionScope:
							space["handler-path"]?.["process-id"]?.["version-range"],
						args: toCommandFieldRefs(entry.args),
						response: toCommandFieldRefs(entry.response),
						notes: entry.notes,
					}))
					.sort((left, right) => left.value - right.value),
			}),
		),
		...Object.entries(mproxy["handler-surfaces"] ?? {}).map(
			([handlerId, surface]) => ({
				id: `mproxy-surface-handler-${handlerId}`,
				name: `mproxy handler ${handlerId} surface`,
				scope: "handler" as const,
				handlerPath: {
					handlerId: parseNumericKey(handlerId, "mproxy handler surface"),
				},
				commands: Object.entries(surface.commands ?? {})
					.map(([rawValue, entry]) => ({
						value: parseNumericKey(
							rawValue,
							`mproxy handler ${handlerId} command`,
						),
						hex: toHex(
							parseNumericKey(rawValue, `mproxy handler ${handlerId} command`),
						),
						name: entry["canonical-name"],
						confidence: entry.confidence,
						encodingTcodes: entry.encoding?.tcodes ?? [0x09],
						handlerId: parseNumericKey(handlerId, "mproxy handler surface"),
						args: toCommandFieldRefs(entry.args),
						response: toCommandFieldRefs(entry.response),
						notes: entry.notes,
					}))
					.sort((left, right) => left.value - right.value),
			}),
		),
	].filter((space) => space.commands.length > 0);

	const openQuestions = [
		...gatherOpenQuestions(profile, "profiles/winbox-ipc/profile.yaml"),
		...gatherOpenQuestions(commands, "profiles/winbox-ipc/commands.yaml"),
		...gatherOpenQuestions(processes, "profiles/winbox-ipc/processes.yaml"),
		...gatherOpenQuestions(mproxy, "profiles/winbox-ipc/mproxy.yaml"),
		...gatherOpenQuestions(undo, "profiles/winbox-ipc/undo.yaml"),
	].sort((left, right) =>
		left.file === right.file
			? left.path.localeCompare(right.path)
			: left.file.localeCompare(right.file),
	);

	const handshakeMessages = Object.entries(handshake.messages)
		.map(([name, entry]) => ({
			name,
			direction: entry.direction,
			phase: entry.phase,
			role: entry.role,
			confidence: entry.confidence,
		}))
		.sort((left, right) => left.name.localeCompare(right.name));

	return {
		profile: {
			id: profile.id,
			title: profile.title,
			classificationField: profile.classification["target-field"],
			classificationFieldName: profile.classification["target-name"],
		},
		transport: {
			chunkTags: valueTables.chunk_tags ?? [],
		},
		physical: {
			tcodes: valueTables.tcodes ?? [],
			compactPairs: profile["compact-pairs"] ?? [],
		},
		fields,
		valueTables,
		commandSpaces,
		handshakeMessages,
		openQuestions,
		summary: {
			fieldCount: fields.length,
			valueTableCount: Object.keys(valueTables).length,
			commandSpaceCount: commandSpaces.length,
			commandCount: commandSpaces.reduce(
				(total, space) => total + space.commands.length,
				0,
			),
			handshakeMessageCount: handshakeMessages.length,
			openQuestionCount: openQuestions.length,
		},
	};
}

if (import.meta.main) {
	const shape = buildWinboxDissectorShape();
	console.log(JSON.stringify(shape, null, 2));
}
