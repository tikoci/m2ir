import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

export function findRepoRoot(start = process.cwd()): string {
	let current = resolve(start);

	while (true) {
		if (existsSync(resolve(current, "package.json"))) {
			return current;
		}

		const parent = dirname(current);
		if (parent === current) {
			throw new Error(
				`Could not find package.json while walking upward from ${start}.`,
			);
		}

		current = parent;
	}
}

export function toRepoRelativePath(
	targetPath: string,
	repoRoot: string,
): string {
	const absolutePath = resolve(repoRoot, targetPath);
	const relativePath = relative(repoRoot, absolutePath).replaceAll("\\", "/");

	if (relativePath === "") {
		return ".";
	}

	if (relativePath === ".." || relativePath.startsWith("../")) {
		throw new Error(
			`Path ${targetPath} is outside the repository root ${repoRoot}.`,
		);
	}

	return relativePath;
}

export function normalizeOptionalRepoPath(
	targetPath: string | undefined,
	repoRoot: string,
): string | null {
	if (!targetPath) {
		return null;
	}

	const absolutePath = resolve(targetPath);
	if (absolutePath === repoRoot) {
		return ".";
	}

	const repoRootWithSeparator = `${repoRoot}${sep}`;
	if (absolutePath.startsWith(repoRootWithSeparator)) {
		return relative(repoRoot, absolutePath).replaceAll("\\", "/");
	}

	return targetPath;
}

export function isExistingDirectory(path: string): boolean {
	return existsSync(path) && statSync(path).isDirectory();
}

export function listInstructionFiles(repoRoot: string): string[] {
	const instructionsDir = resolve(repoRoot, ".github/instructions");
	return readdirSync(instructionsDir)
		.filter((entry) => entry.endsWith(".md"))
		.map((entry) => resolve(instructionsDir, entry))
		.sort();
}
