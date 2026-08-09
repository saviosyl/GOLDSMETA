# Learn GoldMeta — premium narration files

Place pre-generated British Teacher audio here.

## Naming

Use the manifest names from `web/src/lib/learn/audioManifest.ts`:

```
01-what-is-trading-female.mp3
01-what-is-trading-male.mp3
02-what-is-a-stock-female.mp3
02-what-is-a-stock-male.mp3
…
21-complete-example-female.mp3
21-complete-example-male.mp3
```

`.m4a` is also supported (same basename).

## Behaviour

- If a file exists, Learn plays it with the HTML audio element.
- If missing, Learn falls back to **Google UK English Female** or **Google UK English Male** only.
- Do not commit silent/placeholder files.

Served at: `/learn-audio/<filename>`
