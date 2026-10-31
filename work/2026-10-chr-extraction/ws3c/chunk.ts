// WS-3C: WinBox chunked transport framing + streaming TCP reader.
// See profiles/winbox-ipc/transport.yaml: each chunk is
// [len:u1][tag:u1][payload:len], len==0xFF means more follow, first
// chunk carries the message tag (0x01/0x06), continuations use 0xFF.
import { connect, type Socket } from "node:net";

/** Split an assembled payload into wire chunks under the given first tag. */
export function frameMessage(tag: number, payload: Uint8Array): Uint8Array {
	const pieces: Uint8Array[] = [];
	let off = 0;
	let first = true;
	for (;;) {
		const take = Math.min(0xff, payload.length - off);
		const head = new Uint8Array([take, first ? tag : 0xff]);
		pieces.push(head, payload.subarray(off, off + take));
		off += take;
		first = false;
		// A 0xFF-length chunk MUST be followed by another chunk, so an
		// exact multiple of 255 needs a trailing empty chunk.
		if (off >= payload.length && take < 0xff) break;
	}
	const total = pieces.reduce((n, p) => n + p.length, 0);
	const out = new Uint8Array(total);
	let cursor = 0;
	for (const p of pieces) {
		out.set(p, cursor);
		cursor += p.length;
	}
	return out;
}

export interface ChunkedMessage {
	tag: number;
	payload: Uint8Array;
}

interface Waiter {
	need: number;
	resolve: () => void;
	reject: (err: Error) => void;
}

/** Buffered reader that reassembles chunked messages from a socket. */
export class ChunkConn {
	private sock: Socket;
	private buf: Uint8Array = new Uint8Array(0);
	private waiter: Waiter | null = null;
	private failed: Error | null = null;
	private closed = false;

	private constructor(sock: Socket) {
		this.sock = sock;
		sock.on("data", (d: Buffer) => {
			const next = new Uint8Array(this.buf.length + d.length);
			next.set(this.buf, 0);
			next.set(d, this.buf.length);
			this.buf = next;
			this.pump();
		});
		sock.on("error", (e: Error) => this.fail(e));
		sock.on("close", () => {
			this.closed = true;
			this.fail(new Error("ws3c: socket closed"));
		});
		sock.on("timeout", () => {
			this.fail(new Error("ws3c: socket timeout"));
			sock.destroy();
		});
	}

	static open(
		host: string,
		port: number,
		timeoutMs: number,
	): Promise<ChunkConn> {
		return new Promise((resolve, reject) => {
			const sock = connect({ host, port });
			sock.setTimeout(timeoutMs);
			sock.once("connect", () => resolve(new ChunkConn(sock)));
			sock.once("error", (e: Error) => reject(e));
		});
	}

	private fail(err: Error): void {
		if (this.failed) return;
		this.failed = err;
		if (this.waiter) {
			const w = this.waiter;
			this.waiter = null;
			w.reject(err);
		}
	}

	private pump(): void {
		if (this.waiter && this.buf.length >= this.waiter.need) {
			const w = this.waiter;
			this.waiter = null;
			w.resolve();
		}
	}

	private async readExactly(n: number): Promise<Uint8Array> {
		while (this.buf.length < n) {
			if (this.failed) throw this.failed;
			if (this.closed) throw new Error("ws3c: EOF reading socket");
			await new Promise<void>((resolve, reject) => {
				this.waiter = { need: n, resolve, reject };
			});
		}
		const out = this.buf.subarray(0, n);
		this.buf = this.buf.subarray(n);
		return out;
	}

	/** Read one reassembled message (follows 0xFF continuation chunks). */
	async readMessage(): Promise<ChunkedMessage> {
		const parts: Uint8Array[] = [];
		let tag = 0;
		let first = true;
		for (;;) {
			const head = await this.readExactly(2);
			const len = head[0] ?? 0;
			const t = head[1] ?? 0;
			if (first) {
				tag = t;
				first = false;
			} else if (t !== 0xff) {
				throw new Error(`ws3c: continuation tag ${t}, want 0xff`);
			}
			if (len > 0) parts.push(await this.readExactly(len));
			if (len < 0xff) break;
		}
		const total = parts.reduce((n, p) => n + p.length, 0);
		const payload = new Uint8Array(total);
		let cursor = 0;
		for (const p of parts) {
			payload.set(p, cursor);
			cursor += p.length;
		}
		return { tag, payload };
	}

	async write(bytes: Uint8Array): Promise<void> {
		if (this.failed) throw this.failed;
		await new Promise<void>((resolve, reject) => {
			this.sock.write(bytes, (e?: Error | null) => (e ? reject(e) : resolve()));
		});
	}

	close(): void {
		this.sock.destroy();
	}
}
