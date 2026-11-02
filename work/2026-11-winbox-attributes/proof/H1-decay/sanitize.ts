// H1 control-envelope sanitizer: keep data + via/operation proof, drop
// hosts, ports, credentials, and settings blocks. Reads a raw centrs
// envelope from stdin, writes sanitized JSON to stdout.
// Usage: centrs retrieve ... --format json | bun sanitize.ts > control-*.json
interface EnvelopeRequest {
	path?: unknown;
}

interface EnvelopeOperation {
	kind?: unknown;
	objectCount?: unknown;
	request?: EnvelopeRequest;
}

interface EnvelopeMeta {
	via?: unknown;
	operation?: EnvelopeOperation;
}

interface EnvelopeError {
	code?: unknown;
	summary?: unknown;
	message?: unknown;
	remediation?: unknown;
	cause?: unknown;
	context?: { command?: unknown; message?: unknown };
}

interface Envelope {
	ok?: unknown;
	data?: unknown;
	warnings?: unknown;
	tips?: unknown;
	error?: EnvelopeError;
	meta?: EnvelopeMeta;
}

const raw = (await Bun.stdin.json()) as Envelope;
const op = raw.meta?.operation;
const req = op?.request;
const rawErr = raw.error;
const errCtx = rawErr?.context;
const out = {
	ok: raw.ok ?? null,
	data: raw.data ?? null,
	warnings: raw.warnings ?? [],
	tips: raw.tips ?? [],
	...(rawErr === undefined
		? {}
		: {
				error: {
					code: rawErr.code ?? null,
					summary: rawErr.summary ?? null,
					message: rawErr.message ?? null,
					remediation: rawErr.remediation ?? null,
					cause: rawErr.cause ?? null,
					context: {
						command: errCtx?.command ?? null,
						message: errCtx?.message ?? null,
					},
				},
			}),
	meta: {
		via: raw.meta?.via ?? null,
		operation: {
			kind: op?.kind ?? null,
			objectCount: op?.objectCount ?? null,
			path: req?.path ?? null,
		},
	},
};
console.log(JSON.stringify(out, null, 2));
