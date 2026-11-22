import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	encodeM2,
	encU32,
	encU32Array,
} from "../../work/2026-10-chr-extraction/ws3c/m2.ts";
import { analyze } from "../../work/2026-11-jg-descriptors/native-report.ts";

const dirs: string[] = [];
function temporaryDirectory(): string {
	const dir = mkdtempSync(join(tmpdir(), "m2ir-review-"));
	dirs.push(dir);
	return dir;
}
afterEach(() => {
	for (const dir of dirs.splice(0))
		rmSync(dir, { recursive: true, force: true });
});

test("a late bridge acknowledgement cannot change the port notification latency", async () => {
	const dir = temporaryDirectory();
	const hex = (entries: Parameters<typeof encodeM2>[0]) =>
		Buffer.from(encodeM2(entries)).toString("hex");
	const tx = (seq: number, tMs: number, id: number) => ({
		session: "B",
		seq,
		tMs,
		direction: "tx",
		plaintextHex: hex([encU32(0xff0006, id), encU32(0xff0007, 0xfe0003)]),
	});
	const ack = (seq: number, tMs: number, id: number) => ({
		session: "B",
		seq,
		tMs,
		direction: "rx",
		plaintextHex: hex([encU32(0xff0006, id)]),
	});
	const events = [
		{ mark: "q1-bridge-comment" },
		tx(1, 0, 1),
		{ mark: "q1-port-comment" },
		tx(2, 100, 2),
		ack(3, 120, 1), // The previous step's late acknowledgement.
		{
			session: "A",
			seq: 1,
			tMs: 150,
			direction: "rx",
			plaintextHex: hex([
				encU32Array(0xff0002, [16, 2]),
				encU32(0xff0007, 0xfe000b),
			]),
		},
		ack(4, 170, 2),
	];
	await Bun.write(join(dir, "meta.json"), "{}");
	await Bun.write(
		join(dir, "capture.jsonl"),
		events.map((e) => JSON.stringify(e)).join("\n"),
	);
	expect(analyze(dir).q1).toMatchObject([
		{ mark: "q1-port-comment", afterAckMs: -20 },
	]);
});

for (const failRestore of [false, true]) {
	test(`probe cleanup stops the listener when SNMP restore ${failRestore ? "fails" : "succeeds"}`, async () => {
		const dir = temporaryDirectory();
		const stopped = join(dir, "stopped");
		const restored = join(dir, "restored.json");
		// Module mocks run in a child so they cannot replace real exports
		// for other tests. The real probe runs until its first receive fails.
		const program = `
import { mock } from "bun:test";
mock.module(${JSON.stringify(import.meta.resolve("../../work/2026-11-winbox-attributes/harness/target.ts"))}, () => ({
  requireMutationGate() {},
  resolveLabTarget() { return { version: "7.25" }; },
}));
mock.module(${JSON.stringify(import.meta.resolve("../../work/2026-11-jg-descriptors/undo-lib.ts"))}, () => ({
  CMD_SET: 0xfe000e,
  UNDO_CMD: {},
  centrsExec(_machine, cli) {
    if (cli[0] === "/snmp/print")
      return { ok: true, data: { contact: "original contact", location: "original location" } };
    if (cli[0] === "/snmp/set") {
      require("node:fs").writeFileSync(${JSON.stringify(restored)}, JSON.stringify(cli));
      return { ok: ${!failRestore}, error: "restore rejected" };
    }
    return { ok: true };
  },
  UndoListener: { async open() { return {
    async rows() { throw new Error("receive failed"); },
    async stop() { await Bun.write(${JSON.stringify(stopped)}, "closed"); },
  }; } },
}));
process.argv = [process.execPath, "undo-q1.ts", "--quickchr", "test", "--out", ${JSON.stringify(dir)}, "--allow-mutations", "--disposable"];
await import(${JSON.stringify(import.meta.resolve("../../work/2026-11-jg-descriptors/undo-q1.ts"))});
`;
		const child = Bun.spawn(
			[process.execPath, "--no-env-file", "--eval", program],
			{ cwd: dir, env: {}, stdout: "pipe", stderr: "pipe" },
		);
		const [exitCode, stdout, stderr] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
		]);
		expect(exitCode).not.toBe(0);
		expect(stderr).toContain(
			failRestore
				? "q1: /snmp restore failed: restore rejected"
				: "receive failed",
		);
		expect(await Bun.file(restored).json()).toEqual([
			"/snmp/set",
			"contact=original contact",
			"location=original location",
		]);
		expect(await Bun.file(stopped).text()).toBe("closed");
		expect(existsSync(join(dir, "q1.json"))).toBe(false);
		expect(stdout).not.toContain("q1: wrote");
	});
}
