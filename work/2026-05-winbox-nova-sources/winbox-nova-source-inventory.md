# WinBox / nova source inventory

This note tracks a May 2026 sweep for public sources that are not
already first-class in `README.md` or `CREDITS.md`. It is an
investigation queue, not a promotion into schema evidence or project
credits.

Current tracked baseline:

- Cisco-Talos `Winbox_Protocol_Dissector`
- MarginResearch / Tenable
- `tikoci/donny`
- `german77/TheDudeToHuman`
- `subixonfire/winbox-terminal-protocol`

## High-value additions

### DEVCORE - Pwn2Own Toronto 2022

- URL: [blog][devcore]
- Type: research blog / exploit writeup
- Concrete facts:
  - explicitly documents RouterOS IPC as nova messages
  - shows loader-mediated routing between processes
  - gives concrete example ids for login, user, and handler dispatch
  - includes a "Review of the IPC and the Nova Message" section
- Why distinct:
  - more explicit about current nova message routing than the currently
    credited sources
  - not just a restatement of Cisco-Talos enum tables
- Usefulness: high
- Caution:
  - exploit-driven; use for architecture and message-routing claims, not
    as a canonical field-name source

### alireza-k7 / winbox-wbx-to-cdb

- URL: [repo][winbox-wbx-to-cdb]
- Type: saved-session converter / format probe
- Concrete facts:
  - built by reverse-engineering a working `test.cdb` sample and import
    testing against WinBox beta
  - defines `WBX_MAGIC = 0f10c0be` and `CDB_MAGIC = 0df01dc0`
  - defines a concrete `CDB_RECORD_PREFIX` beginning with `M2`
  - maps CDB field ids `1`, `2`, `3`, `4`, `8`, `9`, `11`, and `12`
    from WBX fields such as `host`, `login`, `pwd`, `note`, and `group`
- Why distinct:
  - the repo currently has a `winbox-cdb/` placeholder but no public
    source this direct for CDB record structure
  - this is the strongest new lead for the saved-connections profile
- Usefulness: high
- Caution:
  - explicitly sample-driven and interoperability-tested, not official
    documentation

### YATV / WBX-tools

- URL: [repo][wbx-tools]
- Type: saved-session parser / editor
- Concrete facts:
  - parses WBX files with signature `0F 10 C0 BE`
  - treats `00 00` as the record separator
  - supports three TLV layouts named `L2`, `L1`, and `L0`
  - exports named fields `group`, `host`, `login`, `password`, `keep`,
    `note`, `type`, and `secure-mode`
- Why distinct:
  - direct public evidence for WBX layout and field naming
  - useful cross-check against the CDB converter above when the
    `winbox-cdb` profile gets drained
- Usefulness: high
- Caution:
  - focused on saved-session files, not the live WinBox wire protocol

### 0ki / mikrotik-tools plus Kirils Solovjovs slide decks

- URLs: [repo][mikrotik-tools], [rooting slides][kirils-rooting], and
  [reverse-engineering tools slides][kirils-tools]
- Type: tooling repo plus conference slides
- Concrete facts:
  - RouterOS package unpacking and NPK part descriptions
  - `command_trees/` and decode tools for backups, users, and supout
    files
  - repeated `/nova/bin` and jailbreak-oriented architecture notes
- Why distinct:
  - independent reverse-engineering line outside Cisco-Talos, Tenable,
    and MarginResearch
  - strongest public adjacent source for RouterOS binary layout and
    extracting artifacts for follow-up work
- Usefulness: medium
- Caution:
  - more RouterOS internals and extraction than precise WinBox TLV
    layout

### n0p / BASUCERT - WinBox bug dissection

- URL: [blog][n0p]
- Companion repo: [WinboxPoC][basucert-winboxpoc]
- Type: exploit writeup plus PoC
- Concrete facts:
  - identifies `/nova/bin/mproxy` as the WinBox request handler
  - shows packet-level request sequencing and the changing session byte
  - ties pre-auth file read to list retrieval and user database
    extraction
- Why distinct:
  - older but primary writeup for `mproxy`-specific behavior
  - companion PoC includes MAC-WinBox / MACServer scripts, which may
    matter if m2ir later models the layer-2 transport separately
- Usefulness: medium
- Caution:
  - the repo is mostly a companion exploit; the blog is the higher
    signal source

### CVE-2022-45313 hotspot nova message advisory

