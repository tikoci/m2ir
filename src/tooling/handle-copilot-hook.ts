import { readRequiredOption, readStdinText } from "./cli-input.ts";
import { logCopilotHookEvent, logRepoEvent } from "./cortex-db.ts";

const argumentsList = process.argv.slice(2);

if (argumentsList.includes("--help") || argumentsList.includes("-h")) {
	process.stderr.write("Usage: bun run hook:copilot -- --hook <hook-name>\n");
	process.exit(0);
}

const hookName = readRequiredOption(argumentsList, "--hook");
const rawPayload = await readStdinText();

if (rawPayload === "") {
	logRepoEvent({
		source: "copilot-hook",
		eventType: `${hookName}:missing-payload`,
		cwd: process.cwd(),
		summary: `Copilot hook ${hookName} ran without stdin payload`,
	});
	process.exit(0);
}

try {
	const payload = JSON.parse(rawPayload) as unknown;
	logCopilotHookEvent({
		hookName,
		processCwd: process.cwd(),
		payload,
	});
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	logRepoEvent({
		source: "copilot-hook",
		eventType: `${hookName}:invalid-json`,
		cwd: process.cwd(),
		summary: `Copilot hook ${hookName} received invalid JSON`,
		details: {
			parseError: message,
			rawPayload,
		},
	});
}
