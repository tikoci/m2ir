import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

import {
	findRepoRoot,
	listInstructionFiles,
	toRepoRelativePath,
} from "./repo-paths.ts";

export interface InstructionScope {
	filePath: string;
	applyTo: string;
	patterns: string[];
}

export interface InstructionMatch extends InstructionScope {
	matchedPatterns: string[];
}

export interface InstructionResolution {
	repoRoot: string;
	targetPath: string;
	targetIsDirectory: boolean;
	matches: InstructionMatch[];
}

const FRONTMATTER_PATTERN = /^---\s*\n([\s\S]*?)\n---\s*/;
const APPLY_TO_PATTERN = /^applyTo:\s*["'](.+)["']\s*$/m;

export function splitApplyTo(applyTo: string): string[] {
	const patterns: string[] = [];
	let currentPattern = "";
	let groupingDepth = 0;

	for (const character of applyTo) {
		if (character === "{" || character === "(" || character === "[") {
			groupingDepth += 1;
		} else if (
			(character === "}" || character === ")" || character === "]") &&
			groupingDepth > 0
		) {
			groupingDepth -= 1;
		}

		if (character === "," && groupingDepth === 0) {
			const trimmedPattern = currentPattern.trim();
			if (trimmedPattern !== "") {
				patterns.push(trimmedPattern);
			}
			currentPattern = "";
			continue;
		}

		currentPattern += character;
	}

	const trailingPattern = currentPattern.trim();
	if (trailingPattern !== "") {
		patterns.push(trailingPattern);
	}

	return patterns;
}

export async function listInstructionScopes(
	repoRoot = findRepoRoot(),
): Promise<InstructionScope[]> {
	const instructionFiles = listInstructionFiles(repoRoot);

	const scopes = await Promise.all(
		instructionFiles.map(
			async (instructionFile): Promise<InstructionScope | null> => {
				const content = await Bun.file(instructionFile).text();
				const frontmatterMatch = content.match(FRONTMATTER_PATTERN);

				if (!frontmatterMatch) {
					return null;
				}

				const frontmatter = frontmatterMatch[1];
				if (!frontmatter) {
					return null;
				}

				const applyToMatch = frontmatter.match(APPLY_TO_PATTERN);
				if (!applyToMatch) {
					return null;
				}

				const applyTo = applyToMatch[1];
				if (!applyTo) {
					return null;
				}

				return {
					filePath: toRepoRelativePath(instructionFile, repoRoot),
					applyTo,
					patterns: splitApplyTo(applyTo),
				};
			},
		),
	);

	return scopes.filter((scope): scope is InstructionScope => scope !== null);
}

export async function resolveInstructionMatches(
	targetPath: string,
	options: { repoRoot?: string } = {},
): Promise<InstructionResolution> {
	const repoRoot = options.repoRoot ?? findRepoRoot();
	const absoluteTargetPath = resolve(repoRoot, targetPath);
	const targetIsDirectory = existsSync(absoluteTargetPath)
		? statSync(absoluteTargetPath).isDirectory()
		: targetPath.endsWith("/");
	const relativeTargetPath = toRepoRelativePath(absoluteTargetPath, repoRoot);
	const instructionScopes = await listInstructionScopes(repoRoot);

	const matches = instructionScopes
		.map((scope): InstructionMatch | null => {
			const matchedPatterns = scope.patterns.filter((pattern) => {
				const glob = new Bun.Glob(pattern);
				return buildCandidatePaths(relativeTargetPath, targetIsDirectory).some(
					(candidatePath) => glob.match(candidatePath),
				);
			});

			if (matchedPatterns.length === 0) {
				return null;
			}

			return {
				...scope,
				matchedPatterns,
			};
		})
		.filter((scope): scope is InstructionMatch => scope !== null);

	return {
		repoRoot,
		targetPath: relativeTargetPath,
		targetIsDirectory,
		matches,
	};
}

function buildCandidatePaths(
	targetPath: string,
	targetIsDirectory: boolean,
): string[] {
	if (!targetIsDirectory) {
		return [targetPath];
	}

	if (targetPath === ".") {
		return [".", ".placeholder", "placeholder.md"];
	}

	return [
		targetPath,
		`${targetPath}/.placeholder`,
		`${targetPath}/placeholder.md`,
	];
}
