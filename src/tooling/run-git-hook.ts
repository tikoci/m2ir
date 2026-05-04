import { readRequiredOption } from "./cli-input.ts";
import { logGitHookRun } from "./cortex-db.ts";

const argumentsList = process.argv.slice(2);

if (argumentsList.includes("--help") || argumentsList.includes("-h")) {
	process.stderr.write(
		"Usage: bun run hook:git -- --hook <hook-name> -- <command...>\n",
	);
	process.exit(0);
}

const separatorIndex = argumentsList.indexOf("--");
if (separatorIndex === -1) {
	throw new Error("Expected '--' before the git hook command.");
}

const optionArguments = argumentsList.slice(0, separatorIndex);
const commandArguments = argumentsList.slice(separatorIndex + 1);
const hookName = readRequiredOption(optionArguments, "--hook");

if (commandArguments.length === 0) {
	throw new Error("Expected a command to run after '--'.");
}

const startedAtMs = Date.now();
const result = Bun.spawnSync(commandArguments, {
	cwd: process.cwd(),
	stdin: "inherit",
	stdout: "inherit",
	stderr: "inherit",
});
const finishedAtMs = Date.now();
const exitCode = result.exitCode ?? (result.success ? 0 : 1);

logGitHookRun({
	hookName,
	cwd: process.cwd(),
	commandText: commandArguments.join(" "),
	status: result.success ? "success" : "failure",
	exitCode,
	durationMs: finishedAtMs - startedAtMs,
	details: {
		signalCode: result.signalCode ?? null,
	},
});

if (!result.success) {
	process.exit(exitCode);
}
