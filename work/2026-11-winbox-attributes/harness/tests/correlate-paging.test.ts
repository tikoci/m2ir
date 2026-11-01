// Phase B acceptance: request/reply correlation, async separation,
// timeouts/retries, and GETALL paging over scripted fakes.
// No live router needed; the fakes speak hand-written M2 bytes.
import { describe, expect, test } from "bun:test";

import type { M2Message } from "../../../2026-10-chr-extraction/ws3c/m2.ts";
import {
	type CorrelatedTransport,
	correlatedRequest,
	nextReqId,
} from "../correlate.ts";
import { type FetchPage, getAllPages, splitPage } from "../paging.ts";

const bx = (hex: string): Uint8Array => new Uint8Array(Buffer.from(hex, "hex"));

// Minimal reply carrying SYS_REQID=<id>: 4d32 0600ff09 <id>.
const replyFor = (id: number): Uint8Array =>
	bx(`4d320600ff09${id.toString(16).padStart(2, "0")}`);

function scripted(script: (() => Promise<Uint8Array>)[]): {
	transport: CorrelatedTransport;
	sent: Uint8Array[];
} {
	const sent: Uint8Array[] = [];
	let i = 0;
	return {
		sent,
		transport: {
			send: (plain: Uint8Array): Promise<void> => {
				sent.push(plain);
				return Promise.resolve();
			},
			recv: (): Promise<Uint8Array> => {
				const step = script[i];
				i += 1;
				if (!step) return new Promise(() => {});
				return step();
			},
		},
	};
}

const REQUEST = bx("4d320600ff0902");

describe("correlatedRequest", () => {
	test("matches the reply by reqid", async () => {
		const { transport, sent } = scripted([() => Promise.resolve(replyFor(2))]);
		const out = await correlatedRequest(transport, REQUEST, 2, {
			timeoutMs: 500,
		});
		expect(out.status).toBe("ok");
		if (out.status === "ok") {
			expect(out.reqId).toBe(2);
			expect(out.statusWord).toBe(null); // absent field, not assumed OK
			expect(out.asyncSeen).toEqual([]);
			expect(out.attempts).toBe(1);
		}
		expect(sent.length).toBe(1);
	});

	test("stashes async traffic and keeps waiting", async () => {
		const { transport } = scripted([
			() => Promise.resolve(replyFor(99)), // someone else's reply
			() => Promise.resolve(bx("4d320400ff0901")), // no reqid at all
			() => Promise.resolve(replyFor(2)),
		]);
		const out = await correlatedRequest(transport, REQUEST, 2, {
			timeoutMs: 500,
		});
		expect(out.status).toBe("ok");
		if (out.status === "ok") {
			expect(out.asyncSeen.length).toBe(2);
			expect(out.asyncSeen[0]?.reqId).toBe(99);
			expect(out.asyncSeen[1]?.reqId).toBe(null);
			// Async records keep full bytes for later analysis.
			expect(out.asyncSeen[0]?.plaintextHex).toBe("4d320600ff0963");
		}
	});

	test("router error (status=2) is distinct from transport failure", async () => {
		const errReply = bx(
			"4d32" + "0600ff09" + "02" + "0400ff09" + "02" + "0800ff08" + "03000000",
		);
		const { transport } = scripted([() => Promise.resolve(errReply)]);
		const out = await correlatedRequest(transport, REQUEST, 2, {
			timeoutMs: 500,
		});
		expect(out.status).toBe("router-error");
		if (out.status === "router-error") {
			expect(out.errno).toBe(3);
			expect(out.errstr).toBe(null);
		}
	});

	test("timeout is explicit and carries attempts", async () => {
		const { transport } = scripted([]);
		const out = await correlatedRequest(transport, REQUEST, 2, {
			timeoutMs: 30,
		});
		expect(out.status).toBe("timeout");
		if (out.status === "timeout") {
			expect(out.waitedMs).toBe(30);
			expect(out.attempts).toBe(1);
		}
	});

	test("retry sends again on timeout only and then succeeds", async () => {
		const { transport, sent } = scripted([
			() => new Promise(() => {}), // first attempt starves
			() => Promise.resolve(replyFor(2)),
		]);
		const out = await correlatedRequest(transport, REQUEST, 2, {
			timeoutMs: 30,
			attempts: 2,
		});
		expect(out.status).toBe("ok");
		if (out.status === "ok") expect(out.attempts).toBe(2);
		expect(sent.length).toBe(2);
	});

	test("decode error retains bytes and stops the wait", async () => {
		const { transport } = scripted([() => Promise.resolve(bx("4d320100fe80"))]);
		const out = await correlatedRequest(transport, REQUEST, 2, {
			timeoutMs: 500,
		});
		expect(out.status).toBe("decode-error");
		if (out.status === "decode-error") {
			expect(out.error).toMatch(/0x80/);
			expect(out.rawHex).toBe("4d320100fe80");
		}
	});

	test("async overflow is explicit, not a silent drop", async () => {
		const { transport } = scripted([
			() => Promise.resolve(replyFor(9)),
			() => Promise.resolve(replyFor(9)),
		]);
		const out = await correlatedRequest(transport, REQUEST, 2, {
			timeoutMs: 500,
			maxAsync: 1,
		});
		expect(out.status).toBe("async-overflow");
	});

	test("attempts < 1 is a caller bug, rejected loudly", async () => {
		const { transport } = scripted([]);
		await expect(
			correlatedRequest(transport, REQUEST, 2, { timeoutMs: 10, attempts: 0 }),
		).rejects.toThrow(/attempts/);
	});

	test("nextReqId allocates upward from the adoption leg", () => {
		expect(nextReqId(1)).toBe(2);
		expect(nextReqId(2)).toBe(3);
		expect(() => nextReqId(0)).toThrow(/reqid/);
	});
});

