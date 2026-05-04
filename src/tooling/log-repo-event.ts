import { readOptionalOption, readStdinText } from "./cli-input.ts";
import { logRepoEvent } from "./cortex-db.ts";

const argumentsList = process.argv.slice(2);

if (argumentsList.includes("--help") || argumentsList.includes("-h")) {
	printUsage();
	process.exit(0);
}

const source = readOptionalOption(argumentsList, "--source");
const eventType = readOptionalOption(argumentsList, "--event");

if (!source || !eventType) {
	printUsage();
	process.exit(1);
}

const targetPath = readOptionalOption(argumentsList, "--target");
const summary = readOptionalOption(argumentsList, "--summary");
const rawInput = await readStdinText();

const eventId = logRepoEvent({
	source,
	eventType,
	cwd: process.cwd(),
	targetPath: targetPath ?? undefined,
	summary: summary ?? undefined,
	details: buildEventDetails(rawInput),
});

console.log(`Logged ${source}:${eventType} to cortex.db (#${eventId}).`);

function printUsage(): void {
	console.log(
		"Usage: bun run hook:log -- --source <source> --event <event> [--target <path>] [--summary <text>]",
	);
}

function buildEventDetails(rawInput: string): unknown {
	if (rawInput === "") {
		return null;
	}

	try {
		return JSON.parse(rawInput) as unknown;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			parseError: message,
			rawInput,
		};
	}
}
