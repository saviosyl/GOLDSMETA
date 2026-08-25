# Learn GoldMeta — premium narration files

Pre-generated British Teacher audio for all 21 lessons.

## Production voices (user-facing labels only)

- **Female — British Teacher** → Kokoro `bf_emma` (internal; never shown in UI)
- **Male — British Teacher** → Kokoro `bm_george` (internal; never shown in UI)

Settings: Kokoro-82M, `lang_code='b'`, `speed=0.92`.

## Naming

```
01-what-is-trading-female.mp3
01-what-is-trading-male.mp3
…
21-complete-example-female.mp3
21-complete-example-male.mp3
```

Manifest: `web/src/lib/learn/audioManifest.ts`

## Behaviour

- Premium MP3 plays first via HTML audio element.
- If missing, fallback is **Google UK English Female/Male only**.
- Review-only extras may live under `review/` (not used by the player).

Served at: `/learn-audio/<filename>`
