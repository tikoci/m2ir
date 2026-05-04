# concepts/

Cross-profile semantic identity. The same *meaning* — RouterOS identity,
board model, IPv4 address, uptime in seconds, MAC, foreign-key reference
to another object — appears across `nv-message` and `mndp` under
different physical encodings and different tags. A concept lives once
here; profile fields point at it with `concept-ref:`.

Expected slices:

- `network.yaml` — IPv4, IPv6, MAC, subnet, port
- `routeros.yaml` — identity, version, board, license-id
- `time.yaml` — unix-timestamp, uptime-seconds, duration-seconds
- `references.yaml` — obj-id-ref and the foreign-key concept

Splitting by domain (network / routeros / time) rather than by profile is
deliberate: most of the work on a new profile should be re-using known
concepts, not redefining them.

Placeholder.
