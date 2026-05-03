import { logRepoEvent } from "./cortex-db.ts";
import { resolveInstructionMatches } from "./instruction-applyto.ts";

const argumentsList = process.argv.slice(2);

if (argumentsList.includes("--help") || argumentsList.includes("-h")) {
	printUsage();
	process.exit(0);
}

const outputJson = argumentsList.includes("--json");
const targetPath = argumentsList.find((argument) => !argument.startsWith("-"));

if (!targetPath) {
	printUsage();
	process.exit(1);
}

const resolution = await resolveInstructionMatches(targetPath);

logRepoEvent({
	source: "instruction-audit",
	eventType: "applyTo",
	cwd: process.cwd(),
	targetPath: resolution.targetPath,
	summary: `Resolved applyTo matches for ${resolution.targetPath}`,
	details: {
		targetIsDirectory: resolution.targetIsDirectory,
		matchCount: resolution.matches.length,
		matchedInstructions: resolution.matches.map((match) => ({
			filePath: match.filePath,
			matchedPatterns: match.matchedPatterns,
		})),
	},
});

if (outputJson) {
	console.log(JSON.stringify(resolution, null, 2));
	process.exit(0);
}

console.log(`Target: ${resolution.targetPath}`);
console.log(`Kind: ${resolution.targetIsDirectory ? "directory" : "file"}`);

if (resolution.matches.length === 0) {
	console.log("Matched instructions: none");
	process.exit(0);
}

console.log(`Matched instructions: ${resolution.matches.length}`);

for (const match of resolution.matches) {
	console.log(`- ${match.filePath}`);
	console.log(`  matched: ${match.matchedPatterns.join(", ")}`);
	console.log(`  applyTo: ${match.applyTo}`);
}

function printUsage(): void {
	console.log("Usage: bun run audit:applyto -- <file-or-path> [--json]");
}
