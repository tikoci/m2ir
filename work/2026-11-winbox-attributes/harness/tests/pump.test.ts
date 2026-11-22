// Offline tests for pump.ts: one reader, reqid-matched replies, an inbox
// for unsolicited traffic, timed listen windows. No CHR needed.
import { describe, expect, test } from "bun:test";

import {
	encodeM2,
	encU32,
	encU32Array,
} from "../../../2026-10-chr-extraction/ws3c/m2.ts";
import type { CorrelatedTransport } from "../correlate.ts";
import { MessagePump } from "../pump.ts";

/** A transport whose recv() yields queued frames; push() feeds it. */
function fakeTransport() {
	const queue: Uint8Array[] = [];
	const waiting: Array<(b: Uint8Array) => void> = [];
	let closed: ((e: Error) => void) | null = null;
	const sent: Uint8Array[] = [];
	const t: CorrelatedTransport & {
		push: (b: Uint8Array) => void;
		close: () => void;
		sent: Uint8Array[];
	} = {
		sent,
		send: async (b) => {
			sent.push(b);
		},
		recv: () =>
			new Promise<Uint8Array>((resolve, reject) => {
				const next = queue.shift();
				if (next) resolve(next);
				else {
					waiting.push(resolve);
					closed = reject;
				}
			}),
		push: (b) => {
			const w = waiting.shift();
			if (w) w(b);
			else queue.push(b);
		},
		close: () => closed?.(new Error("closed")),
	};
	return t;
}

const reply = (reqId: number) =>
	encodeM2([encU32Array(0xff0001, [0, 11]), encU32(0xff0006, reqId)]);
const notify = () =>
	encodeM2([
		encU32Array(0xff0001, [0, 11]),
		encU32Array(0xff0002, [16, 2]),
		encU32(0xff0007, 0xfe000b),
	]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("MessagePump", () => {
	test("request matches its reqid; unsolicited frames stay in the inbox", async () => {
		const t = fakeTransport();
		const pump = new MessagePump(t, { label: "A" });
		const pending = pump.request(reply(9), 7, 1000, "probe");
		t.push(notify());
		t.push(reply(7));
		const out = await pending;
		expect(out.status).toBe("ok");
		if (out.status === "ok") expect(out.rx.reqId).toBe(7);
		const inbox = pump.drain();
		expect(inbox.map((r) => r.cmd)).toEqual([0xfe000b]);
		expect(inbox[0]?.session).toBe("A");
		expect(pump.log.map((r) => r.direction)).toEqual(["tx", "rx", "rx"]);
		await pump.stop(t.close);
	});

	test("timeout returns an outcome; the late reply lands in the inbox", async () => {
		const t = fakeTransport();
		const pump = new MessagePump(t, { label: "A" });
		const out = await pump.request(reply(3), 3, 30);
		expect(out.status).toBe("timeout");
		t.push(reply(3));
		await sleep(5);
		expect(pump.drain().map((r) => r.reqId)).toEqual([3]);
		await pump.stop(t.close);
	});

	test("listenFor returns once a match arrives plus the settle window", async () => {
		const t = fakeTransport();
		const pump = new MessagePump(t, { label: "A" });
		setTimeout(() => t.push(notify()), 20);
		setTimeout(() => t.push(notify()), 40);
		const t0 = performance.now();
		let settled = false;
		const pending = pump
			.listenFor((r) => r.cmd === 0xfe000b, 1000, 100)
			.then((x) => {
				settled = true;
				return x;
			});
		// Inside the settle window (first match at ~20 ms + 100 ms settle):
		// still pending, even though both notifications have arrived.
		await sleep(70);
		expect(settled).toBe(false);
		const got = await pending;
		const elapsed = performance.now() - t0;
		// It waited the settle window, and returned well before maxMs.
		expect(elapsed).toBeGreaterThanOrEqual(115);
		expect(elapsed).toBeLessThan(500);
		expect(got.length).toBe(2);
		expect(await pump.listen(20)).toEqual([]);
		await pump.stop(t.close);
	});

	test("a failed send drops its waiter; a retry with the same reqid gets the reply", async () => {
		const t = fakeTransport();
		const pump = new MessagePump(t, { label: "A" });
		const send = t.send;
		t.send = async () => {
			throw new Error("send failed");
		};
		await expect(pump.request(reply(5), 5, 1000)).rejects.toThrow(
			"send failed",
		);
		t.send = send;
		const pending = pump.request(reply(5), 5, 1000);
		t.push(reply(5));
		const out = await pending;
		expect(out.status).toBe("ok");
		await pump.stop(t.close);
	});

	test("a stalled send times out within the request budget", async () => {
		const t = fakeTransport();
		const pump = new MessagePump(t, { label: "A" });
		t.send = () => new Promise<void>(() => {});
		const t0 = performance.now();
		const out = await pump.request(reply(6), 6, 40);
		expect(out.status).toBe("timeout");
		expect(performance.now() - t0).toBeLessThan(500);
		// The tx record exists even though the send never settled.
		if (out.status === "timeout") expect(out.tx.reqId).toBe(6);
		await pump.stop(t.close);
	});

	test("a capture sink failure is a reader failure, not a timeout", async () => {
		const t = fakeTransport();
		let n = 0;
		const pump = new MessagePump(t, {
			label: "A",
			onCapture: () => {
				if (++n === 2) throw new Error("disk full");
			},
		});
		const pending = pump.request(reply(8), 8, 1000);
		t.push(reply(8));
		await expect(pending).rejects.toThrow("disk full");
		expect(pump.error?.message).toBe("disk full");
		await pump.stop(t.close);
	});

	test("stop() ends the reader without recording a failure", async () => {
		const t = fakeTransport();
		const pump = new MessagePump(t, { label: "A" });
		await pump.stop(t.close);
		expect(pump.error).toBeNull();
	});
});
