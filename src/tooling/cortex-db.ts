import { Database } from "bun:sqlite";

import { findRepoRoot, normalizeOptionalRepoPath } from "./repo-paths.ts";

export interface RepoEventInput {
	dbPath?: string;
	source: string;
	eventType: string;
	cwd?: string;
	targetPath?: string;
	summary?: string;
	details?: unknown;
}

export interface GitHookRunInput {
	dbPath?: string;
	hookName: string;
	cwd?: string;
	commandText: string;
	status: "success" | "failure";
	exitCode: number;
	durationMs: number;
	details?: unknown;
}

export interface CopilotHookEventInput {
	dbPath?: string;
	hookName: string;
	processCwd?: string;
	payload: unknown;
}

const CORTEX_SCHEMA = `
	CREATE TABLE IF NOT EXISTS repo_events (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
		source TEXT NOT NULL,
		event_type TEXT NOT NULL,
		cwd TEXT NOT NULL,
		target_path TEXT,
		summary TEXT,
		details_json TEXT NOT NULL
	);

	CREATE INDEX IF NOT EXISTS repo_events_by_source
		ON repo_events (source, event_type, occurred_at);

	CREATE TABLE IF NOT EXISTS git_hook_runs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
		hook_name TEXT NOT NULL,
		cwd TEXT NOT NULL,
		command_text TEXT NOT NULL,
		status TEXT NOT NULL,
		exit_code INTEGER NOT NULL,
		duration_ms INTEGER NOT NULL,
		details_json TEXT NOT NULL
	);

	CREATE INDEX IF NOT EXISTS git_hook_runs_by_name
		ON git_hook_runs (hook_name, occurred_at);

	CREATE TABLE IF NOT EXISTS copilot_hook_events (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
		hook_name TEXT NOT NULL,
		hook_timestamp_ms INTEGER,
		process_cwd TEXT NOT NULL,
		payload_cwd TEXT,
		payload_json TEXT NOT NULL,
		session_source TEXT,
		session_reason TEXT,
		initial_prompt TEXT,
		prompt_text TEXT,
		tool_name TEXT,
		tool_args_text TEXT,
		tool_args_json TEXT,
		tool_args_parse_error TEXT,
		tool_result_type TEXT,
		tool_result_text TEXT,
		tool_result_json TEXT,
		error_name TEXT,
		error_message TEXT,
		error_stack TEXT
	);

	CREATE INDEX IF NOT EXISTS copilot_hook_events_by_name
		ON copilot_hook_events (hook_name, occurred_at);
`;

export function getCortexDbPath(repoRoot = findRepoRoot()): string {
	return `${repoRoot}/cortex.db`;
}

export function openCortexDb(dbPath = getCortexDbPath()): Database {
	const db = new Database(dbPath, { create: true });
	ensureCortexSchema(db);
	return db;
}

export function ensureCortexSchema(db: Database): void {
	db.exec(CORTEX_SCHEMA);
}

export function logRepoEvent(input: RepoEventInput): number {
	const repoRoot = findRepoRoot(input.cwd ?? process.cwd());
	const db = openCortexDb(input.dbPath ?? getCortexDbPath(repoRoot));

	try {
		const insertEvent = db.query(
			`
				INSERT INTO repo_events (
					source,
					event_type,
					cwd,
					target_path,
					summary,
					details_json
				)
				VALUES (?, ?, ?, ?, ?, ?)
			`,
		);
		const result = insertEvent.run(
			input.source,
			input.eventType,
			input.cwd ?? repoRoot,
			normalizeOptionalRepoPath(input.targetPath, repoRoot),
			input.summary ?? null,
			serializeJson(input.details),
		);

		return Number(result.lastInsertRowid);
	} finally {
		db.close();
	}
}

export function logGitHookRun(input: GitHookRunInput): number {
	const repoRoot = findRepoRoot(input.cwd ?? process.cwd());
	const db = openCortexDb(input.dbPath ?? getCortexDbPath(repoRoot));

	try {
		const insertRun = db.query(
			`
				INSERT INTO git_hook_runs (
					hook_name,
					cwd,
					command_text,
					status,
					exit_code,
					duration_ms,
					details_json
				)
				VALUES (?, ?, ?, ?, ?, ?, ?)
			`,
		);
		const result = insertRun.run(
			input.hookName,
			input.cwd ?? repoRoot,
			input.commandText,
			input.status,
			input.exitCode,
			input.durationMs,
			serializeJson(input.details),
		);

		return Number(result.lastInsertRowid);
	} finally {
		db.close();
	}
}

export function logCopilotHookEvent(input: CopilotHookEventInput): number {
	const processCwd = input.processCwd ?? process.cwd();
	const repoRoot = findRepoRoot(processCwd);
	const db = openCortexDb(input.dbPath ?? getCortexDbPath(repoRoot));
	const payload = asRecord(input.payload);
	const toolArgs = parseJsonString(getString(payload, "toolArgs"));
	const toolResultValue = getValue(payload, "toolResult");
	const toolResult = asRecord(toolResultValue);
	const errorValue = getValue(payload, "error");
	const errorObject = asRecord(errorValue);

	try {
		const insertEvent = db.query(
			`
				INSERT INTO copilot_hook_events (
					hook_name,
					hook_timestamp_ms,
					process_cwd,
					payload_cwd,
					payload_json,
					session_source,
					session_reason,
					initial_prompt,
					prompt_text,
					tool_name,
					tool_args_text,
					tool_args_json,
					tool_args_parse_error,
					tool_result_type,
					tool_result_text,
					tool_result_json,
					error_name,
					error_message,
					error_stack
				)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`,
		);
		const result = insertEvent.run(
			input.hookName,
			getNumber(payload, "timestamp"),
			processCwd,
			getString(payload, "cwd"),
			serializeJson(input.payload),
			getString(payload, "source"),
			getString(payload, "reason"),
			getString(payload, "initialPrompt"),
			getString(payload, "prompt"),
			getString(payload, "toolName"),
			getString(payload, "toolArgs"),
			toolArgs.parsedValue ? serializeJson(toolArgs.parsedValue) : null,
			toolArgs.parseError,
			getString(toolResult, "resultType"),
			getString(toolResult, "textResultForLlm"),
			toolResult ? serializeJson(toolResult) : null,
			getString(errorObject, "name"),
			getString(errorObject, "message"),
			getString(errorObject, "stack"),
		);

		return Number(result.lastInsertRowid);
	} finally {
		db.close();
	}
}

function serializeJson(value: unknown): string {
	return JSON.stringify(value ?? null);
}

function asRecord(value: unknown): Record<string, unknown> {
	if (typeof value === "object" && value !== null && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}

	return {};
}

function getString(
	record: Record<string, unknown>,
	key: string,
): string | null {
	const value = record[key];
	return typeof value === "string" ? value : null;
}

function getNumber(
	record: Record<string, unknown>,
	key: string,
): number | null {
	const value = record[key];
	return typeof value === "number" ? value : null;
}

function getValue(record: Record<string, unknown>, key: string): unknown {
	return record[key];
}

function parseJsonString(value: string | null): {
	parsedValue: unknown | null;
	parseError: string | null;
} {
	if (!value) {
		return {
			parsedValue: null,
			parseError: null,
		};
	}

	try {
		return {
			parsedValue: JSON.parse(value) as unknown,
			parseError: null,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			parsedValue: null,
			parseError: message,
		};
	}
}
