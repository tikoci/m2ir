// cspell:ignore webfig jsproxy
// Browser init script for capture.ts: record WebFig's plaintext M2 above
// the /jsproxy cipher. Runs before any page script.
//
// master.js is an ES module, so its post()/buffer2msgs() are not
// reachable. Its AES128_CTR class calls the global CryptoJS.AES
// encrypt/decrypt (crypto.js is a classic script), so wrapping those two
// sees every plaintext message: TX is one M2 message (msg2buffer output) or a
// file path (encryptURI); RX is a run of [u32 BE length][M2] frames.
// XMLHttpRequest hooks tie each plaintext to its HTTP exchange:
//   - send() numbers the exchange (x) and flushes the TX plaintext messages
//     encrypted since the previous send;
//   - reading .response marks which exchange the next decrypt belongs to
//     (request() reads it right before session.decryptUint8Array()).
// Events go to the Playwright binding __m2irEmit. No crypto is
// reimplemented and nothing is decoded here; capture.ts decodes offline.
(() => {
	const emit = (ev) => {
		try {
			window.__m2irEmit(ev);
		} catch (_) {
			// binding missing: drop rather than break WebFig
		}
	};
	const now = () => Math.round(performance.now());
	const hex = (u8) => {
		let s = "";
		for (const b of u8) s += b.toString(16).padStart(2, "0");
		return s;
	};
	const wordsToBytes = (wa) => {
		const out = new Uint8Array(wa.sigBytes);
		for (let i = 0; i < wa.sigBytes; i++) {
			out[i] = (wa.words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
		}
		return out;
	};
	let nextX = 0;
	let rxCtx = null;
	let pendingTx = [];
	window.__m2irMark = (label, extra) =>
		emit({ k: "mark", t: now(), label, ...(extra ?? {}) });

	const XP = XMLHttpRequest.prototype;
	const origOpen = XP.open;
	const origSend = XP.send;
	XP.open = function (method, url, ...rest) {
		try {
			const u = new URL(url, location.href);
			this.__m2 = { method, path: u.pathname, query: u.search.length > 1 };
		} catch (_) {
			this.__m2 = { method, path: String(url), query: false };
		}
		return origOpen.call(this, method, url, ...rest);
	};
	XP.send = function (body) {
		const info = this.__m2 ?? { method: "?", path: "?", query: false };
		const x = ++nextX;
		info.x = x;
		const t0 = now();
		const queued = pendingTx;
		pendingTx = [];
		emit({
			k: "send",
			t: t0,
			x,
			method: info.method,
			path: info.path,
			bytes: body?.byteLength ?? body?.length ?? 0,
		});
		for (const p of queued) emit({ ...p, x });
		this.addEventListener("loadend", () =>
			emit({ k: "done", t: now(), x, status: this.status, ms: now() - t0 }),
		);
		return origSend.call(this, body);
	};
	const respDesc = Object.getOwnPropertyDescriptor(XP, "response");
	Object.defineProperty(XP, "response", {
		...respDesc,
		get() {
			rxCtx = this.__m2?.x ?? null;
			return respDesc.get.call(this);
		},
	});

	const install = () => {
		const AES = window.CryptoJS?.AES;
		if (!AES || AES.__m2ir) return false;
		const enc = AES.encrypt;
		const dec = AES.decrypt;
		AES.encrypt = function (message, ...rest) {
			try {
				const pt = wordsToBytes(message);
				const isM2 = pt[0] === 0x4d && pt[1] === 0x32;
				pendingTx.push(
					isM2
						? { k: "tx", t: now(), hex: hex(pt) }
						: { k: "uri", t: now(), path: new TextDecoder().decode(pt) },
				);
			} catch (e) {
				emit({ k: "hook-error", t: now(), where: "encrypt", err: String(e) });
			}
			return enc.call(this, message, ...rest);
		};
		AES.decrypt = function (...args) {
			const out = dec.apply(this, args);
			try {
				emit({ k: "rx", t: now(), x: rxCtx, hex: hex(wordsToBytes(out)) });
			} catch (e) {
				emit({ k: "hook-error", t: now(), where: "decrypt", err: String(e) });
			}
			return out;
		};
		AES.__m2ir = true;
		emit({ k: "hooked", t: now() });
		return true;
	};
	// crypto.js is a classic script in <head>; WebFig creates its Session
	// from window.onload, so DOMContentLoaded is early enough.
	document.addEventListener("DOMContentLoaded", () => {
		if (!install()) emit({ k: "hook-error", t: now(), where: "install" });
	});
})();
