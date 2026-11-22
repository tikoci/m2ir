# WebFig plaintext capture (plan step 3)

<!-- cspell:ignore webfig jsproxy quickchr typevalue autorefresh refreshfilter extrastats usr -->

Records the M2 messages that MikroTik's own browser client, WebFig, sends
and receives. It runs WebFig in headless Chromium and hooks it above the
`/jsproxy` cipher. No cryptography is reimplemented, and the client is
MikroTik's, not ours.

## How it hooks

7.x `master.js` is an ES module, so its `post()` and `buffer2msgs()` are
private. Its `AES128_CTR` class calls the global `CryptoJS.AES.encrypt` /
`decrypt` from `crypto.js`, a classic script. [`hook.js`](hook.js) wraps
those two calls:

- TX plaintext is one M2 message (`msg2buffer` output) or a file path
  (`encryptURI`, for example `skins/default.json`).
- RX plaintext is a run of `[u32 BE length][M2]` frames.
- `XMLHttpRequest` hooks tie each plaintext to its HTTP exchange `x`.
  `send()` numbers the exchange, and reading `.response` marks which
  exchange the next decrypt belongs to.

Login is not driven through the form. An init script seeds the
`sessionStorage` `name` / `password` pair, which WebFig's `autoLogin()`
reads and then clears.

6.49 is out of scope: its WebFig is a classic script with RC4 framing
(2-byte frame lengths), and 6.49 has no REST for the second session.

## Run

```bash
quickchr start twin3                       # disposable CHR, 7.25
bun capture.ts twin3 <scratch>/run725      # Bridge workflow, ~2 min
bun transcript.ts <scratch>/run725 --digest
bun transcript.ts <scratch>/run725 ../../../fixtures/winbox-ipc/7.25-webfig-bridge-workflow.jsonl --compact
quickchr stop twin3
```

`bun capture.ts <chr> <dir> --explore` logs in and prints the menu
hashes. `M2IR_EXPLORE_HASH='#Bridge'` lists that page's tabs, and
`M2IR_EXPLORE_CLICK='text=ether1'` also clicks the first match.
Browser: `CHROME_PATH`, else `/usr/bin/chromium`, else Playwright's
download (`bunx playwright-core install chromium`).

`raw.jsonl` is not sanitized: it holds the login password and session
token. Keep it in scratch. `transcript.ts` redacts the login `s3` and
`s2d` and drops their hex. `--compact` shrinks the repeated autorefresh
replies (see its header).

The scenario (in `capture.ts`) uses REST as the second session. It
creates bridge `m2ir-br`, VLAN `m2ir-vl` (vlan-id 3999 on ether1) and a
port for the VLAN. It then opens Bridge, changes the bridge comment,
opens Bridge Ports and changes the port comment. It closes and reopens
both pages, changes both comments while the pages are closed, removes
all three objects with Bridge Ports open, and ends with 45 s of quiet.
[`m2-letters.ts`](m2-letters.ts) decodes plaintext into the letter-keyed
objects that WebFig's `buffer2msg` builds, covering every type, including
`Q` (0x90) and `R` (0xb0).

## Runs (2026-11-21)

| RouterOS | Fixture | master.js |
|---|---|---|
| 7.25 (twin3) | [`7.25-webfig-bridge-workflow.jsonl`](../../../fixtures/winbox-ipc/7.25-webfig-bridge-workflow.jsonl) | `master-27c6b0fb2190e7cc.js` |
| 7.26beta4 (winbox-beta4) | [`7.26beta4-webfig-bridge-workflow.jsonl`](../../../fixtures/winbox-ipc/7.26beta4-webfig-bridge-workflow.jsonl) | `master-881b1b9bb7c7b78e.js` |

The asset hashes and `.jg` unique names are in each fixture's provenance
line. The two versions behave the same at every step. The findings are
in the [README](../README.md#webfig-client-model-7x-master-js-tested-in-step-3).
