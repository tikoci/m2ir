import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { logRepoEvent } from "../../src/tooling/cortex-db.ts";
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
