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

const EVENT_TABLE_SCHEMA = `
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

	CREATE INDEX IF NOT EXISTS repo_events_by_source ON repo_events (source, event_type, occurred_at);
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
	db.exec(EVENT_TABLE_SCHEMA);
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
		const eventDetails = JSON.stringify(input.details ?? null);
		const result = insertEvent.run(
			input.source,
			input.eventType,
			input.cwd ?? repoRoot,
			normalizeOptionalRepoPath(input.targetPath, repoRoot),
			input.summary ?? null,
			eventDetails,
		);

		return Number(result.lastInsertRowid);
	} finally {
		db.close();
	}
}
