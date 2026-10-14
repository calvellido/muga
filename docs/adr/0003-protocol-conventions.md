# 0003: Protocol conventions

Date: 2026-10-14. Status: accepted.

These follow the UNDOK analysis (docs 02, 03, 09) while avoiding the app's known bugs.

1. **PIN on every request; `sid` only for GET_NOTIFIES.** This is the multi-controller-friendly mode UNDOK uses. The default PIN is `1234`.
2. **Form-encoded query values** (`URLSearchParams`, space as `+`), matching what radios receive from UNDOK.
3. **Validate before SET, using the catalog:** read-only, enum names, integer ranges, string byte limits (buffer size minus one). Invalid writes are never sent. UNDOK logs and sends them anyway.
4. **No write probes for capability detection.** Use reads (`sys.caps.*`, FS_NODE_DOES_NOT_EXIST). UNDOK writes `sys.factoryReset=NONE`, `sys.audio.quality=100` and `nav.preset.delete=1000`.
5. **Case-insensitive matching** for node names and list field names. Radios send lower-case field names; the catalog uses camel case.
6. **GET_/SET_MULTIPLE with fallback.** On HTTP 404 (older firmware), switch to single requests for that radio.
7. **One request in flight per radio** by default. These are small devices; UNDOK caps at two. The GET_NOTIFIES long-poll runs outside this queue.
8. **Sessions back off on takeover.** On HTTP 404 from GET_NOTIFIES, report "another controller is active" and retry with exponential backoff (5 s up to 5 min) instead of immediately reclaiming the session.
9. **Never log PINs.** Error objects carry URLs with `pin=***`.
