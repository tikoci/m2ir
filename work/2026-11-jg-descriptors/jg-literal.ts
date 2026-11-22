/**
 * Minimal parser for the JavaScript object literals in RouterOS .jg files.
 * Handles unquoted and numeric keys, single-quoted strings, and bare numbers.
 * The files come from a router, so they are parsed as data and never evaluated.
 */
export function parseLiteral(src: string): unknown {
	let i = 0;
	const at = (k: number) => src.charAt(k);
	const fail = (m: string): never => {
		throw new SyntaxError(`${m} at offset ${i}: ${src.slice(i, i + 40)}`);
	};
	const ws = () => {
		while (i < src.length && /\s/.test(at(i))) i++;
	};
	const str = (): string => {
		const q = at(i++);
		let out = "";
		while (i < src.length && at(i) !== q) {
			if (at(i) !== "\\") {
				out += at(i++);
				continue;
			}
			const c = at(++i);
			if (c === "n") out += "\n";
			else if (c === "t") out += "\t";
			else if (c === "r") out += "\r";
			else if (c === "x" || c === "u") {
				const n = c === "x" ? 2 : 4;
				out += String.fromCharCode(
					Number.parseInt(src.slice(i + 1, i + 1 + n), 16),
				);
				i += n;
			} else out += c;
			i++;
		}
		if (at(i) !== q) fail("unterminated string");
		i++;
		return out;
	};
	const word = (): string => {
		const m = /^[-+]?[A-Za-z0-9_$.]+/.exec(src.slice(i, i + 64));
		const w = m?.[0] ?? fail("expected a key or literal");
		i += w.length;
		return w;
	};
	const value = (): unknown => {
		ws();
		const c = at(i);
		if (c === "{") {
			i++;
			const o: Record<string, unknown> = {};
			for (;;) {
				ws();
				if (at(i) === "}") {
					i++;
					return o;
				}
				const k = at(i) === "'" || at(i) === '"' ? str() : word();
				ws();
				if (at(i++) !== ":") fail("expected ':'");
				o[k] = value();
				ws();
				if (at(i) === ",") i++;
				else if (at(i) !== "}") fail("expected ',' or '}'");
			}
		}
		if (c === "[") {
			i++;
			const a: unknown[] = [];
			for (;;) {
				ws();
				if (at(i) === "]") {
					i++;
					return a;
				}
				a.push(value());
				ws();
				if (at(i) === ",") i++;
				else if (at(i) !== "]") fail("expected ',' or ']'");
			}
		}
		if (c === "'" || c === '"') return str();
		const w = word();
		if (w === "true") return true;
		if (w === "false") return false;
		if (w === "null") return null;
		const n = Number(w);
		return Number.isNaN(n) ? fail(`unexpected literal '${w}'`) : n;
	};
	const v = value();
	ws();
	if (i < src.length) fail("trailing data");
	return v;
}