- URL: [advisory][advisory]
- Type: public advisory / crash analysis
- Concrete facts:
  - concrete command id `0xFE0008`
  - concrete key ids `0xFE000E` and `0xFE000F`
  - default-handler behavior in `/ram/pckg/hotspot/nova/bin/hotspot`
  - code snippet showing how a crafted nova message reaches a handler
    table
- Why distinct:
  - one of the few public sources with exact per-binary nova
    command/key ids outside the already-tracked WinBox sources
- Usefulness: medium
- Caution:
  - authenticated exploit path; specific to hotspot, not WinBox IPC in
    general

### VulnCheck - Foisted revisited

- URL: [blog][vulncheck-foisted]
- Type: exploit writeup
- Concrete facts:
  - modern WinBox-auth behavior differences
  - references `/nova/bin/www` and current exploitation surfaces
- Why distinct:
  - newer than the 2018-2022 sources and useful for post-6.49.x
    behavior
- Usefulness: medium-low
- Caution:
  - more useful for service behavior and attack surface than for nova
    field naming

## Lower-value or derivative leads

- [Rapid7's `mikrotik_winbox_fileread` documentation][rapid7-winbox] is
  useful corroboration for the old file-read flow, but it does not add
  durable format detail beyond the exploit path.
- [MikroTik's official WinBox vulnerability advisory][mikrotik-advisory]
  is worth keeping as vendor confirmation of scope and affected
  versions, but it is not a protocol source.
- [DeepWiki pages for `tenable/routeros`][deepwiki-winbox] are
  convenient summaries, but they are derivative of the already-known
  Tenable repo and should not be treated as a new primary source.
- `asked637/routeros-1` appears to be a fork or mirror of older Tenable
  material; treat as derivative unless it has unique files not present
  upstream.
- The many `WinboxPoC` forks and copies are duplicates of the BASUCERT
  companion repo, not independent evidence.
- General exploit collections such as `Chimay-Red` or broad RouterOS
  reversing repos may still be useful for lab setup, but they did not
  look like strong nova-format sources on this pass.

## GitLab result

No distinct, high-signal GitLab-hosted source turned up in this sweep.
The only clearly relevant GitLab find was an archival mirror of
`WinboxPoC`; treat that as preservation, not as a new primary source.
Public WinBox / nova reverse-engineering material still appears to live
mostly in GitHub repos, personal blogs, and conference PDFs.

## Suggested next drain order

1. DEVCORE for nova routing, loader flow, and process / handler examples
2. `alireza-k7/winbox-wbx-to-cdb` for concrete CDB structure and field
   mapping
3. `YATV/WBX-tools` for WBX layout and field-name cross-checking
4. n0p blog for `mproxy`-specific behavior and session semantics
5. CVE-2022-45313 advisory for per-service command/key ids outside
   WinBox
6. 0ki / Kirils material for RouterOS extraction, `/nova/bin` context,
   and adjacent artifacts that can support later schema evidence

[advisory]: https://github.com/cq674350529/pocs_slides/blob/master/advisory/MikroTik/CVE-2022-45313/README.md
[basucert-winboxpoc]: https://github.com/BasuCert/WinboxPoC
[deepwiki-winbox]: https://deepwiki.com/tenable/routeros/2.1-winbox-protocol-implementation
[devcore]: https://devco.re/blog/2024/05/24/pwn2own-toronto-2022-a-9-year-old-bug-in-mikrotik-routeros-en/
[kirils-rooting]: https://kirils.org/slides/2017-08-06_prez_SHA_MT_pub.pdf
[kirils-tools]: https://kirils.org/slides/2017-10-21_MT_Hacktivity_pub.pdf
[mikrotik-tools]: https://github.com/0ki/mikrotik-tools
[mikrotik-advisory]: https://mikrotik.com/supportsec/winbox-vulnerability
[n0p]: https://blog.n0p.me/2018/05/2018-05-21-winbox-bug-dissection/
[rapid7-winbox]: https://github.com/rapid7/metasploit-framework/blob/master/documentation/modules/auxiliary/gather/mikrotik_winbox_fileread.md
[vulncheck-foisted]: https://www.vulncheck.com/blog/mikrotik-foisted-revisited
[wbx-tools]: https://github.com/YATV/WBX-tools
[winbox-wbx-to-cdb]: https://github.com/alireza-k7/winbox-wbx-to-cdb
