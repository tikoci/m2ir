import { logRepoEvent } from "./cortex-db.ts";

const argumentsList = process.argv.slice(2);

if (argumentsList.includes("--help") || argumentsList.includes("-h")) {
	printUsage();
	process.exit(0);
}

const source = readOption(argumentsList, "--source");
const eventType = readOption(argumentsList, "--event");

if (!source || !eventType) {
	printUsage();
	process.exit(1);
}

const targetPath = readOption(argumentsList, "--target");
const summary = readOption(argumentsList, "--summary");
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

function readOption(args: string[], optionName: string): string | null {
	const optionIndex = args.indexOf(optionName);
	if (optionIndex === -1) {
		return null;
	}

	const optionValue = args[optionIndex + 1];
	if (!optionValue || optionValue.startsWith("--")) {
		throw new Error(`Expected a value after ${optionName}.`);
	}

	return optionValue;
}

function printUsage(): void {
	console.log(
		"Usage: bun run hook:log -- --source <source> --event <event> [--target <path>] [--summary <text>]",
	);
}

async function readStdinText(): Promise<string> {
	if (process.stdin.isTTY) {
		return "";
	}

	return await new Promise<string>((resolve, reject) => {
		let data = "";
		process.stdin.setEncoding("utf8");
		process.stdin.on("data", (chunk) => {
			data += chunk;
		});
		process.stdin.on("end", () => {
			resolve(data.trim());
		});
		process.stdin.on("error", (error) => {
			reject(error);
		});
	});
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
