import { describe, expect, test } from "bun:test";

import { buildWinboxDissectorShape } from "../../src/tooling/winbox-dissector-shape.ts";

describe("buildWinboxDissectorShape", () => {
	const shape = buildWinboxDissectorShape();

	test("collects the core field tables from schema", () => {
		expect(shape.summary.fieldCount).toBeGreaterThanOrEqual(40);

		expect(
			shape.fields.find((field) => field.name === "SYS_CMD"),
		).toMatchObject({
			fullKey: 0xff0007,
			abbrev: "winbox.sys_cmd",
			namespace: "system",
			tcodes: [0x08, 0x09],
		});
	});

	test("lifts enum-like value tables into dissector-friendly label maps", () => {
		expect(shape.valueTables.std_commands).toContainEqual({
			value: 0xfe000d,
			hex: "0xfe000d",
			name: "CMD_GET",
			confidence: "documented",
			notes: expect.any(String),
		});

		expect(shape.transport.chunkTags).toContainEqual({
			value: 0x06,
			hex: "0x000006",
			name: "encrypted_m2",
			confidence: "observed-only",
			notes: expect.any(String),
		});
	});

	test("captures handler-specific command spaces beyond Cisco-Talos globals", () => {
		const handlerSpace = shape.commandSpaces.find(
			(space) => space.id === "mproxy-handler-2",
		);

		expect(handlerSpace).toBeDefined();
		expect(handlerSpace?.commands).toContainEqual(
			expect.objectContaining({
				value: 0x07,
				name: "fileOpen",
			}),
		);
	});

	test("surfaces unresolved schema questions alongside generated tables", () => {
		expect(shape.summary.openQuestionCount).toBeGreaterThan(0);
		expect(shape.openQuestions).toContainEqual(
			expect.objectContaining({
				file: "profiles/winbox-ipc/undo.yaml",
				question: expect.stringContaining("Which command flows"),
			}),
		);
	});
});
