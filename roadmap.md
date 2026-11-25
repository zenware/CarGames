# CarGames Roadmap

Lightweight, offline-first car games built for a **Passenger-as-MC** and an alert, eyes-free **Driver**.

## Near-Term
- **TypeScript migration:** Move from plain JS to TypeScript (likely Vite + TS, deployed via GitHub Actions to GitHub Pages) once a second game is added and the shared shell (state machine, players, trip log, offline queue) grows.
- **Song autocomplete (Verify screen):**
  - *Online:* Debounced `fetch` (~350ms after 3+ chars) against `lrclib.net/api/search` matching title/artist only (never filtering by the target word so answers aren't spoiled).
  - *Offline:* Local prefix/trigram search once the offline song index exists.
- **Multi-game shell:** Add a big-button Home / Game Picker screen and 2–3 more zero-timer, driver-inclusive games sharing the same `Driver` / `Passenger` roster and trip scoreboard.

## Phase 2 — Offline Song Index & Data-Driven Difficulty
- **Compact offline index (~4–5 MB):** Build a one-time pipeline (workstation or curated seed list) for the top ~25k–30k popular songs:
  - Per-song 128-byte (1024-bit) Bloom filter of normalized lyric tokens (~3.8 MB raw / ~2.5 MB gzipped, ~1% false-positive rate).
  - Compact `(title, artist)` metadata (~1.2 MB gzipped).
  - Cached permanently in the PWA Service Worker for instant offline verification and autocomplete in highway dead zones.
- **Data-driven Easy / Med / Hard word decks:** Computed during the same offline build pass using:
  1. Popularity-weighted song frequency.
  2. Heavy bonus when the word appears in a song title.
  3. Repetition bonus (4+ occurrences in one song as a chorus/hook proxy).
- **"Show 3 Examples" on stump:** Pull real matching songs from the local index when everyone blanks on a Hard word.

## Longer-Term
- **Family / kid-friendly mode:** Simpler word decks and age-appropriate game variants as back-seat passengers grow.
- **Optional audio-only games:** Keep silent-by-default for all games so radio/podcasts stay uninterrupted, with explicit opt-in audio only if a future game needs it.
