export function readOptionalOption(
	args: string[],
	optionName: string,
): string | null {
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

export function readRequiredOption(args: string[], optionName: string): string {
	const optionValue = readOptionalOption(args, optionName);
	if (!optionValue) {
		throw new Error(`Missing required option ${optionName}.`);
	}

	return optionValue;
}

export async function readStdinText(): Promise<string> {
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
