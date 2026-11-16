/**
 * Long-running hub for request studies: links every CHR through `station.ts` and exposes a
 * small control API on 127.0.0.1:15699 so a study script can inject frames and read what came
 * back without tearing the segment down between runs.
 *
 *   bun work/2026-11-mndp-grounding/hub.ts mndp2-obs=15681 mndp2-sub=15682 ...
 *
 *   POST /send   {family: 4|6, dst, dstMac?, srcMac?, src?, sport, dport?, payloadHex} → {t}
 *   GET  /frames?since=<t>  → {now, frames, other} (frames at or after t)
 */
import { openStation, udp4Frame, udp6Frame } from "./station.ts";

const ports = Object.fromEntries(
	process.argv.slice(2).map((a) => {
		const [name, port] = a.split("=");
		return [name as string, Number(port)];
	}),
);
const st = await openStation(ports);
console.log(`hub: linked ${Object.keys(ports).join(", ")}`);

Bun.serve({
	hostname: "127.0.0.1",
	port: 15699,
	async fetch(req) {
		const url = new URL(req.url);
		if (req.method === "POST" && url.pathname === "/send") {
			const b = (await req.json()) as {
				family: 4 | 6;
				dst: string;
				dstMac?: string;
				srcMac?: string;
				src?: string;
				sport: number;
				dport?: number;
				payloadHex: string;
			};
			const payload = Buffer.from(b.payloadHex, "hex");
			const f =
				b.family === 6
					? udp6Frame({
							dst: b.dst,
							dstMac: b.dstMac,
							srcMac: b.srcMac,
							sport: b.sport,
							dport: b.dport,
							payload,
						})
					: udp4Frame({
							dst: b.dst,
							dstMac: b.dstMac,
							srcMac: b.srcMac,
							src: b.src,
							sport: b.sport,
							dport: b.dport,
							payload,
						});
			const t = st.now();
			st.send(f);
			return Response.json({ t });
		}
		if (url.pathname === "/frames") {
			const since = Number(url.searchParams.get("since") ?? 0);
			return Response.json({
				now: st.now(),
				frames: st.frames.filter((f) => f.t >= since),
				other: st.other.filter((o) => o.t >= since),
			});
		}
		return new Response("not found", { status: 404 });
	},
});
