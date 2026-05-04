import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	logCopilotHookEvent,
	logGitHookRun,
	logRepoEvent,
} from "../../src/tooling/cortex-db.ts";
import { resolveInstructionMatches } from "../../src/tooling/instruction-applyto.ts";

describe("resolveInstructionMatches", () => {
	test("matches Bun and linting instructions for a source file", async () => {
		const resolution = await resolveInstructionMatches("src/index.ts", {
			repoRoot: process.cwd(),
		});
		const matchedFiles = resolution.matches.map((match) => match.filePath);

		expect(matchedFiles).toContain(
			".github/instructions/use-bun.instructions.md",
		);
		expect(matchedFiles).toContain(
			".github/instructions/linting.instructions.md",
		);
	});
});

describe("logRepoEvent", () => {
	test("creates the repo_events table and inserts a row", () => {
		const tempDirectory = mkdtempSync(join(tmpdir(), "m2ir-cortex-"));
		const dbPath = join(tempDirectory, "cortex.db");

		try {
			const eventId = logRepoEvent({
				dbPath,
				source: "test",
				eventType: "repo-tooling",
				cwd: process.cwd(),
				targetPath: "src/index.ts",
				summary: "Testing cortex logging",
				details: { ok: true },
			});

			const db = new Database(dbPath);

			try {
				const eventRow = db
					.query(
						`
							SELECT source, event_type, target_path, summary, details_json
							FROM repo_events
							WHERE id = ?
						`,
					)
					.get(eventId) as {
					source: string;
					event_type: string;
					target_path: string;
					summary: string;
					details_json: string;
				} | null;

				expect(eventRow).not.toBeNull();
				expect(eventRow?.source).toBe("test");
				expect(eventRow?.event_type).toBe("repo-tooling");
				expect(eventRow?.target_path).toBe("src/index.ts");
				expect(eventRow?.summary).toBe("Testing cortex logging");
				expect(eventRow?.details_json).toBe('{"ok":true}');
			} finally {
				db.close();
			}
		} finally {
			rmSync(tempDirectory, { recursive: true, force: true });
		}
	});
});

describe("logGitHookRun", () => {
	test("stores git hook status and duration in a dedicated table", () => {
		const tempDirectory = mkdtempSync(join(tmpdir(), "m2ir-git-hook-"));
		const dbPath = join(tempDirectory, "cortex.db");

		try {
			const runId = logGitHookRun({
				dbPath,
				hookName: "pre-commit",
				cwd: process.cwd(),
				commandText: "bun run lint",
				status: "success",
				exitCode: 0,
				durationMs: 123,
				details: { via: "test" },
			});

			const db = new Database(dbPath);

			try {
				const runRow = db
					.query(
						`
							SELECT hook_name, command_text, status, exit_code, duration_ms
							FROM git_hook_runs
							WHERE id = ?
						`,
					)
					.get(runId) as {
					hook_name: string;
					command_text: string;
					status: string;
					exit_code: number;
					duration_ms: number;
				} | null;

				expect(runRow).not.toBeNull();
				expect(runRow?.hook_name).toBe("pre-commit");
				expect(runRow?.command_text).toBe("bun run lint");
				expect(runRow?.status).toBe("success");
				expect(runRow?.exit_code).toBe(0);
				expect(runRow?.duration_ms).toBe(123);
			} finally {
				db.close();
			}
		} finally {
			rmSync(tempDirectory, { recursive: true, force: true });
		}
	});
});

describe("logCopilotHookEvent", () => {
	test("stores documented Copilot hook payload fields in a dedicated table", () => {
		const tempDirectory = mkdtempSync(join(tmpdir(), "m2ir-copilot-hook-"));
		const dbPath = join(tempDirectory, "cortex.db");

		try {
			const eventId = logCopilotHookEvent({
				dbPath,
				hookName: "preToolUse",
				processCwd: process.cwd(),
				payload: {
					timestamp: 1704614600000,
					cwd: process.cwd(),
					toolName: "bash",
					toolArgs: '{"command":"echo test"}',
				},
			});

			const db = new Database(dbPath);

			try {
				const eventRow = db
					.query(
						`
							SELECT hook_name, tool_name, tool_args_text, tool_args_json
							FROM copilot_hook_events
							WHERE id = ?
						`,
					)
					.get(eventId) as {
					hook_name: string;
					tool_name: string;
					tool_args_text: string;
					tool_args_json: string;
				} | null;

				expect(eventRow).not.toBeNull();
				expect(eventRow?.hook_name).toBe("preToolUse");
				expect(eventRow?.tool_name).toBe("bash");
				expect(eventRow?.tool_args_text).toBe('{"command":"echo test"}');
				expect(eventRow?.tool_args_json).toBe('{"command":"echo test"}');
			} finally {
				db.close();
			}
		} finally {
			rmSync(tempDirectory, { recursive: true, force: true });
		}
	});
});
