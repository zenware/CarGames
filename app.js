(() => {
  const STORAGE_KEY = 'cargames_song_state_v3';
  const LRCLIB_SEARCH = 'https://lrclib.net/api/search?q=';

  // State machine screens:
  // 'PICK_WORD' -> 'ENTER_WORD' -> 'PLAYING' <-> 'BLUFF_CHECK' <-> 'VERIFY'
  const defaultState = () => ({
    screen: 'PICK_WORD',
    returnScreen: 'PLAYING',
    players: [
      { id: 'p1', name: 'Driver', score: 0 },
      { id: 'p2', name: 'Passenger', score: 0 }
    ],
    mode: 'classic',        // 'classic' | 'rally'
    wordSource: 'human',    // 'human' | 'easy' | 'medium' | 'hard'
    clueGiverIdx: 0,
    currentWord: '',
    currentRallySongs: [],  // [{ playerName, song }]
    usedWords: [],
    usedSongs: [],
    history: [],            // [{ id, word, playerId, playerName, song, mode, bluff, status, timestamp }]
    pendingQueue: [],       // [{ id, historyId, query, word, playerId, playerName, timestamp }]
    allowRootMatch: true
  });

  let state = loadState();
  let verifyState = null;   // transient state for VERIFY screen
  let menuOpen = false;
  let toastTimer = null;

  const $ = (id) => document.getElementById(id);
  const scoreStripEl = $('scoreStrip');
  const netDotEl = $('netDot');
  const queuePillEl = $('queuePill');
  const screenEl = $('screen');
  const menuOverlayEl = $('menuOverlay');
  const menuContentEl = $('menuContent');
  const toastEl = $('toast');

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = { ...defaultState(), ...JSON.parse(raw) };
      if (!parsed.currentWord && (parsed.screen === 'PLAYING' || parsed.screen === 'BLUFF_CHECK' || parsed.screen === 'VERIFY')) {
        parsed.screen = 'PICK_WORD';
      }
      return parsed;
    } catch {
      return defaultState();
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore storage quota errors
    }
  }

  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 2400);
  }

  function norm(s) {
    return (s || '').toLowerCase().trim().replace(/\s+/g, ' ');
  }

  function songKey(title, artist) {
    return `${norm(title)}|${norm(artist)}`;
  }

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function buildWordRegex(word) {
    const clean = norm(word);
    if (!clean) return null;
    const escaped = escapeRegex(clean);
    if (state.allowRootMatch) {
      return new RegExp(`\\b${escaped}(?:s|es|ed|ing|'s)?\\b`, 'i');
    }
    return new RegExp(`\\b${escaped}\\b`, 'i');
  }

  function clueGiver() {
    return state.players[state.clueGiverIdx % state.players.length];
  }

  function otherPlayers() {
    const cg = clueGiver();
    return state.players.filter((p) => p.id !== cg.id);
  }

  function dealWord(difficulty) {
    const deck = (window.WORD_DECK && window.WORD_DECK[difficulty]) || [];
    const unused = deck.filter((w) => !state.usedWords.includes(norm(w)));
    const pool = unused.length > 0 ? unused : deck;
    if (!pool.length) return '';
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // State machine transitions
  function go(nextScreen) {
    state.screen = nextScreen;
    saveState();
    render();
  }

  function startRoundWithWord(word, source) {
    const cleaned = norm(word);
    if (!cleaned) return;
    state.currentWord = cleaned;
    state.wordSource = source;
    state.currentRallySongs = [];
    if (!state.usedWords.includes(cleaned)) {
      state.usedWords.push(cleaned);
    }
    verifyState = null;
    go('PLAYING');
  }

  function finishWordAdvance() {
    state.currentWord = '';
    state.currentRallySongs = [];
    verifyState = null;
    if (state.wordSource === 'human') {
      state.clueGiverIdx = (state.clueGiverIdx + 1) % state.players.length;
    }
    go('PICK_WORD');
  }

  function awardPoint(playerId, opts = {}) {
    const player = state.players.find((p) => p.id === playerId);
    if (!player) return;

    const word = state.currentWord || '(word)';
    const songLabel = opts.songLabel || '';
    const sKey = opts.songKey || '';

    player.score += 1;
    const entryId = `h_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    state.history.unshift({
      id: entryId,
      word,
      playerId: player.id,
      playerName: player.name,
      song: songLabel,
      songKey: sKey,
      mode: state.mode,
      bluff: Boolean(opts.bluff),
      status: opts.status || 'awarded',
      timestamp: Date.now()
    });

    if (sKey && !state.usedSongs.includes(sKey)) {
      state.usedSongs.push(sKey);
    }

    if (opts.queueQuery) {
      state.pendingQueue.push({
        id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        historyId: entryId,
        query: opts.queueQuery,
        word,
        playerId: player.id,
        playerName: player.name,
        timestamp: Date.now()
      });
    }

    if (state.mode === 'rally' && !opts.forceNextWord) {
      state.currentRallySongs.push({
        playerName: player.name,
        song: songLabel || 'Song proved'
      });
      verifyState = null;
      showToast(`+1 ${player.name} (Rally ${state.currentRallySongs.length})`);
      go('PLAYING');
    } else {
      showToast(`+1 ${player.name}`);
      finishWordAdvance();
    }
  }

  function undoLast() {
    const last = state.history.find((h) => h.status !== 'revoked');
    if (!last) {
      showToast('Nothing to undo');
      return;
    }
    const p = state.players.find((pl) => pl.id === last.playerId);
    if (p && p.score > 0) p.score -= 1;
    state.history = state.history.filter((h) => h.id !== last.id);
    state.pendingQueue = state.pendingQueue.filter((q) => q.historyId !== last.id);
    saveState();
    render();
    if (menuOpen) renderMenu();
    showToast(`Undid +1 for ${last.playerName}`);
  }

  function revokeItem(historyId) {
    const item = state.history.find((h) => h.id === historyId);
    if (!item || item.status === 'revoked') return;
    const p = state.players.find((pl) => pl.id === item.playerId);
    if (p && p.score > 0) p.score -= 1;
    item.status = 'revoked';
    saveState();
    render();
    if (menuOpen) renderMenu();
    showToast(`Revoked -1 from ${item.playerName}`);
  }

  // LRCLIB API
  async function queryLrclib(query) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6500);
    try {
      const resp = await fetch(LRCLIB_SEARCH + encodeURIComponent(query), {
        signal: controller.signal
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return await resp.json();
    } finally {
      clearTimeout(timer);
    }
  }

  function evaluateTrack(track, word) {
    const rx = buildWordRegex(word);
    const title = track.trackName || track.name || '';
    const artist = track.artistName || '';
    const lyrics = track.plainLyrics || '';

    const inLyrics = rx ? rx.test(lyrics) : false;
    const inTitle = rx ? rx.test(title) : false;

    let snippet = '';
    if (inLyrics && rx) {
      const lines = lyrics.split('\n');
      const idx = lines.findIndex((l) => rx.test(l));
      if (idx >= 0) {
        const slice = lines.slice(Math.max(0, idx - 1), Math.min(lines.length, idx + 2)).join('\n');
        snippet = esc(slice).replace(rx, (m) => `<mark>${m}</mark>`);
      }
    }

    let verdict = 'miss';
    if (inLyrics) verdict = 'match';
    else if (inTitle) verdict = 'title-only';

    const key = songKey(title, artist);
    return {
      title,
      artist,
      verdict,
      snippet,
      hasLyrics: Boolean(lyrics.trim()),
      key,
      isRepeat: state.usedSongs.includes(key)
    };
  }

  async function runVerify(query) {
    const q = query.trim();
    if (!q) return;

    verifyState = { loading: true, query: q };
    render();

    if (!navigator.onLine) {
      verifyState = {
        offline: true,
        query: q,
        error: 'Offline — queue this check for when signal returns.'
      };
      render();
      return;
    }

    try {
      const tracks = await queryLrclib(q);
      const candidates = (Array.isArray(tracks) ? tracks : [])
        .filter((t) => !t.instrumental)
        .slice(0, 8);

      if (!candidates.length) {
        verifyState = {
          notFound: true,
          query: q,
          error: 'No tracks found on LRCLIB for that search.'
        };
        render();
        return;
      }

      const evaluated = candidates.map((t) => evaluateTrack(t, state.currentWord));
      evaluated.sort((a, b) => {
        const rank = { match: 0, 'title-only': 1, miss: 2 };
        if (rank[a.verdict] !== rank[b.verdict]) return rank[a.verdict] - rank[b.verdict];
        return (b.hasLyrics ? 1 : 0) - (a.hasLyrics ? 1 : 0);
      });

      verifyState = {
        query: q,
        selectedIdx: 0,
        results: evaluated
      };
      render();
    } catch {
      verifyState = {
        offline: true,
        query: q,
        error: 'Could not reach LRCLIB (weak signal or timeout).'
      };
      render();
    }
  }

  async function processQueue() {
    if (!state.pendingQueue.length) return;
    if (!navigator.onLine) {
      showToast('Still offline');
      return;
    }
    let resolved = 0;
    const remaining = [];
    for (const item of state.pendingQueue) {
      try {
        const tracks = await queryLrclib(item.query);
        const candidates = (Array.isArray(tracks) ? tracks : []).filter((t) => !t.instrumental).slice(0, 6);
        const evaluated = candidates.map((t) => evaluateTrack(t, item.word));
        const best = evaluated.find((e) => e.verdict === 'match')
          || evaluated.find((e) => e.verdict === 'title-only')
          || evaluated[0];
        const hist = state.history.find((h) => h.id === item.historyId);
        if (hist) {
          if (best && best.verdict === 'match') {
            hist.status = 'verified';
            hist.song = `${best.title} — ${best.artist}`;
          } else if (best && best.verdict === 'title-only') {
            hist.status = 'title-only';
            hist.song = `${best.title} — ${best.artist}`;
          } else {
            hist.status = 'failed-check';
          }
        }
        resolved += 1;
      } catch {
        remaining.push(item);
      }
    }
    state.pendingQueue = remaining;
    saveState();
    render();
    if (menuOpen) renderMenu();
    if (resolved > 0) showToast(`Checked ${resolved} queued song${resolved > 1 ? 's' : ''}`);
  }

  // Rendering
  function renderTopBar() {
    const online = navigator.onLine;
    netDotEl.className = `net-dot ${online ? 'online' : 'offline'}`;
    netDotEl.setAttribute('aria-label', online ? 'Online' : 'Offline');

    const qLen = state.pendingQueue.length;
    queuePillEl.textContent = String(qLen);
    queuePillEl.classList.toggle('hidden', qLen === 0);

    scoreStripEl.innerHTML = state.players
      .map((p) => `<span class="score-chip">${esc(p.name)} <span class="num">${p.score}</span></span>`)
      .join('');
  }

  function renderPickWord() {
    const cg = clueGiver();
    screenEl.innerHTML = `
      <div class="hero">
        <div class="hero-eyebrow">${state.mode === 'rally' ? 'RALLY MODE' : 'CLASSIC MODE'}</div>
        <div class="hero-word" style="font-size:clamp(30px, 9vw, 44px);">New Word</div>
        <div class="hero-sub">${esc(cg.name)}'s turn to clue, or deal one</div>
      </div>

      <div class="btn-stack">
        <button class="big-btn primary" data-action="go-enter" type="button">
          <span>Type a Word</span>
          <span class="sub">${esc(cg.name)} picks the clue</span>
        </button>

        <div class="btn-row three">
          <button class="big-btn green" data-deal="easy" type="button">
            <span>Easy</span>
            <span class="sub">Deal</span>
          </button>
          <button class="big-btn accent-outline" data-deal="medium" type="button">
            <span>Med</span>
            <span class="sub">Deal</span>
          </button>
          <button class="big-btn amber" data-deal="hard" type="button">
            <span>Hard</span>
            <span class="sub">Deal</span>
          </button>
        </div>
      </div>
    `;
  }

  function renderEnterWord() {
    const cg = clueGiver();
    screenEl.innerHTML = `
      <div class="hero">
        <div class="hero-eyebrow">${esc(cg.name)}'s Clue Word</div>
        <form id="enterWordForm" style="width:100%;display:flex;flex-direction:column;gap:12px;">
          <input
            id="enterWordInput"
            class="big-input"
            type="text"
            autocomplete="off"
            autocapitalize="none"
            spellcheck="false"
            placeholder="e.g. moonlight"
          />
        </form>
      </div>

      <div class="btn-stack">
        <button class="big-btn primary" data-action="submit-word" type="button">
          <span>Start Round</span>
        </button>
        <button class="big-btn short" data-action="back-pick" type="button">
          <span>Back</span>
        </button>
      </div>
    `;

    const input = $('enterWordInput');
    if (input) {
      setTimeout(() => input.focus(), 40);
      $('enterWordForm').addEventListener('submit', (e) => {
        e.preventDefault();
        if (input.value.trim()) startRoundWithWord(input.value, 'human');
      });
    }
  }

  function renderPlaying() {
    const cg = clueGiver();
    const isHuman = state.wordSource === 'human';
    const eyebrow = isHuman
      ? `Clue by ${cg.name} · ${state.mode === 'rally' ? 'Rally' : 'Others prove'}`
      : `App Deal · ${state.wordSource.toUpperCase()} · ${state.mode === 'rally' ? 'Rally' : 'Race'}`;

    const rallyHtml = state.mode === 'rally' && state.currentRallySongs.length > 0
      ? `<div class="rally-pills">${state.currentRallySongs
          .map((r) => `<span class="rally-pill">${esc(r.playerName)}: ${esc(r.song)}</span>`)
          .join('')}</div>`
      : '';

    const playerBtns = state.players
      .map((p) => `
        <button class="big-btn tall" data-award="${esc(p.id)}" type="button">
          <span>${esc(p.name)}</span>
          <span class="score-big">${p.score}</span>
          <span class="sub">+1 Point</span>
        </button>
      `)
      .join('');

    const rightAction = isHuman && state.mode === 'classic'
      ? `<button class="big-btn short amber" data-action="go-bluff" type="button">
           <span>Prove It!</span>
           <span class="sub">Bluff check</span>
         </button>`
      : `<button class="big-btn short" data-action="next-word" type="button">
           <span>Next Word</span>
           <span class="sub">Skip / finish</span>
         </button>`;

    screenEl.innerHTML = `
      <div class="hero">
        <div class="hero-eyebrow">${esc(eyebrow)}</div>
        <div class="hero-word">${esc(state.currentWord)}</div>
        ${rallyHtml}
      </div>

      <div class="btn-stack">
        <div class="btn-row">${playerBtns}</div>
        <div class="btn-row">
          <button class="big-btn short accent-outline" data-action="go-verify" type="button">
            <span>Verify Song</span>
            <span class="sub">Check lyrics</span>
          </button>
          ${rightAction}
        </div>
      </div>
    `;
  }

  function renderBluffCheck() {
    const cg = clueGiver();
    const others = otherPlayers();
    const singleChallenger = others.length === 1 ? others[0] : null;

    const failBtn = singleChallenger
      ? `<button class="big-btn red" data-bluff-fail="${esc(singleChallenger.id)}" type="button">
           <span>Bluff! +1 ${esc(singleChallenger.name)}</span>
           <span class="sub">${esc(cg.name)} couldn't prove it</span>
         </button>`
      : `<button class="big-btn red" data-action="next-word" type="button">
           <span>Bluff! No Point</span>
           <span class="sub">Move to next word</span>
         </button>`;

    screenEl.innerHTML = `
      <div class="hero bluff">
        <div class="hero-eyebrow">Bluff Check</div>
        <div class="hero-word">${esc(state.currentWord)}</div>
        <div class="hero-sub">${esc(cg.name)} must prove a song!</div>
      </div>

      <div class="btn-stack">
        <button class="big-btn green" data-bluff-pass="${esc(cg.id)}" type="button">
          <span>${esc(cg.name)} Proved It</span>
          <span class="sub">+1 ${esc(cg.name)}</span>
        </button>
        ${failBtn}
        <div class="btn-row">
          <button class="big-btn short accent-outline" data-action="go-verify" type="button">
            <span>Verify Song</span>
          </button>
          <button class="big-btn short" data-action="back-playing" type="button">
            <span>Back</span>
          </button>
        </div>
      </div>
    `;
  }

  function renderVerify() {
    let resultHtml = '';

    if (verifyState && verifyState.loading) {
      resultHtml = `
        <div class="verify-card">
          <div class="track-title">Checking LRCLIB...</div>
          <div class="track-artist">Searching "${esc(verifyState.query)}" for "${esc(state.currentWord)}"</div>
        </div>
      `;
    } else if (verifyState && (verifyState.offline || verifyState.notFound)) {
      const awardBtns = state.players
        .map((p) => `
          <button class="big-btn short" data-queue-award="${esc(p.id)}" type="button">
            <span>${verifyState.offline ? 'Queue' : 'Trust'} +1 ${esc(p.name)}</span>
          </button>
        `)
        .join('');
      resultHtml = `
        <div class="verify-card">
          <span class="verdict-pill offline">${verifyState.offline ? 'Offline / Timeout' : 'Not Found'}</span>
          <div class="track-title">"${esc(verifyState.query)}"</div>
          <div class="track-artist">${esc(verifyState.error)}</div>
        </div>
        <div class="btn-row">${awardBtns}</div>
      `;
    } else if (verifyState && verifyState.results) {
      const r = verifyState.results[verifyState.selectedIdx];
      const badgeText = r.verdict === 'match'
        ? 'In Lyrics'
        : r.verdict === 'title-only'
          ? 'Title Only'
          : r.hasLyrics ? 'Not in Lyrics' : 'No Lyrics in DB';

      const awardBtns = state.players
        .map((p) => `
          <button class="big-btn short ${r.verdict === 'match' ? 'primary' : ''}" data-verify-award="${esc(p.id)}" type="button">
            <span>+1 ${esc(p.name)}</span>
          </button>
        `)
        .join('');

      const alts = verifyState.results.length > 1
        ? verifyState.results
            .slice(0, 3)
            .map((alt, idx) => idx === verifyState.selectedIdx ? '' : `
              <button class="alt-btn" data-alt-idx="${idx}" type="button">
                Switch: ${esc(alt.title)} — ${esc(alt.artist)} (${alt.verdict === 'match' ? 'Match' : alt.verdict === 'title-only' ? 'Title only' : 'Miss'})
              </button>
            `)
            .join('')
        : '';

      resultHtml = `
        <div class="verify-card ${r.verdict}">
          <span class="verdict-pill ${r.verdict}">${badgeText}</span>
          <div class="track-title">${esc(r.title)}</div>
          <div class="track-artist">${esc(r.artist)}</div>
          ${r.isRepeat ? `<div class="repeat-banner">Already used earlier this trip!</div>` : ''}
          ${r.snippet ? `<div class="lyric-box">${r.snippet}</div>` : ''}
          ${alts}
        </div>
        <div class="btn-row">${awardBtns}</div>
      `;
    }

    screenEl.innerHTML = `
      <div class="btn-stack" style="flex:1;">
        <div class="hero-eyebrow" style="text-align:center;">Verify for "${esc(state.currentWord)}"</div>
        <form id="verifySongForm" style="display:flex;flex-direction:column;gap:10px;">
          <input
            id="verifySongInput"
            class="big-input left"
            type="text"
            autocomplete="off"
            placeholder="Song title (optional artist)..."
            value="${esc(verifyState ? verifyState.query : '')}"
          />
          <button class="big-btn short primary" type="submit">
            <span>Check Lyrics</span>
          </button>
        </form>
        ${resultHtml}
      </div>

      <button class="big-btn short" data-action="back-from-verify" type="button">
        <span>Back</span>
      </button>
    `;

    const form = $('verifySongForm');
    const inp = $('verifySongInput');
    if (form && inp) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        runVerify(inp.value);
      });
      if (!verifyState) {
        setTimeout(() => inp.focus(), 40);
      }
    }
  }

  function renderMenu() {
    const queueHtml = state.pendingQueue.length
      ? `
        <div>
          <div class="section-label">Pending Offline Checks (${state.pendingQueue.length})</div>
          <div class="btn-stack">
            <button class="big-btn short primary" data-menu="process-queue" type="button">
              <span>Check Queue Now</span>
            </button>
            ${state.pendingQueue.map((q) => `
              <div class="list-card">
                <div class="list-top">
                  <span>"${esc(q.query)}" for "${esc(q.word)}"</span>
                  <span class="verdict-pill offline">Queued</span>
                </div>
                <div class="list-sub">Awarded to ${esc(q.playerName)}</div>
              </div>
            `).join('')}
          </div>
        </div>
      `
      : '';

    const historyHtml = state.history.length
      ? state.history.slice(0, 20).map((h) => {
          const badge = h.status === 'verified' ? '<span class="verdict-pill match">Verified</span>'
            : h.status === 'queued' ? '<span class="verdict-pill offline">Queued</span>'
            : h.status === 'title-only' ? '<span class="verdict-pill title-only">Title Only</span>'
            : h.status === 'failed-check' ? '<span class="verdict-pill miss">Not in Lyrics</span>'
            : h.status === 'revoked' ? '<span class="verdict-pill miss">Revoked</span>'
            : '';
          return `
            <div class="list-card">
              <div class="list-top">
                <span>${esc(h.playerName)} · "${esc(h.word)}"</span>
                ${badge}
              </div>
              ${h.song ? `<div class="list-sub">${esc(h.song)}</div>` : ''}
              <div class="list-top" style="margin-top:4px;">
                <span class="list-sub">${h.mode}${h.bluff ? ' · bluff' : ''}</span>
                ${h.status !== 'revoked' ? `<button class="menu-btn" style="min-height:36px;padding:6px 12px;font-size:13px;" data-revoke="${esc(h.id)}" type="button">Revoke -1</button>` : ''}
              </div>
            </div>
          `;
        }).join('')
      : `<div class="list-sub">No rounds logged yet this trip.</div>`;

    menuContentEl.innerHTML = `
      <div class="overlay-head">
        <h2>Menu &amp; Trip Log</h2>
        <button class="menu-btn" data-menu="close" type="button">Done</button>
      </div>

      <div>
        <div class="section-label">Game Mode</div>
        <div class="btn-row">
          <button class="big-btn short ${state.mode === 'classic' ? 'primary' : ''}" data-set-mode="classic" type="button">
            <span>Classic</span>
            <span class="sub">1 word = 1 pt</span>
          </button>
          <button class="big-btn short ${state.mode === 'rally' ? 'primary' : ''}" data-set-mode="rally" type="button">
            <span>Rally</span>
            <span class="sub">Volley songs</span>
          </button>
        </div>
      </div>

      <div class="btn-row">
        <button class="big-btn short" data-menu="undo" type="button" ${state.history.some((h) => h.status !== 'revoked') ? '' : 'disabled'}>
          <span>Undo Last</span>
        </button>
        <button class="big-btn short red" data-menu="reset" type="button">
          <span>New Trip</span>
        </button>
      </div>

      ${queueHtml}

      <div>
        <div class="section-label">Players</div>
        <div class="btn-stack" style="gap:8px;">
          ${state.players.map((p, i) => `
            <div class="player-edit-row">
              <input type="text" data-edit-player="${esc(p.id)}" value="${esc(p.name)}" placeholder="Player ${i + 1}" />
              ${state.players.length > 2 ? `<button class="menu-btn" data-remove-player="${esc(p.id)}" type="button">×</button>` : ''}
            </div>
          `).join('')}
          ${state.players.length < 6 ? `<button class="big-btn short" data-menu="add-player" type="button"><span>+ Add Player</span></button>` : ''}
        </div>
      </div>

      <label class="toggle-card">
        <span>Allow plural/root match (blue → blues)</span>
        <input id="menuRootToggle" type="checkbox" ${state.allowRootMatch ? 'checked' : ''} />
      </label>

      <div>
        <div class="section-label">Trip History (${state.history.length})</div>
        <div class="btn-stack" style="gap:8px;">${historyHtml}</div>
      </div>
    `;
  }

  function render() {
    renderTopBar();
    if (state.screen === 'PICK_WORD') renderPickWord();
    else if (state.screen === 'ENTER_WORD') renderEnterWord();
    else if (state.screen === 'PLAYING') renderPlaying();
    else if (state.screen === 'BLUFF_CHECK') renderBluffCheck();
    else if (state.screen === 'VERIFY') renderVerify();
    else renderPickWord();
  }

  // Delegated click handlers on main screen
  screenEl.addEventListener('click', (e) => {
    const dealBtn = e.target.closest('[data-deal]');
    if (dealBtn) {
      const diff = dealBtn.dataset.deal;
      const w = dealWord(diff);
      startRoundWithWord(w, diff);
      return;
    }

    const awardBtn = e.target.closest('[data-award]');
    if (awardBtn) {
      awardPoint(awardBtn.dataset.award);
      return;
    }

    const bluffPass = e.target.closest('[data-bluff-pass]');
    if (bluffPass) {
      awardPoint(bluffPass.dataset.bluffPass, { bluff: true, forceNextWord: true });
      return;
    }

    const bluffFail = e.target.closest('[data-bluff-fail]');
    if (bluffFail) {
      awardPoint(bluffFail.dataset.bluffFail, { bluff: true, forceNextWord: true });
      return;
    }

    const altBtn = e.target.closest('[data-alt-idx]');
    if (altBtn && verifyState && verifyState.results) {
      verifyState.selectedIdx = Number(altBtn.dataset.altIdx);
      render();
      return;
    }

    const verifyAward = e.target.closest('[data-verify-award]');
    if (verifyAward && verifyState && verifyState.results) {
      const r = verifyState.results[verifyState.selectedIdx];
      awardPoint(verifyAward.dataset.verifyAward, {
        songLabel: `${r.title} — ${r.artist}`,
        songKey: r.key,
        bluff: state.returnScreen === 'BLUFF_CHECK',
        status: r.verdict === 'match' ? 'verified' : r.verdict === 'title-only' ? 'title-only' : 'awarded'
      });
      return;
    }

    const queueAward = e.target.closest('[data-queue-award]');
    if (queueAward && verifyState) {
      awardPoint(queueAward.dataset.queueAward, {
        songLabel: verifyState.query,
        songKey: songKey(verifyState.query, ''),
        bluff: state.returnScreen === 'BLUFF_CHECK',
        status: verifyState.offline ? 'queued' : 'awarded',
        queueQuery: verifyState.offline ? verifyState.query : null
      });
      return;
    }

    const actionBtn = e.target.closest('[data-action]');
    if (!actionBtn) return;
    const act = actionBtn.dataset.action;

    if (act === 'go-enter') go('ENTER_WORD');
    else if (act === 'back-pick') go('PICK_WORD');
    else if (act === 'submit-word') {
      const inp = $('enterWordInput');
      if (inp && inp.value.trim()) startRoundWithWord(inp.value, 'human');
      else showToast('Type a word first');
    } else if (act === 'go-bluff') go('BLUFF_CHECK');
    else if (act === 'back-playing') go('PLAYING');
    else if (act === 'next-word') finishWordAdvance();
    else if (act === 'go-verify') {
      state.returnScreen = state.screen;
      verifyState = null;
      go('VERIFY');
    } else if (act === 'back-from-verify') {
      verifyState = null;
      go(state.returnScreen || 'PLAYING');
    }
  });

  // Menu open/close & handlers
  $('btnMenu').addEventListener('click', () => {
    menuOpen = true;
    renderMenu();
    menuOverlayEl.classList.remove('hidden');
  });

  menuContentEl.addEventListener('click', (e) => {
    const modeBtn = e.target.closest('[data-set-mode]');
    if (modeBtn) {
      state.mode = modeBtn.dataset.setMode;
      saveState();
      renderMenu();
      render();
      return;
    }

    const remBtn = e.target.closest('[data-remove-player]');
    if (remBtn && state.players.length > 2) {
      state.players = state.players.filter((p) => p.id !== remBtn.dataset.removePlayer);
      saveState();
      renderMenu();
      render();
      return;
    }

    const revBtn = e.target.closest('[data-revoke]');
    if (revBtn) {
      revokeItem(revBtn.dataset.revoke);
      return;
    }

    const menuBtn = e.target.closest('[data-menu]');
    if (!menuBtn) return;
    const cmd = menuBtn.dataset.menu;
    if (cmd === 'close') {
      menuOpen = false;
      menuOverlayEl.classList.add('hidden');
      render();
    } else if (cmd === 'undo') {
      undoLast();
    } else if (cmd === 'process-queue') {
      processQueue();
    } else if (cmd === 'add-player') {
      state.players.push({ id: `p_${Date.now()}`, name: `Player ${state.players.length + 1}`, score: 0 });
      saveState();
      renderMenu();
      render();
    } else if (cmd === 'reset') {
      const names = state.players.map((p) => ({ id: p.id, name: p.name, score: 0 }));
      state = { ...defaultState(), players: names, allowRootMatch: state.allowRootMatch };
      verifyState = null;
      saveState();
      menuOpen = false;
      menuOverlayEl.classList.add('hidden');
      render();
      showToast('New trip started');
    }
  });

  menuContentEl.addEventListener('input', (e) => {
    const inp = e.target.closest('[data-edit-player]');
    if (inp) {
      const p = state.players.find((pl) => pl.id === inp.dataset.editPlayer);
      if (p) {
        p.name = inp.value.trim() || 'Player';
        saveState();
        renderTopBar();
      }
    }
  });

  menuContentEl.addEventListener('change', (e) => {
    if (e.target && e.target.id === 'menuRootToggle') {
      state.allowRootMatch = e.target.checked;
      saveState();
    }
  });

  window.addEventListener('online', () => {
    renderTopBar();
    if (state.pendingQueue.length) {
      showToast('Back online — checking queue...');
      processQueue();
    }
  });

  window.addEventListener('offline', () => {
    renderTopBar();
    showToast('Offline — game continues locally');
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }

  render();
})();
