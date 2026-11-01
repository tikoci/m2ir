// Phase B harness: GETALL pagination with explicit completion.
//
// Protocol (profiles/winbox-ipc/std-keys.yaml 0xfe0003/0xfe0004):
// bare GETALL, then follow 0xfe0003 next-start tokens as the next start.
// Only server-issued tokens are meaningful; start semantics are
// per-handler ([20,1] validates, [20,0] takes lower_bound). This module
// never sends count=0: on v7 that yields 0 rows plus a token pointing
// at the SECOND entry (count quirk, std-keys.yaml 0xfe0004 notes).
import {
	findEntry,
	type M2Message,
} from "../../2026-10-chr-extraction/ws3c/m2.ts";

export interface PageOk {
	status: "ok";
	page: M2Message;
}

export interface PageError {
	status: "error";
	page: M2Message;
	errno: number | null;
	errstr: string | null;
}

export type PageFetchResult = PageOk | PageError;

/**
 * Fetch one page. start=null means the bare first page; otherwise the
 * server-issued 0xfe0003 token from the previous page.
 */
export type FetchPage = (start: number | null) => Promise<PageFetchResult>;

export interface PagedComplete {
	complete: true;
	rows: M2Message[];
	pages: number;
	/** True when a page lacked the 0xfe0002 rows field (vs an empty list). */
	rowsFieldAbsent: boolean;
}

export interface PagedIncomplete {
	complete: false;
	rows: M2Message[];
	pages: number;
	cause: string;
	nextToken: number | null;
}

export type PagedResult = PagedComplete | PagedIncomplete;

export interface PagingOptions {
	/** Hard page bound before incomplete/page-limit (default 1000). */
	maxPages?: number;
}

/** Extract rows + next token from one GETALL reply, validating shapes. */
export function splitPage(page: M2Message): {
	rows: M2Message[];
	rowsFieldAbsent: boolean;
	nextToken: number | null;
} {
	const rowsEntry = findEntry(page, 0xfe0002);
	let rows: M2Message[] = [];
	let rowsFieldAbsent = false;
	if (rowsEntry === undefined) {
		rowsFieldAbsent = true;
	} else {
		const v = rowsEntry.value;
		if (!Array.isArray(v)) {
			throw new Error("paging: 0xfe0002 is not an array");
		}
		for (const item of v) {
			if (
				typeof item !== "object" ||
				item === null ||
				item instanceof Uint8Array
			) {
				throw new Error("paging: 0xfe0002 item is not a message");
			}
		}
		rows = v as M2Message[];
	}
	const tokenEntry = findEntry(page, 0xfe0003);
	let nextToken: number | null = null;
	if (tokenEntry !== undefined) {
		if (typeof tokenEntry.value !== "number") {
			throw new Error("paging: 0xfe0003 token is not a number");
		}
		nextToken = tokenEntry.value;
	}
	return { rows, rowsFieldAbsent, nextToken };
}

/**
 * Walk the full GETALL chain. Returns complete:true only when a page
 * carries no next token; loops, page errors, and the page bound all
 * return complete:false with the rows collected so far and a cause.
 */
export async function getAllPages(
	fetch: FetchPage,
	opts?: PagingOptions,
): Promise<PagedResult> {
	const maxPages = opts?.maxPages ?? 1000;
	if (maxPages < 1) throw new Error("paging: maxPages must be >= 1");
	const rows: M2Message[] = [];
	const seen = new Set<number>();
	let rowsFieldAbsent = false;
	let start: number | null = null;
	let pages = 0;
	for (;;) {
		pages += 1;
		if (pages > maxPages) {
			return {
				complete: false,
				rows,
				pages: pages - 1,
				cause: `page-limit maxPages=${maxPages}`,
				nextToken: start,
			};
		}
		const res = await fetch(start);
		if (res.status === "error") {
			const errnoText =
				res.errno === null ? "absent" : `0x${res.errno.toString(16)}`;
			const errstrText =
				res.errstr === null ? "" : ` errstr=${JSON.stringify(res.errstr)}`;
			return {
				complete: false,
				rows,
				pages,
				cause: `page-error errno=${errnoText}${errstrText}`,
				nextToken: start,
			};
		}
		const {
			rows: got,
			rowsFieldAbsent: absent,
			nextToken,
		} = splitPage(res.page);
		rows.push(...got);
		rowsFieldAbsent = rowsFieldAbsent || absent;
		if (nextToken === null) {
			return { complete: true, rows, pages, rowsFieldAbsent };
		}
		if (seen.has(nextToken)) {
			return {
				complete: false,
				rows,
				pages,
				cause: `cursor-loop token=${nextToken}`,
				nextToken,
			};
		}
		seen.add(nextToken);
		start = nextToken;
	}
}
