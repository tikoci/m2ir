// cspell:ignore aabbcc
// Phase B acceptance: chunked-transport framing over real sockets,
// plus the lossless capture layer (full bytes, decode-error retention).

import { describe, expect, test } from "bun:test";
import { createServer, type Server, type Socket } from "node:net";

import {
	ChunkConn,
	frameMessage,
} from "../../../2026-10-chr-extraction/ws3c/chunk.ts";
import { decodeM2 } from "../../../2026-10-chr-extraction/ws3c/m2.ts";
import {
	appendCapture,
	captureMessage,
	losslessMessage,
	readCapture,
	replayBytes,
} from "../capture.ts";

const bx = (hex: string): Uint8Array => new Uint8Array(Buffer.from(hex, "hex"));

async function withServer(
	onConn: (sock: Socket) => void,
	run: (port: number) => Promise<void>,
): Promise<void> {
	const server: Server = createServer(onConn);
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const addr = server.address();
	if (typeof addr !== "object" || addr === null) {
		throw new Error("test: no server address");
	}
	try {
		await run(addr.port);
	} finally {
		server.close();
	}
}

describe("chunk framing", () => {
	test("exact 255-multiple payloads get a trailing empty chunk", () => {
		const payload = new Uint8Array(510).fill(0xab);
		const framed = frameMessage(0x06, payload);
		// 3 chunks: 255 + 255 + 0, each with a 2-byte head.
		expect(framed.length).toBe(510 + 6);
		expect(framed[0]).toBe(0xff);
		expect(framed[1]).toBe(0x06);
		expect(framed[257]).toBe(0xff);
		expect(framed[258]).toBe(0xff);
		expect(framed[514]).toBe(0x00);
		expect(framed[515]).toBe(0xff);
	});

	test("fragmented delivery reassembles (1-byte writes)", async () => {
		const payload = bx("4d32" + "0600ff09" + "02");
		await withServer(
			(sock) => {
				const framed = frameMessage(0x06, payload);
				let i = 0;
				const tick = (): void => {
					if (i >= framed.length) return;
					sock.write(Buffer.from(framed.subarray(i, i + 1)));
					i += 1;
					setImmediate(tick);
				};
				tick();
			},
			async (port) => {
				const conn = await ChunkConn.open("127.0.0.1", port, 5000);
				const msg = await conn.readMessage();
				conn.close();
				expect(msg.tag).toBe(0x06);
				expect(Buffer.from(msg.payload).toString("hex")).toBe(
					Buffer.from(payload).toString("hex"),
				);
			},
		);
	});

	test("coalesced delivery splits (two messages, one write)", async () => {
		const a = bx("4d32" + "0600ff09" + "02");
		const b = bx("4d32" + "0600ff09" + "03");
		await withServer(
			(sock) => {
				const fa = frameMessage(0x06, a);
				const fb = frameMessage(0x06, b);
				sock.write(Buffer.concat([fa, fb]));
			},
			async (port) => {
				const conn = await ChunkConn.open("127.0.0.1", port, 5000);
				const m1 = await conn.readMessage();
				const m2 = await conn.readMessage();
				conn.close();
				expect(decodeM2(m1.payload).entries[0]?.value).toBe(2);
				expect(decodeM2(m2.payload).entries[0]?.value).toBe(3);
			},
		);
	});

	test("bad continuation tag fails explicitly", async () => {
		await withServer(
			(sock) => {
				// First chunk claims continuation (len 0xff) but the next
				// chunk carries a non-0xff tag.
				const bad = new Uint8Array([
					0xff,
					0x06,
					...new Uint8Array(255),
					0x01,
					0x06,
					0x00,
				]);
				sock.write(Buffer.from(bad));
			},
			async (port) => {
				const conn = await ChunkConn.open("127.0.0.1", port, 5000);
				await expect(conn.readMessage()).rejects.toThrow(/continuation/);
				conn.close();
			},
		);
	});
});

describe("lossless capture", () => {
	test("records full bytes with no truncation", () => {
		const big = new Uint8Array(600).fill(0xcd);
		const rec = captureMessage(7, "rx", big);
		expect(rec.seq).toBe(7);
		expect(rec.plaintextHex.length).toBe(1200);
		expect(rec.decode.ok).toBe(false); // no M2 magic -> explicit error
		if (!rec.decode.ok) expect(rec.decode.error).toMatch(/magic/);
	});

	test("extracts reqid/routes/cmd from a real request shape", () => {
		const req = bx(
			"4d320500ff010600ff09010700ff09070100ff88" +
				"02000d000000040000000200ff880200000000000b000000",
		);
		const rec = captureMessage(0, "tx", req);
		expect(rec.decode.ok).toBe(true);
		expect(rec.reqId).toBe(1);
		expect(rec.to).toEqual([13, 4]);
		expect(rec.from).toEqual([0, 11]);
		expect(rec.cmd).toBe(7);
	});

	test("unknown tcode keeps the original message", () => {
		const bad = bx("4d32" + "0100fe80");
		const rec = captureMessage(3, "rx", bad, "tcode probe");
		expect(rec.decode.ok).toBe(false);
		expect(rec.plaintextHex).toBe("4d320100fe80");
		expect(rec.note).toBe("tcode probe");
	});

	test("lossless rendering preserves order, repeats, and full bytes", () => {
		const m = decodeM2(
			bx(
				"4d32" +
					"05000009" +
					"01" +
					"01000031" +
					"03aabbcc" +
					"05000009" +
					"02",
			),
		);
		expect(losslessMessage(m)).toEqual([
			{ key: "0x000005", tcode: "0x9", value: 1 },
			{ key: "0x000001", tcode: "0x31", value: "hex:aabbcc" },
			{ key: "0x000005", tcode: "0x9", value: 2 },
		]);
	});

	test("JSONL append/read round-trips and rejects malformed lines", async () => {
		// biome-ignore lint/complexity/useLiteralKeys: TS4111 requires bracket access on index signatures
		const tmpdir = process.env["TMPDIR"] ?? "/tmp";
		const path = `${tmpdir}/m2ir-capture-test.jsonl`;
		try {
			const rec = captureMessage(0, "tx", bx("4d320600ff0902"));
			appendCapture(path, rec);
			const back = readCapture(path);
			expect(back.length).toBe(1);
			const first = back[0];
			if (!first) throw new Error("test: capture line missing");
			expect(first.plaintextHex).toBe("4d320600ff0902");
			expect(replayBytes(first).entries[0]?.value).toBe(2);
			await Bun.write(path, "not json\n");
			expect(() => readCapture(path)).toThrow(/line 1/);
		} finally {
			await Bun.$`rm -f ${path}`.quiet();
		}
	});
});
