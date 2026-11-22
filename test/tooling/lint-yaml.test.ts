import { describe, expect, test } from "bun:test";
import { validateYamlDocument } from "../../src/tooling/lint-yaml.ts";

describe("validateYamlDocument", () => {
	test("returns no errors for a fully valid document", () => {
		const doc = {
			"m2ir-version": "0.1",
			confidence: "documented",
			maturity: "stable",
			evidence: [{ source: "code", ref: "foo.c:42" }],
		};
		expect(validateYamlDocument(doc, "test.yaml")).toEqual([]);
	});

	test("accepts all valid confidence values", () => {
		for (const v of [
			"documented",
			"inferred",
			"observed-only",
			"guessed",
			"superseded",
		]) {
			expect(validateYamlDocument({ confidence: v }, "test.yaml")).toEqual([]);
		}
	});

	test("rejects an invalid confidence value", () => {
		const errors = validateYamlDocument({ confidence: "certain" }, "file.yaml");
		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain("file.yaml:");
		expect(errors[0]).toContain("confidence");
		expect(errors[0]).toContain('"certain"');
	});

	test("rejects a non-string confidence value", () => {
		const errors = validateYamlDocument({ confidence: 1 }, "file.yaml");
		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain("confidence");
		expect(errors[0]).toContain("expected one of");
	});

	test("accepts all valid maturity values", () => {
		for (const v of ["exploratory", "stable", "speculative"]) {
			expect(validateYamlDocument({ maturity: v }, "test.yaml")).toEqual([]);
		}
	});

	test("rejects an invalid maturity value", () => {
		const errors = validateYamlDocument({ maturity: "beta" }, "file.yaml");
		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain("maturity");
		expect(errors[0]).toContain('"beta"');
	});

	test("rejects a non-string maturity value", () => {
		const errors = validateYamlDocument({ maturity: false }, "file.yaml");
		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain("maturity");
		expect(errors[0]).toContain("expected one of");
	});

	test("accepts all valid evidence source values", () => {
		for (const v of ["code", "doc", "sample", "talk"]) {
			expect(
				validateYamlDocument({ evidence: [{ source: v }] }, "test.yaml"),
			).toEqual([]);
		}
	});

	test("rejects an invalid evidence source", () => {
		const errors = validateYamlDocument(
			{ evidence: [{ source: "wiki" }] },
			"file.yaml",
		);
		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain("evidence");
		expect(errors[0]).toContain("source");
		expect(errors[0]).toContain('"wiki"');
	});

	test("rejects a non-string evidence source", () => {
		const errors = validateYamlDocument(
			{ evidence: [{ source: 3 }] },
			"file.yaml",
		);
		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain("evidence source");
		expect(errors[0]).toContain("expected one of");
	});

	test("does NOT flag source in non-evidence contexts", () => {
		// sys-keys.yaml / std-keys.yaml pattern: source inside a plain object
		const doc = {
			"source-table": { source: "/nova/etc/loader/system.x3" },
			keys: [{ name: "foo", source: "tenable/routeros" }],
		};
		expect(validateYamlDocument(doc, "test.yaml")).toEqual([]);
	});

	test("catches invalid confidence nested inside a key entry", () => {
		const doc = {
			keys: [{ id: "0x01", confidence: "maybe" }],
		};
		const errors = validateYamlDocument(doc, "file.yaml");
		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain("confidence");
	});

	test("catches multiple errors and prefixes each with filePath", () => {
		const doc = {
			confidence: "bogus",
			maturity: "nope",
		};
		const errors = validateYamlDocument(doc, "foo/bar.yaml");
		expect(errors).toHaveLength(2);
		for (const e of errors) {
			expect(e.startsWith("foo/bar.yaml:")).toBe(true);
		}
	});

	test("handles null and undefined values without throwing", () => {
		expect(validateYamlDocument(null, "test.yaml")).toEqual([]);
		expect(validateYamlDocument(undefined, "test.yaml")).toEqual([]);
	});

	test("handles an empty document", () => {
		expect(validateYamlDocument({}, "test.yaml")).toEqual([]);
	});

	test("validates evidence items in an inline flow-map style array", () => {
		// evidence: [{source: doc}, {source: bad}]
		const doc = {
			evidence: [{ source: "doc" }, { source: "bad" }],
		};
		const errors = validateYamlDocument(doc, "file.yaml");
		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain('"bad"');
	});
});

describe("handler field typed identity", () => {
	const withField = (entry: unknown) => ({
		handlers: {
			h: { "sys-to": [20, 0], fields: { "namespace-user": { 16: entry } } },
		},
	});

	test("accepts a two-variant field keyed by type letter", () => {
		const doc = withField({
			variants: {
				u: { name: "region-revision", tcode: "u32" },
				s: { name: "region-name", tcode: "string" },
			},
		});
		expect(validateYamlDocument(doc, "g.yaml")).toEqual([]);
	});

	test("accepts a scalar message variant (letter m, tcode message)", () => {
		const doc = withField({
			variants: {
				m: { name: "request", tcode: "message" },
				u: { name: "count", tcode: "u32" },
			},
		});
		expect(validateYamlDocument(doc, "g.yaml")).toEqual([]);
	});

	test("rejects a variant whose tcode is another type letter", () => {
		const doc = withField({
			variants: {
				u: { name: "a", tcode: "string" },
				s: { name: "b", tcode: "string" },
			},
		});
		const errors = validateYamlDocument(doc, "g.yaml");
		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain("variants.u.tcode");
	});

	test("rejects a non-letter variant key, a single variant, and name next to variants", () => {
		expect(
			validateYamlDocument(
				withField({ variants: { int: { name: "a" }, s: { name: "b" } } }),
				"g.yaml",
			)[0],
		).toContain('"int" is not a type letter');
		expect(
			validateYamlDocument(
				withField({ variants: { u: { name: "a" } } }),
				"g.yaml",
			)[0],
		).toContain("at least two");
		expect(
			validateYamlDocument(
				withField({
					name: "x",
					variants: { u: { name: "a" }, s: { name: "b" } },
				}),
				"g.yaml",
			)[0],
		).toContain("not allowed next to variants");
	});

	test("rejects an unknown tcode spelling on a plain field", () => {
		const errors = validateYamlDocument(
			withField({ name: "x", tcode: "int32" }),
			"g.yaml",
		);
		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain('unknown tcode "int32"');
	});
});
