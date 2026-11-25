# CarGames Design Constraints

A checklist of physical, cognitive, and platform constraints for games played in a moving car where the **Driver** participates eyes-free and the **Passenger** operates the phone as MC.

Any candidate game for CarGames should be scored against these constraints before writing code.

---

## 1. Driver Safety & Cognitive Load
- **Zero visual requirement for the driver:** The driver never looks at the screen, never reads text, and never touches the phone.
- **Instant interruptibility:** Traffic merges, exits, sirens, and navigation prompts happen without warning. Any game must tolerate a 10-second or 10-minute pause with zero state loss and zero penalty.
- **No timers or countdowns:** Visible clocks create urgency and distraction. All pacing is human-controlled. (Invisible elapsed-time metadata for post-trip stats is fine.)
- **Alertness over stress:** The goal on long highway drives is steady verbal engagement that prevents zoning out—not high-pressure trivia or rapid reaction drills.

## 2. Passenger-as-MC Ergonomics (Moving Vehicle)
- **One-handed, bump-tolerant targets:** Play screens must fit in a single mobile viewport (`100dvh`, no scrolling) with 2–4 buttons max. Primary buttons should span **30%–100% of screen width** and **12%–35% of screen height** (`~100–300px` on a phone).
- **Minimal typing:** Prefer 1-tap state transitions and pre-dealt prompts. Typing should be optional (e.g., human clues or dispute verification), never mandatory on every turn.
- **Low-glare dark UI:** Default to a dark palette so the phone screen does not throw glare onto the windshield during night driving.
- **State-machine clarity:** Each screen represents one clear decision. Secondary settings (mode switching, player edits, history, resets) live in a separate `Menu` overlay.

## 3. Audio & Cabin Environment
- **Silent by default:** Never claim iOS/Android audio focus (no Web Audio, no TTS, no sound effects) so the car radio, music, or podcasts keep playing uninterrupted.
- **No speech recognition (ASR):** Road noise, HVAC fans, overlapping voices, and singing break automated speech-to-text. Keep humans as the judge; use the app for prompts, state, bookkeeping, and optional dispute lookup.
- **Visual "juice" instead of sound:** Use tactile button motion, canvas confetti, and brief edge-vignette flashes / shakes for feedback (respecting `prefers-reduced-motion`).

## 4. Connectivity & Persistence
- **Offline-first:** Long highway corridors have multi-mile cellular dead zones. Core decks, rules, and scoring must work with zero signal via Service Worker caching + bundled static data.
- **Graceful network degradation:** Any online lookup (e.g., lyric verification) must time out quickly and fall back to a local **Pending Queue** that resolves automatically when signal returns.
- **Crash/lock resilience:** Persist full trip state to `localStorage` on every action so locking the phone at a rest stop or switching to Maps never loses a round or score.

## 5. Player Count & Trip Context
- **2-player first (Driver + Passenger):** Games must work cleanly with exactly two adults on Day 1—mechanics that require 3+ players (e.g., *Contact*, social deduction) are out of scope for the core set.
- **Clean scaling to N players:** Data structures and scoreboards should scale to 3–6 players (family / road-trip carloads) without rewriting the shell.
- **Environment tags:** Explicitly tag games that fail at night or on empty rural interstates (e.g., license-plate or road-sign observation games) as **Daylight / Traffic Only**.

## 6. Platform & Scope Discipline
- **No CarPlay game UI:** Apple restricts CarPlay entitlements to approved categories (Navigation, Audio, Communication, etc.) and blocks games. The phone in the passenger's hand is the real UI surface.
- **Zero-build static PWA (until complexity earns a build step):** Keep deployment trivial (GitHub Pages + Service Worker) until shared multi-game infrastructure justifies TypeScript + a bundler.