describe("splitPage", () => {
	const emptyRow: M2Message = { entries: [] };

	test("bare complete page: rows present, no token", () => {
		const page: M2Message = {
			entries: [
				{
					fullKey: 0xfe0002,
					byte2: 0xfe,
					keyId: 2,
					tcode: 0xa8,
					value: [emptyRow, emptyRow],
				},
			],
		};
		const { rows, rowsFieldAbsent, nextToken } = splitPage(page);
		expect(rows.length).toBe(2);
		expect(rowsFieldAbsent).toBe(false);
		expect(nextToken).toBe(null);
	});

	test("absent 0xfe0002 is distinct from an empty list", () => {
		const absent = splitPage({ entries: [] });
		expect(absent.rows).toEqual([]);
		expect(absent.rowsFieldAbsent).toBe(true);
		const empty: M2Message = {
			entries: [
				{ fullKey: 0xfe0002, byte2: 0xfe, keyId: 2, tcode: 0xa8, value: [] },
			],
		};
		const got = splitPage(empty);
		expect(got.rows).toEqual([]);
		expect(got.rowsFieldAbsent).toBe(false);
	});

	test("non-array 0xfe0002 and non-numeric token are rejected", () => {
		const badRows: M2Message = {
			entries: [
				{ fullKey: 0xfe0002, byte2: 0xfe, keyId: 2, tcode: 0x08, value: 1 },
			],
		};
		expect(() => splitPage(badRows)).toThrow(/not an array/);
		const badToken: M2Message = {
			entries: [
				{ fullKey: 0xfe0003, byte2: 0xfe, keyId: 3, tcode: 0x21, value: "x" },
			],
		};
		expect(() => splitPage(badToken)).toThrow(/not a number/);
	});
});

describe("getAllPages", () => {
	const row = (id: number): M2Message => ({
		entries: [
			{ fullKey: 0xfe0001, byte2: 0xfe, keyId: 1, tcode: 0x09, value: id },
		],
	});
	const pageWith = (rows: M2Message[], token: number | null): M2Message => ({
		entries: [
			{ fullKey: 0xfe0002, byte2: 0xfe, keyId: 2, tcode: 0xa8, value: rows },
			...(token === null
				? []
				: [
						{
							fullKey: 0xfe0003,
							byte2: 0xfe,
							keyId: 3,
							tcode: 0x08,
							value: token,
						},
					]),
		],
	});

	test("single bare page completes", async () => {
		const seen: (number | null)[] = [];
		const fetch: FetchPage = (start: number | null) => {
			seen.push(start);
			return Promise.resolve({ status: "ok", page: pageWith([row(1)], null) });
		};
		const out = await getAllPages(fetch);
		expect(out.complete).toBe(true);
		if (out.complete) {
			expect(out.rows.length).toBe(1);
			expect(out.pages).toBe(1);
		}
		expect(seen).toEqual([null]); // bare first page, no count=0
	});

	test("follows the token chain in order", async () => {
		const seen: (number | null)[] = [];
		const fetch: FetchPage = (start: number | null) => {
			seen.push(start);
			if (start === null) {
				return Promise.resolve({ status: "ok", page: pageWith([row(1)], 5) });
			}
			if (start === 5) {
				return Promise.resolve({ status: "ok", page: pageWith([row(2)], 9) });
			}
			return Promise.resolve({ status: "ok", page: pageWith([row(3)], null) });
		};
		const out = await getAllPages(fetch);
		expect(out.complete).toBe(true);
		if (out.complete) {
			expect(out.rows.length).toBe(3);
			expect(out.pages).toBe(3);
		}
		expect(seen).toEqual([null, 5, 9]);
	});

	test("repeated token ends incomplete with a loop cause", async () => {
		const fetch: FetchPage = (start: number | null) =>
			Promise.resolve({
				status: "ok",
				page: pageWith([row(1)], start === null ? 5 : start),
			});
		const out = await getAllPages(fetch);
		expect(out.complete).toBe(false);
		if (!out.complete) {
			expect(out.cause).toMatch(/cursor-loop token=5/);
			expect(out.rows.length).toBe(2);
		}
	});

	test("page bound ends incomplete instead of looping forever", async () => {
		let n = 0;
		const fetch: FetchPage = () => {
			n += 1;
			return Promise.resolve({
				status: "ok",
				page: pageWith([row(n)], 1000 + n),
			});
		};
		const out = await getAllPages(fetch, { maxPages: 3 });
		expect(out.complete).toBe(false);
		if (!out.complete) {
			expect(out.cause).toMatch(/page-limit/);
			expect(out.pages).toBe(3);
			expect(out.rows.length).toBe(3);
		}
	});

	test("page error ends incomplete with errno cause", async () => {
		const fetch: FetchPage = (start: number | null) => {
			if (start === null) {
				return Promise.resolve({ status: "ok", page: pageWith([row(1)], 5) });
			}
			return Promise.resolve({
				status: "error",
				page: { entries: [] },
				errno: 0xfe0003,
				errstr: null,
			});
		};
		const out = await getAllPages(fetch);
		expect(out.complete).toBe(false);
		if (!out.complete) {
			expect(out.cause).toMatch(/page-error errno=0xfe0003/);
			expect(out.rows.length).toBe(1);
		}
	});
});
