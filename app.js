(() => {
  const STORAGE_KEY = 'cargames_suite_state_v1';
  const LRCLIB_SEARCH = 'https://lrclib.net/api/search?q=';
  const STARTING_LETTERS = 'ABCDEFGHIJKLMNOPRSTW';

  // Games: 'home' | 'song' | 'reveal' | 'categories'
  // Song screens:       'PICK_WORD' | 'ENTER_WORD' | 'PLAYING' | 'BLUFF_CHECK' | 'VERIFY' | 'RAPID'
  // Reveal screens:     'REVEAL_PICK' | 'REVEAL_PLAY' | 'REVEAL_GUESS' | 'REVEAL_SOLVE' | 'REVEAL_AWARD'
  // Categories screens: 'CAT_PLAY'
  const defaultState = () => ({
    game: 'home',
    screen: 'HOME',
    returnScreen: 'PLAYING',
    players: [
      { id: 'p1', name: 'Driver', score: 0 },
      { id: 'p2', name: 'Passenger', score: 0 }
    ],

    // Song Game state
    songMode: 'classic',       // 'classic' | 'rapid'
    wordSource: 'human',       // 'human' | 'easy' | 'medium' | 'hard'
    clueGiverIdx: 0,
    currentWord: '',
    wordStartedAt: null,
    usedWords: [],
    usedSongs: [],
    pendingQueue: [],
    allowRootMatch: true,

    // Prefix Reveal state (left-to-right blind word reveal)
    revealWord: '',            // secret word (never shown until solved/revealed)
    revealHint: '',
    revealDiff: 'easy',
    revealIndex: 0,            // how many leading letters are revealed
    revealTried: [],           // wrong letters tried at current index
    revealMisses: 0,
    revealStartedAt: null,
    revealUsed: [],

    // Categories state
    catMode: 'points',         // 'points' (everyone else +1) | 'elimination' (last one standing)
    catUseLetter: false,
    catCurrent: '',
    catLetter: '',
    catEliminated: [],         // playerIds eliminated in current round
    catUsed: [],

    // Shared Trip History
    history: []
  });

  let state = loadState();
  let verifyState = null;
  let menuOpen = false;
  let toastTimer = null;

  const $ = (id) => document.getElementById(id);
  const btnHomeEl = $('btnHome');
  const scoreStripEl = $('scoreStrip');
  const offlinePillEl = $('offlinePill');
  const queuePillEl = $('queuePill');
  const screenEl = $('screen');
  const menuOverlayEl = $('menuOverlay');
  const menuContentEl = $('menuContent');
  const toastEl = $('toast');
  const fxFlashEl = $('fxFlash');
  const fxCanvasEl = $('fxCanvas');

  const prefersReducedMotion = () =>
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Lightweight zero-dep confetti burst on <canvas>
  let confettiParticles = [];
  let confettiRaf = null;

  function burstConfetti(originX, originY, palette) {
    if (prefersReducedMotion() || !fxCanvasEl) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    fxCanvasEl.width = w * dpr;
    fxCanvasEl.height = h * dpr;
    const ctx = fxCanvasEl.getContext('2d');
    if (!ctx) return;

    const colors = palette || ['#38bdf8', '#3fb950', '#f0b429', '#a78bfa', '#f472b6'];
    const cx = typeof originX === 'number' ? originX : w / 2;
    const cy = typeof originY === 'number' ? originY : h * 0.55;

    for (let i = 0; i < 42; i += 1) {
      const angle = (Math.random() * Math.PI * 1.4) - Math.PI * 1.2;
      const speed = 4 + Math.random() * 9;
      confettiParticles.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed + (Math.random() - 0.5) * 3,
        vy: Math.sin(angle) * speed - 2,
        size: 5 + Math.random() * 5,
        rot: Math.random() * Math.PI * 2,
        vrot: (Math.random() - 0.5) * 0.25,
        color: colors[i % colors.length],
        life: 1
      });
    }

    if (!confettiRaf) {
      const tick = () => {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        confettiParticles = confettiParticles.filter((p) => p.life > 0.02);
        for (const p of confettiParticles) {
          p.vy += 0.32;
          p.vx *= 0.985;
          p.x += p.vx;
          p.y += p.vy;
          p.rot += p.vrot;
          p.life -= 0.022;
          ctx.save();
          ctx.globalAlpha = Math.max(0, p.life);
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.65);
          ctx.restore();
        }
        if (confettiParticles.length > 0) {
          confettiRaf = requestAnimationFrame(tick);
        } else {
          ctx.clearRect(0, 0, w, h);
          confettiRaf = null;
        }
      };
      confettiRaf = requestAnimationFrame(tick);
    }
  }

  function triggerVisualFx(kind) {
    if (prefersReducedMotion()) return;
    if (fxFlashEl) {
      fxFlashEl.className = 'fx-flash';
      void fxFlashEl.offsetWidth;
      fxFlashEl.classList.add(kind);
    }
    if (screenEl) {
      screenEl.classList.remove('shake');
      void screenEl.offsetWidth;
      screenEl.classList.add('shake');
    }
  }

  function popScoreChip(playerId) {
    if (prefersReducedMotion()) return;
    const chip = scoreStripEl.querySelector(`[data-chip-player="${playerId}"]`);
    if (!chip) return;
    chip.classList.remove('pop');
    void chip.offsetWidth;
    chip.classList.add('pop');
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      return { ...defaultState(), ...JSON.parse(raw) };
    } catch {
      return defaultState();
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore quota errors
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

  function formatElapsed(ms) {
    if (typeof ms !== 'number' || !Number.isFinite(ms)) return '';
    const sec = ms / 1000;
    if (sec < 60) return `${sec.toFixed(1)}s`;
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${m}m ${s}s`;
  }

  function btnCenter(el) {
    const r = el.getBoundingClientRect();
    return { originX: r.left + r.width / 2, originY: r.top + r.height / 2 };
  }

  function clueGiver() {
    return state.players[state.clueGiverIdx % state.players.length];
  }

  function otherPlayers() {
    const cg = clueGiver();
    return state.players.filter((p) => p.id !== cg.id);
  }

  // Navigation
  function go(nextScreen, animate = true) {
    state.screen = nextScreen;
    saveState();
    render(animate);
  }

  function enterGame(gameId) {
    state.game = gameId;
    if (gameId === 'home') {
      go('HOME');
    } else if (gameId === 'song') {
      if (state.songMode === 'rapid') go('RAPID');
      else go(state.currentWord ? 'PLAYING' : 'PICK_WORD');
    } else if (gameId === 'reveal') {
      go(state.revealWord ? 'REVEAL_PLAY' : 'REVEAL_PICK');
    } else if (gameId === 'categories') {
      if (!state.catCurrent) dealCategory(false);
      go('CAT_PLAY');
    }
  }

  // Shared scoring & undo
  function recordHistoryEntry(entry) {
    state.history.unshift(entry);
  }

  function undoLast() {
    const last = state.history.find((h) => h.status !== 'revoked');
    if (!last) {
      showToast('Nothing to undo');
      return;
    }
    const ids = Array.isArray(last.playerIds) ? last.playerIds : (last.playerId ? [last.playerId] : []);
    for (const pid of ids) {
      const p = state.players.find((pl) => pl.id === pid);
      if (p && p.score > 0) p.score -= 1;
    }
    state.history = state.history.filter((h) => h.id !== last.id);
    state.pendingQueue = state.pendingQueue.filter((q) => q.historyId !== last.id);
    saveState();
    render(false);
    if (menuOpen) renderMenu();
    showToast(`Undid ${last.playerName || 'last point'}`);
  }

  function revokeItem(historyId) {
    const item = state.history.find((h) => h.id === historyId);
    if (!item || item.status === 'revoked') return;
    const ids = Array.isArray(item.playerIds) ? item.playerIds : (item.playerId ? [item.playerId] : []);
    for (const pid of ids) {
      const p = state.players.find((pl) => pl.id === pid);
      if (p && p.score > 0) p.score -= 1;
    }
    item.status = 'revoked';
    saveState();
    render(false);
    if (menuOpen) renderMenu();
    showToast('Revoked point(s)');
  }

  // =========================================================================
  // GAME 1: THE SONG GAME
  // =========================================================================
  function dealSongWord(difficulty) {
    const deck = (window.WORD_DECK && window.WORD_DECK[difficulty]) || [];
    const unused = deck.filter((w) => !state.usedWords.includes(norm(w)));
    const pool = unused.length > 0 ? unused : deck;
    if (!pool.length) return '';
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function startSongRound(word, source) {
    const cleaned = norm(word);
    if (!cleaned) return;
    state.currentWord = cleaned;
    state.wordSource = source;
    state.wordStartedAt = Date.now();
    if (!state.usedWords.includes(cleaned)) state.usedWords.push(cleaned);
    verifyState = null;
    go('PLAYING');
  }

  function finishSongWord(fxKind = null) {
    state.currentWord = '';
    state.wordStartedAt = null;
    verifyState = null;
    if (state.wordSource === 'human') {
      state.clueGiverIdx = (state.clueGiverIdx + 1) % state.players.length;
    }
    go('PICK_WORD');
    if (fxKind) triggerVisualFx(fxKind);
  }

  function awardSongPoint(playerId, opts = {}) {
    const player = state.players.find((p) => p.id === playerId);
    if (!player) return;

    const now = Date.now();
    const isRapid = state.songMode === 'rapid';
    const word = isRapid ? '' : (state.currentWord || '(word)');
    const songLabel = opts.songLabel || '';
    const sKey = opts.songKey || '';
    const elapsedMs = (!isRapid && state.wordStartedAt) ? Math.max(0, now - state.wordStartedAt) : null;

    player.score += 1;
    const entryId = `h_${now}_${Math.random().toString(36).slice(2, 6)}`;
    recordHistoryEntry({
      id: entryId,
      game: '🎵 Song',
      word,
      wordSource: isRapid ? 'rapid' : state.wordSource,
      wordStartedAt: isRapid ? null : state.wordStartedAt,
      elapsedMs,
      playerId: player.id,
      playerIds: [player.id],
      playerName: player.name,
      song: songLabel,
      songKey: sKey,
      mode: state.songMode,
      bluff: Boolean(opts.bluff),
      status: opts.status || 'awarded',
      timestamp: now
    });

    if (sKey && !state.usedSongs.includes(sKey)) state.usedSongs.push(sKey);

    if (opts.queueQuery) {
      state.pendingQueue.push({
        id: `q_${now}_${Math.random().toString(36).slice(2, 6)}`,
        historyId: entryId,
        query: opts.queueQuery,
        word,
        playerId: player.id,
        playerName: player.name,
        timestamp: now
      });
    }

    burstConfetti(opts.originX, opts.originY, opts.palette);

    if (isRapid) {
      saveState();
      render(false);
      popScoreChip(player.id);
      showToast(`+1 ${player.name}`);
    } else {
      showToast(`+1 ${player.name}`);
      finishSongWord(opts.fxKind || null);
      popScoreChip(player.id);
    }
  }

  // LRCLIB API
  async function queryLrclib(query) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6500);
    try {
      const resp = await fetch(LRCLIB_SEARCH + encodeURIComponent(query), { signal: controller.signal });
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
      title, artist, verdict, snippet,
      hasLyrics: Boolean(lyrics.trim()),
      key,
      isRepeat: state.usedSongs.includes(key)
    };
  }

  async function runVerify(query) {
    const q = query.trim();
    if (!q) return;
    verifyState = { loading: true, query: q };
    render(false);

    if (!navigator.onLine) {
      verifyState = { offline: true, query: q, error: 'Offline — queue this check for when signal returns.' };
      render(false);
      return;
    }

    try {
      const tracks = await queryLrclib(q);
      const candidates = (Array.isArray(tracks) ? tracks : []).filter((t) => !t.instrumental).slice(0, 8);
      if (!candidates.length) {
        verifyState = { notFound: true, query: q, error: 'No tracks found on LRCLIB for that search.' };
        render(false);
        return;
      }
      const evaluated = candidates.map((t) => evaluateTrack(t, state.currentWord));
      evaluated.sort((a, b) => {
        const rank = { match: 0, 'title-only': 1, miss: 2 };
        if (rank[a.verdict] !== rank[b.verdict]) return rank[a.verdict] - rank[b.verdict];
        return (b.hasLyrics ? 1 : 0) - (a.hasLyrics ? 1 : 0);
      });
      verifyState = { query: q, selectedIdx: 0, results: evaluated };
      render(false);
    } catch {
      verifyState = { offline: true, query: q, error: 'Could not reach LRCLIB (weak signal or timeout).' };
      render(false);
    }
  }

  async function processQueue() {
    if (!state.pendingQueue.length) return;
    if (!navigator.onLine) { showToast('Still offline'); return; }
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
    render(false);
    if (menuOpen) renderMenu();
    if (resolved > 0) showToast(`Checked ${resolved} queued song${resolved > 1 ? 's' : ''}`);
  }

  // =========================================================================
  // GAME 2: PREFIX REVEAL (Left-to-Right Blind Word Reveal)
  // =========================================================================
  function dealRevealWord(difficulty) {
    const deck = (window.REVEAL_DECK && window.REVEAL_DECK[difficulty]) || [];
    const unused = deck.filter((item) => !state.revealUsed.includes(item.word));
    const pool = unused.length > 0 ? unused : deck;
    if (!pool.length) return;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    state.revealWord = pick.word.toLowerCase();
    state.revealHint = pick.hint;
    state.revealDiff = difficulty;
    state.revealIndex = 0;
    state.revealTried = [];
    state.revealMisses = 0;
    state.revealStartedAt = Date.now();
    if (!state.revealUsed.includes(state.revealWord)) state.revealUsed.push(state.revealWord);
    go('REVEAL_PLAY');
  }

  function checkRevealLetter(raw) {
    const ch = (raw || '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 1);
    if (!ch) {
      triggerVisualFx('skip');
      showToast('Enter a single letter (A–Z)');
      return;
    }
    const target = state.revealWord[state.revealIndex];
    if (ch === target) {
      state.revealIndex += 1;
      state.revealTried = [];
      if (state.revealIndex >= state.revealWord.length) {
        burstConfetti();
        go('REVEAL_AWARD');
        showToast(`Word complete: ${state.revealWord.toUpperCase()}!`);
      } else {
        showToast(`Yes! "${ch.toUpperCase()}" locked in`);
        go('REVEAL_PLAY');
      }
    } else {
      state.revealMisses += 1;
      if (!state.revealTried.includes(ch)) state.revealTried.push(ch);
      saveState();
      triggerVisualFx('buzzer');
      showToast(`Not "${ch.toUpperCase()}"`);
      go('REVEAL_PLAY');
    }
  }

  function revealNextLetterHint() {
    if (!state.revealWord) return;
    state.revealIndex += 1;
    state.revealTried = [];
    if (state.revealIndex >= state.revealWord.length) {
      const revealed = state.revealWord.toUpperCase();
      state.revealWord = '';
      state.revealIndex = 0;
      state.revealTried = [];
      go('REVEAL_PICK');
      triggerVisualFx('skip');
      showToast(`Word was: ${revealed}`);
    } else {
      showToast(`Hint: "${state.revealWord[state.revealIndex - 1].toUpperCase()}"`);
      go('REVEAL_PLAY');
    }
  }

  function checkRevealSolve(raw) {
    const guess = norm(raw).replace(/[^a-z]/g, '');
    if (!guess) {
      triggerVisualFx('skip');
      showToast('Type a guess first');
      return;
    }
    if (guess === state.revealWord) {
      state.revealIndex = state.revealWord.length;
      burstConfetti();
      go('REVEAL_AWARD');
      showToast(`Solved: ${state.revealWord.toUpperCase()}!`);
    } else {
      state.revealMisses += 1;
      saveState();
      triggerVisualFx('buzzer');
      showToast(`Not "${guess.toUpperCase()}"`);
      go('REVEAL_PLAY');
    }
  }

  function awardRevealPoint(playerId, opts = {}) {
    const now = Date.now();
    const elapsedMs = state.revealStartedAt ? Math.max(0, now - state.revealStartedAt) : null;
    const solvedWord = state.revealWord;

    if (playerId === 'team') {
      recordHistoryEntry({
        id: `h_${now}_${Math.random().toString(36).slice(2, 6)}`,
        game: '🔤 Reveal',
        word: solvedWord,
        elapsedMs,
        playerIds: [],
        playerName: 'Team Co-op',
        mode: state.revealDiff,
        status: 'awarded',
        timestamp: now
      });
      burstConfetti(opts.originX, opts.originY);
      showToast(`Team solved "${solvedWord.toUpperCase()}"!`);
    } else {
      const p = state.players.find((pl) => pl.id === playerId);
      if (p) {
        p.score += 1;
        recordHistoryEntry({
          id: `h_${now}_${Math.random().toString(36).slice(2, 6)}`,
          game: '🔤 Reveal',
          word: solvedWord,
          elapsedMs,
          playerId: p.id,
          playerIds: [p.id],
          playerName: p.name,
          mode: state.revealDiff,
          status: 'awarded',
          timestamp: now
        });
        burstConfetti(opts.originX, opts.originY);
        showToast(`+1 ${p.name}`);
      }
    }

    state.revealWord = '';
    state.revealIndex = 0;
    state.revealTried = [];
    state.revealStartedAt = null;
    go('REVEAL_PICK');
    if (playerId && playerId !== 'team') popScoreChip(playerId);
  }

  // =========================================================================
  // GAME 3: CATEGORIES (Points & Elimination)
  // =========================================================================
  function dealCategory(fxKind = null) {
    const deck = window.CATEGORIES_DECK || [];
    const unused = deck.filter((c) => !state.catUsed.includes(c));
    const pool = unused.length > 0 ? unused : deck;
    if (!pool.length) return;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    state.catCurrent = pick;
    state.catLetter = state.catUseLetter
      ? STARTING_LETTERS[Math.floor(Math.random() * STARTING_LETTERS.length)]
      : '';
    state.catEliminated = [];
    if (!state.catUsed.includes(pick)) state.catUsed.push(pick);
    saveState();
    if (state.screen === 'CAT_PLAY') {
      render(true);
      if (fxKind) triggerVisualFx(fxKind);
    }
  }

  function handleCategoryStall(stalledPlayerId, opts = {}) {
    const stalled = state.players.find((p) => p.id === stalledPlayerId);
    if (!stalled) return;
    const now = Date.now();
    const catLabel = state.catLetter ? `${state.catCurrent} (${state.catLetter})` : state.catCurrent;

    if (state.catMode === 'points') {
      const winners = state.players.filter((p) => p.id !== stalledPlayerId);
      winners.forEach((w) => { w.score += 1; });
      const winnerNames = winners.map((w) => w.name).join(', ');
      recordHistoryEntry({
        id: `h_${now}_${Math.random().toString(36).slice(2, 6)}`,
        game: '🗂️ Categories',
        word: catLabel,
        playerIds: winners.map((w) => w.id),
        playerName: winners.length === 1 ? winners[0].name : `All except ${stalled.name}`,
        mode: 'points',
        status: 'awarded',
        timestamp: now
      });
      burstConfetti(opts.originX, opts.originY);
      dealCategory(null);
      winners.forEach((w) => popScoreChip(w.id));
      showToast(winners.length === 1 ? `+1 ${winners[0].name}` : `+1 to ${winnerNames}`);
    } else {
      if (state.catEliminated.includes(stalledPlayerId)) return;
      state.catEliminated.push(stalledPlayerId);
      const remaining = state.players.filter((p) => !state.catEliminated.includes(p.id));

      if (remaining.length <= 1) {
        const winner = remaining[0];
        if (winner) {
          winner.score += 1;
          recordHistoryEntry({
            id: `h_${now}_${Math.random().toString(36).slice(2, 6)}`,
            game: '🗂️ Categories',
            word: catLabel,
            playerId: winner.id,
            playerIds: [winner.id],
            playerName: winner.name,
            mode: 'elimination',
            status: 'awarded',
            timestamp: now
          });
          burstConfetti(opts.originX, opts.originY);
          dealCategory(null);
          popScoreChip(winner.id);
          showToast(`${winner.name} wins the round! +1`);
        } else {
          dealCategory('skip');
        }
      } else {
        saveState();
        render(false);
        triggerVisualFx('skip');
        showToast(`${stalled.name} is OUT (${remaining.length} left)`);
      }
    }
  }

  // =========================================================================
  // RENDERING
  // =========================================================================
  function renderTopBar() {
    const online = navigator.onLine;
    if (offlinePillEl) offlinePillEl.classList.toggle('hidden', online);

    const onHome = state.screen === 'HOME';
    if (btnHomeEl) btnHomeEl.classList.toggle('hidden', onHome);

    const qLen = state.pendingQueue.length;
    queuePillEl.textContent = String(qLen);
    queuePillEl.classList.toggle('hidden', qLen === 0);

    scoreStripEl.innerHTML = state.players
      .map((p) => `<span class="score-chip" data-chip-player="${esc(p.id)}">${esc(p.name)} <span class="num">${p.score}</span></span>`)
      .join('');
  }

  function renderHome() {
    screenEl.innerHTML = `
      <div class="home-header">
        <h1 class="home-title">🚗 CarGames</h1>
        <p class="home-sub">Silent · Offline-first · Everyone plays</p>
      </div>
      <div class="home-grid">
        <button class="home-card" data-open-game="song" type="button">
          <span class="home-emoji" aria-hidden="true">🎵</span>
          <span class="home-card-body">
            <span class="home-card-title">The Song Game</span>
            <span class="home-card-desc">Prove a song with the word in its lyrics · Classic &amp; Rapid</span>
          </span>
        </button>

        <button class="home-card" data-open-game="reveal" type="button">
          <span class="home-emoji" aria-hidden="true">🔤</span>
          <span class="home-card-body">
            <span class="home-card-title">Prefix Reveal</span>
            <span class="home-card-desc">Blind left-to-right letter guessing · Fair for Driver &amp; Passenger</span>
          </span>
        </button>

        <button class="home-card" data-open-game="categories" type="button">
          <span class="home-emoji" aria-hidden="true">🗂️</span>
          <span class="home-card-body">
            <span class="home-card-title">Categories</span>
            <span class="home-card-desc">Volley answers until someone stalls · Points &amp; Elimination</span>
          </span>
        </button>
      </div>
    `;
  }

  function renderPlayerButtons(attrName, opts = {}) {
    const compact = state.players.length >= 5;
    const eliminated = opts.eliminated || [];
    const subLabel = opts.subLabel || (compact ? '+1' : '+1 Point');
    return state.players
      .map((p) => {
        const isOut = eliminated.includes(p.id);
        return compact
          ? `
            <button class="big-btn compact ${isOut ? 'eliminated' : ''}" ${attrName}="${esc(p.id)}" type="button" ${isOut ? 'disabled' : ''}>
              <span>${esc(p.name)}</span>
              <span class="sub">${isOut ? 'OUT' : subLabel}</span>
            </button>
          `
          : `
            <button class="big-btn tall ${isOut ? 'eliminated' : ''}" ${attrName}="${esc(p.id)}" type="button" ${isOut ? 'disabled' : ''}>
              <span>${esc(p.name)}</span>
              <span class="score-big">${p.score}</span>
              <span class="sub">${isOut ? 'OUT' : subLabel}</span>
            </button>
          `;
      })
      .join('');
  }

  // --- Song Game screens ---
  function renderPickWord() {
    const cg = clueGiver();
    screenEl.innerHTML = `
      <div class="hero">
        <div class="hero-eyebrow">🎵 SONG GAME · CLASSIC</div>
        <div class="hero-word" style="font-size:clamp(30px, 9vw, 44px);">New Word</div>
        <div class="hero-sub">${esc(cg.name)}'s turn to clue, or deal one</div>
      </div>

      <div class="btn-stack">
        <button class="big-btn primary" data-action="go-enter" type="button">
          <span>Type a Word</span>
          <span class="sub">${esc(cg.name)} picks the clue</span>
        </button>

        <div class="btn-row three">
          <button class="big-btn green" data-deal="easy" type="button"><span>Easy</span><span class="sub">Deal</span></button>
          <button class="big-btn accent-outline" data-deal="medium" type="button"><span>Med</span><span class="sub">Deal</span></button>
          <button class="big-btn amber" data-deal="hard" type="button"><span>Hard</span><span class="sub">Deal</span></button>
        </div>
      </div>
    `;
  }

  function renderRapid() {
    const compact = state.players.length >= 4;
    const accents = ['accent-outline', 'green', 'amber', 'accent-outline', 'green', 'amber'];
    const playerBtns = state.players
      .map((p, idx) => compact
        ? `<button class="big-btn giant ${accents[idx % accents.length]}" data-award="${esc(p.id)}" type="button"><span>${esc(p.name)}</span><span class="sub">+1 Point</span></button>`
        : `<button class="big-btn giant ${accents[idx % accents.length]}" data-award="${esc(p.id)}" type="button"><span>${esc(p.name)}</span><span class="score-big">${p.score}</span><span class="sub">Tap +1 Point</span></button>`)
      .join('');
    const hasUndo = state.history.some((h) => h.status !== 'revoked');

    screenEl.innerHTML = `
      <div class="hero-eyebrow" style="text-align:center;">🎵 SONG GAME · RAPID</div>
      <div class="rapid-grid ${compact ? 'grid-2col' : ''}">${playerBtns}</div>
      <button class="big-btn short" data-action="rapid-undo" type="button" ${hasUndo ? '' : 'disabled'}>
        <span>Undo Last Point</span>
      </button>
    `;
  }

  function renderEnterWord() {
    const cg = clueGiver();
    screenEl.innerHTML = `
      <div class="hero">
        <div class="hero-eyebrow">${esc(cg.name)}'s Clue Word</div>
        <form id="enterWordForm" style="width:100%;display:flex;flex-direction:column;gap:12px;">
          <input id="enterWordInput" class="big-input" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="e.g. moonlight" />
        </form>
      </div>
      <div class="btn-stack">
        <button class="big-btn primary" data-action="submit-word" type="button"><span>Start Round</span></button>
        <button class="big-btn short" data-action="back-pick" type="button"><span>Back</span></button>
      </div>
    `;
    const input = $('enterWordInput');
    if (input) {
      setTimeout(() => input.focus(), 40);
      $('enterWordForm').addEventListener('submit', (e) => {
        e.preventDefault();
        if (input.value.trim()) startSongRound(input.value, 'human');
      });
    }
  }

  function renderPlaying() {
    const cg = clueGiver();
    const isHuman = state.wordSource === 'human';
    const eyebrow = isHuman
      ? `Clue by ${cg.name} · Others prove`
      : `App Deal · ${state.wordSource.toUpperCase()} · First to prove`;

    const rightAction = isHuman
      ? `<button class="big-btn short amber" data-action="go-bluff" type="button"><span>Prove It!</span><span class="sub">Bluff check</span></button>`
      : `<button class="big-btn short" data-action="next-word" type="button"><span>Next Word</span><span class="sub">Skip word</span></button>`;

    screenEl.innerHTML = `
      <div class="hero">
        <div class="hero-eyebrow">${esc(eyebrow)}</div>
        <div class="hero-word word-pop">${esc(state.currentWord)}</div>
      </div>

      <div class="btn-stack">
        <div class="btn-row">${renderPlayerButtons('data-award')}</div>
        <div class="btn-row">
          <button class="big-btn short accent-outline" data-action="go-verify" type="button"><span>Verify Song</span><span class="sub">Check lyrics</span></button>
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
      ? `<button class="big-btn red" data-bluff-fail="${esc(singleChallenger.id)}" type="button"><span>Bluff! +1 ${esc(singleChallenger.name)}</span><span class="sub">${esc(cg.name)} couldn't prove it</span></button>`
      : `<button class="big-btn red" data-action="next-word" type="button"><span>Bluff! No Point</span><span class="sub">Move to next word</span></button>`;

    screenEl.innerHTML = `
      <div class="hero bluff">
        <div class="hero-eyebrow">Bluff Check</div>
        <div class="hero-word">${esc(state.currentWord)}</div>
        <div class="hero-sub">${esc(cg.name)} must prove a song!</div>
      </div>
      <div class="btn-stack">
        <button class="big-btn green" data-bluff-pass="${esc(cg.id)}" type="button"><span>${esc(cg.name)} Proved It</span><span class="sub">+1 ${esc(cg.name)}</span></button>
        ${failBtn}
        <div class="btn-row">
          <button class="big-btn short accent-outline" data-action="go-verify" type="button"><span>Verify Song</span></button>
          <button class="big-btn short" data-action="back-playing" type="button"><span>Back</span></button>
        </div>
      </div>
    `;
  }

  function renderVerify() {
    let resultHtml = '';
    if (verifyState && verifyState.loading) {
      resultHtml = `<div class="verify-card"><div class="track-title">Checking LRCLIB...</div><div class="track-artist">Searching "${esc(verifyState.query)}" for "${esc(state.currentWord)}"</div></div>`;
    } else if (verifyState && (verifyState.offline || verifyState.notFound)) {
      const awardBtns = state.players
        .map((p) => `<button class="big-btn short" data-queue-award="${esc(p.id)}" type="button"><span>${verifyState.offline ? 'Queue' : 'Trust'} +1 ${esc(p.name)}</span></button>`)
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
      const badgeText = r.verdict === 'match' ? 'In Lyrics' : r.verdict === 'title-only' ? 'Title Only' : r.hasLyrics ? 'Not in Lyrics' : 'No Lyrics in DB';
      const awardBtns = state.players
        .map((p) => `<button class="big-btn short ${r.verdict === 'match' ? 'primary' : ''}" data-verify-award="${esc(p.id)}" type="button"><span>+1 ${esc(p.name)}</span></button>`)
        .join('');
      const alts = verifyState.results.length > 1
        ? verifyState.results.slice(0, 3).map((alt, idx) => idx === verifyState.selectedIdx ? '' : `<button class="alt-btn" data-alt-idx="${idx}" type="button">Switch: ${esc(alt.title)} — ${esc(alt.artist)} (${alt.verdict === 'match' ? 'Match' : alt.verdict === 'title-only' ? 'Title only' : 'Miss'})</button>`).join('')
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
          <input id="verifySongInput" class="big-input left" type="text" autocomplete="off" placeholder="Song title (optional artist)..." value="${esc(verifyState ? verifyState.query : '')}" />
          <button class="big-btn short primary" type="submit"><span>Check Lyrics</span></button>
        </form>
        ${resultHtml}
      </div>
      <button class="big-btn short" data-action="back-from-verify" type="button"><span>Back</span></button>
    `;

    const form = $('verifySongForm');
    const inp = $('verifySongInput');
    if (form && inp) {
      form.addEventListener('submit', (e) => { e.preventDefault(); runVerify(inp.value); });
      if (!verifyState) setTimeout(() => inp.focus(), 40);
    }
  }

  // --- Prefix Reveal screens ---
  function renderRevealPick() {
    screenEl.innerHTML = `
      <div class="hero">
        <div class="hero-eyebrow">🔤 PREFIX REVEAL</div>
        <div class="hero-word" style="font-size:clamp(30px, 9vw, 44px);">Blind Word</div>
        <div class="hero-sub">Guess letters left-to-right · Hidden from everyone</div>
      </div>
      <div class="btn-stack">
        <button class="big-btn green" data-reveal-deal="easy" type="button"><span>Easy</span><span class="sub">6 letters</span></button>
        <button class="big-btn accent-outline" data-reveal-deal="medium" type="button"><span>Medium</span><span class="sub">7 letters</span></button>
        <button class="big-btn amber" data-reveal-deal="hard" type="button"><span>Hard</span><span class="sub">9–10 letters</span></button>
      </div>
    `;
  }

  function renderRevealPlay() {
    const revealed = state.revealWord.slice(0, state.revealIndex).split('');
    const remaining = state.revealWord.length - state.revealIndex;
    const prefixTiles = revealed.map((ch) => `<span class="prefix-char">${esc(ch)}</span>`).join('');
    const triedText = state.revealTried.length
      ? `Tried here: ${state.revealTried.map((c) => c.toUpperCase()).join(', ')}`
      : `Guess letter #${state.revealIndex + 1} (in order)`;

    screenEl.innerHTML = `
      <div class="hero">
        <div class="hero-eyebrow">🔤 ${esc(state.revealHint)} · ${state.revealWord.length} LETTERS</div>
        <div class="prefix-row">
          ${prefixTiles}
          <span class="prefix-next">?</span>
          ${remaining > 1 ? `<span class="prefix-rest">+${remaining - 1} more</span>` : ''}
        </div>
        <div class="tried-row">${esc(triedText)}</div>
      </div>

      <div class="btn-stack">
        <button class="big-btn primary" data-action="reveal-go-guess" type="button">
          <span>Guess Letter #${state.revealIndex + 1}</span>
          <span class="sub">Type 1 letter</span>
        </button>
        <div class="btn-row">
          <button class="big-btn short green" data-action="reveal-go-solve" type="button">
            <span>Solve Word</span>
            <span class="sub">Full guess</span>
          </button>
          <button class="big-btn short amber" data-action="reveal-hint" type="button">
            <span>Reveal Letter</span>
            <span class="sub">Free hint</span>
          </button>
        </div>
      </div>
    `;
  }

  function renderRevealGuess() {
    const prefix = state.revealWord.slice(0, state.revealIndex).toUpperCase();
    screenEl.innerHTML = `
      <div class="hero">
        <div class="hero-eyebrow">${esc(state.revealHint)} · Letter #${state.revealIndex + 1}</div>
        <div class="hero-sub">${prefix ? `So far: ${esc(prefix)}_` : 'First letter'}</div>
        <form id="revealGuessForm" style="width:100%;">
          <input id="revealLetterInput" class="big-input" type="text" maxlength="1" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="A–Z" />
        </form>
      </div>
      <div class="btn-stack">
        <button class="big-btn primary" data-action="reveal-submit-letter" type="button"><span>Check Letter</span></button>
        <button class="big-btn short" data-action="reveal-back" type="button"><span>Back</span></button>
      </div>
    `;
    const inp = $('revealLetterInput');
    if (inp) {
      setTimeout(() => inp.focus(), 40);
      $('revealGuessForm').addEventListener('submit', (e) => {
        e.preventDefault();
        checkRevealLetter(inp.value);
      });
    }
  }

  function renderRevealSolve() {
    const prefix = state.revealWord.slice(0, state.revealIndex).toUpperCase();
    screenEl.innerHTML = `
      <div class="hero">
        <div class="hero-eyebrow">Solve the ${state.revealWord.length}-Letter Word</div>
        <div class="hero-sub">${esc(state.revealHint)}${prefix ? ` · Starts with ${esc(prefix)}` : ''}</div>
        <form id="revealSolveForm" style="width:100%;">
          <input id="revealSolveInput" class="big-input" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Type full word..." />
        </form>
      </div>
      <div class="btn-stack">
        <button class="big-btn green" data-action="reveal-submit-solve" type="button"><span>Check Answer</span></button>
        <button class="big-btn short" data-action="reveal-back" type="button"><span>Back</span></button>
      </div>
    `;
    const inp = $('revealSolveInput');
    if (inp) {
      setTimeout(() => inp.focus(), 40);
      $('revealSolveForm').addEventListener('submit', (e) => {
        e.preventDefault();
        checkRevealSolve(inp.value);
      });
    }
  }

  function renderRevealAward() {
    screenEl.innerHTML = `
      <div class="hero">
        <div class="hero-eyebrow">SOLVED! · ${state.revealMisses} MISS${state.revealMisses === 1 ? '' : 'ES'}</div>
        <div class="hero-word word-pop">${esc(state.revealWord)}</div>
        <div class="hero-sub">Tap who solved it</div>
      </div>
      <div class="btn-stack">
        <div class="btn-row">${renderPlayerButtons('data-reveal-award')}</div>
        <button class="big-btn short accent-outline" data-reveal-award="team" type="button">
          <span>Team Co-op (Next Word)</span>
        </button>
      </div>
    `;
  }

  // --- Categories screen ---
  function renderCatPlay() {
    const isPoints = state.catMode === 'points';
    const subPrompt = isPoints
      ? 'Tap who stalled (everyone else +1)'
      : 'Tap who stalled (marked OUT until 1 left)';
    const modeLabel = isPoints ? 'POINTS' : 'ELIMINATION';

    screenEl.innerHTML = `
      <div class="hero">
        <div class="hero-eyebrow">🗂️ CATEGORIES · ${modeLabel}</div>
        <div class="cat-hero-text word-pop">${esc(state.catCurrent)}</div>
        ${state.catLetter ? `<span class="letter-chip">Starts with: ${esc(state.catLetter)}</span>` : ''}
        <div class="hero-sub">${subPrompt}</div>
      </div>

      <div class="btn-stack">
        <div class="btn-row">${renderPlayerButtons('data-cat-stall', {
          eliminated: isPoints ? [] : state.catEliminated,
          subLabel: isPoints ? 'Stalled' : 'Tap = Out'
        })}</div>
        <div class="btn-row">
          <button class="big-btn short accent-outline" data-action="cat-toggle-mode" type="button">
            <span>${isPoints ? 'Points' : 'Elimination'}</span>
            <span class="sub">Tap to switch</span>
          </button>
          <button class="big-btn short" data-action="cat-skip" type="button">
            <span>New Category</span>
            <span class="sub">Skip</span>
          </button>
        </div>
      </div>
    `;
  }

  // --- Menu Overlay (context-aware per game) ---
  function renderMenu() {
    let gameSection = '';
    if (state.game === 'song') {
      gameSection = `
        <div>
          <div class="section-label">🎵 Song Game Mode</div>
          <div class="btn-row">
            <button class="big-btn short ${state.songMode === 'classic' ? 'primary' : ''}" data-set-song-mode="classic" type="button"><span>Classic</span><span class="sub">Words &amp; verify</span></button>
            <button class="big-btn short ${state.songMode === 'rapid' ? 'primary' : ''}" data-set-song-mode="rapid" type="button"><span>Rapid</span><span class="sub">Points only</span></button>
          </div>
        </div>
        ${state.currentWord && state.songMode === 'classic'
          ? `<button class="big-btn short amber" data-menu="skip-song-word" type="button"><span>Skip Current Word</span></button>`
          : ''}
      `;
    } else if (state.game === 'reveal' && state.revealWord) {
      gameSection = `
        <button class="big-btn short amber" data-menu="reveal-giveup" type="button">
          <span>Give Up &amp; Show Word</span>
        </button>
      `;
    } else if (state.game === 'categories') {
      gameSection = `
        <div>
          <div class="section-label">🗂️ Categories Mode</div>
          <div class="btn-row">
            <button class="big-btn short ${state.catMode === 'points' ? 'primary' : ''}" data-set-cat-mode="points" type="button"><span>Points</span><span class="sub">Others +1</span></button>
            <button class="big-btn short ${state.catMode === 'elimination' ? 'primary' : ''}" data-set-cat-mode="elimination" type="button"><span>Elimination</span><span class="sub">Last standing</span></button>
          </div>
        </div>
        <label class="toggle-card">
          <span>Require random starting letter (A–Z)</span>
          <input id="menuCatLetterToggle" type="checkbox" ${state.catUseLetter ? 'checked' : ''} />
        </label>
      `;
    }

    const queueHtml = state.pendingQueue.length
      ? `
        <div>
          <div class="section-label">Pending Offline Checks (${state.pendingQueue.length})</div>
          <div class="btn-stack">
            <button class="big-btn short primary" data-menu="process-queue" type="button"><span>Check Queue Now</span></button>
            ${state.pendingQueue.map((q) => `
              <div class="list-card">
                <div class="list-top"><span>"${esc(q.query)}" for "${esc(q.word)}"</span><span class="verdict-pill offline">Queued</span></div>
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
          const elapsedTag = h.elapsedMs != null ? ` · ${formatElapsed(h.elapsedMs)}` : '';
          const wordLabel = h.word ? ` · "${esc(h.word)}"` : '';
          return `
            <div class="list-card">
              <div class="list-top"><span>${esc(h.game || '')} ${esc(h.playerName)}${wordLabel}</span>${badge}</div>
              ${h.song ? `<div class="list-sub">${esc(h.song)}</div>` : ''}
              <div class="list-top" style="margin-top:4px;">
                <span class="list-sub">${esc(h.mode || '')}${h.bluff ? ' · bluff' : ''}${elapsedTag}</span>
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

      ${gameSection}

      <div class="btn-row">
        <button class="big-btn short" data-menu="undo" type="button" ${state.history.some((h) => h.status !== 'revoked') ? '' : 'disabled'}><span>Undo Last</span></button>
        <button class="big-btn short red" data-menu="reset" type="button"><span>New Trip</span></button>
      </div>

      ${queueHtml}

      <div>
        <div class="section-label">Players (Shared Across Games)</div>
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

      ${state.game === 'song' ? `
        <label class="toggle-card">
          <span>Allow plural/root lyric match (blue → blues)</span>
          <input id="menuRootToggle" type="checkbox" ${state.allowRootMatch ? 'checked' : ''} />
        </label>
      ` : ''}

      <div>
        <div class="section-label">Trip History (${state.history.length})</div>
        <div class="btn-stack" style="gap:8px;">${historyHtml}</div>
      </div>
    `;
  }

  function render(animate = false) {
    renderTopBar();
    if (state.screen === 'HOME') renderHome();
    else if (state.screen === 'RAPID') renderRapid();
    else if (state.screen === 'PICK_WORD') renderPickWord();
    else if (state.screen === 'ENTER_WORD') renderEnterWord();
    else if (state.screen === 'PLAYING') renderPlaying();
    else if (state.screen === 'BLUFF_CHECK') renderBluffCheck();
    else if (state.screen === 'VERIFY') renderVerify();
    else if (state.screen === 'REVEAL_PICK') renderRevealPick();
    else if (state.screen === 'REVEAL_PLAY') renderRevealPlay();
    else if (state.screen === 'REVEAL_GUESS') renderRevealGuess();
    else if (state.screen === 'REVEAL_SOLVE') renderRevealSolve();
    else if (state.screen === 'REVEAL_AWARD') renderRevealAward();
    else if (state.screen === 'CAT_PLAY') renderCatPlay();
    else renderHome();

    if (animate && !prefersReducedMotion()) {
      screenEl.classList.remove('screen-in');
      void screenEl.offsetWidth;
      screenEl.classList.add('screen-in');
    }
  }

  // =========================================================================
  // EVENT HANDLERS
  // =========================================================================
  btnHomeEl.addEventListener('click', () => enterGame('home'));

  screenEl.addEventListener('click', (e) => {
    const openGame = e.target.closest('[data-open-game]');
    if (openGame) { enterGame(openGame.dataset.openGame); return; }

    // Song Game handlers
    const dealBtn = e.target.closest('[data-deal]');
    if (dealBtn) {
      const diff = dealBtn.dataset.deal;
      startSongRound(dealSongWord(diff), diff);
      return;
    }

    const awardBtn = e.target.closest('[data-award]');
    if (awardBtn) { awardSongPoint(awardBtn.dataset.award, btnCenter(awardBtn)); return; }

    const bluffPass = e.target.closest('[data-bluff-pass]');
    if (bluffPass) {
      awardSongPoint(bluffPass.dataset.bluffPass, { ...btnCenter(bluffPass), bluff: true, palette: ['#3fb950', '#38bdf8', '#f0b429'] });
      return;
    }

    const bluffFail = e.target.closest('[data-bluff-fail]');
    if (bluffFail) {
      awardSongPoint(bluffFail.dataset.bluffFail, { ...btnCenter(bluffFail), bluff: true, fxKind: 'buzzer', palette: ['#f85149', '#f0b429', '#38bdf8'] });
      return;
    }

    const altBtn = e.target.closest('[data-alt-idx]');
    if (altBtn && verifyState && verifyState.results) {
      verifyState.selectedIdx = Number(altBtn.dataset.altIdx);
      render(false);
      return;
    }

    const verifyAward = e.target.closest('[data-verify-award]');
    if (verifyAward && verifyState && verifyState.results) {
      const r = verifyState.results[verifyState.selectedIdx];
      awardSongPoint(verifyAward.dataset.verifyAward, {
        ...btnCenter(verifyAward),
        songLabel: `${r.title} — ${r.artist}`,
        songKey: r.key,
        bluff: state.returnScreen === 'BLUFF_CHECK',
        status: r.verdict === 'match' ? 'verified' : r.verdict === 'title-only' ? 'title-only' : 'awarded'
      });
      return;
    }

    const queueAward = e.target.closest('[data-queue-award]');
    if (queueAward && verifyState) {
      awardSongPoint(queueAward.dataset.queueAward, {
        ...btnCenter(queueAward),
        songLabel: verifyState.query,
        songKey: songKey(verifyState.query, ''),
        bluff: state.returnScreen === 'BLUFF_CHECK',
        status: verifyState.offline ? 'queued' : 'awarded',
        queueQuery: verifyState.offline ? verifyState.query : null
      });
      return;
    }

    // Prefix Reveal handlers
    const revealDeal = e.target.closest('[data-reveal-deal]');
    if (revealDeal) { dealRevealWord(revealDeal.dataset.revealDeal); return; }

    const revealAward = e.target.closest('[data-reveal-award]');
    if (revealAward) { awardRevealPoint(revealAward.dataset.revealAward, btnCenter(revealAward)); return; }

    // Categories handlers
    const catStall = e.target.closest('[data-cat-stall]');
    if (catStall) { handleCategoryStall(catStall.dataset.catStall, btnCenter(catStall)); return; }

    // Generic actions
    const actionBtn = e.target.closest('[data-action]');
    if (!actionBtn) return;
    const act = actionBtn.dataset.action;

    if (act === 'go-enter') go('ENTER_WORD');
    else if (act === 'back-pick') go('PICK_WORD');
    else if (act === 'submit-word') {
      const inp = $('enterWordInput');
      if (inp && inp.value.trim()) startSongRound(inp.value, 'human');
      else { triggerVisualFx('skip'); showToast('Type a word first'); }
    } else if (act === 'go-bluff') go('BLUFF_CHECK');
    else if (act === 'back-playing') go('PLAYING');
    else if (act === 'next-word') { showToast('Skipped word'); finishSongWord('skip'); }
    else if (act === 'go-verify') { state.returnScreen = state.screen; verifyState = null; go('VERIFY'); }
    else if (act === 'back-from-verify') { verifyState = null; go(state.returnScreen || 'PLAYING'); }
    else if (act === 'rapid-undo') undoLast();
    else if (act === 'reveal-go-guess') go('REVEAL_GUESS');
    else if (act === 'reveal-go-solve') go('REVEAL_SOLVE');
    else if (act === 'reveal-back') go('REVEAL_PLAY');
    else if (act === 'reveal-hint') revealNextLetterHint();
    else if (act === 'reveal-submit-letter') {
      const inp = $('revealLetterInput');
      checkRevealLetter(inp ? inp.value : '');
    } else if (act === 'reveal-submit-solve') {
      const inp = $('revealSolveInput');
      checkRevealSolve(inp ? inp.value : '');
    } else if (act === 'cat-toggle-mode') {
      state.catMode = state.catMode === 'points' ? 'elimination' : 'points';
      state.catEliminated = [];
      saveState();
      render(true);
      showToast(state.catMode === 'points' ? 'Points Mode (Others +1)' : 'Elimination Mode (Last Standing)');
    } else if (act === 'cat-skip') {
      showToast('New category');
      dealCategory('skip');
    }
  });

  // Menu
  $('btnMenu').addEventListener('click', () => {
    menuOpen = true;
    renderMenu();
    menuOverlayEl.classList.remove('hidden');
  });

  menuContentEl.addEventListener('click', (e) => {
    const songModeBtn = e.target.closest('[data-set-song-mode]');
    if (songModeBtn) {
      state.songMode = songModeBtn.dataset.setSongMode;
      state.screen = state.songMode === 'rapid' ? 'RAPID' : (state.currentWord ? 'PLAYING' : 'PICK_WORD');
      saveState();
      menuOpen = false;
      menuOverlayEl.classList.add('hidden');
      render(true);
      showToast(state.songMode === 'rapid' ? 'Rapid Mode (Points only)' : 'Classic Mode');
      return;
    }

    const catModeBtn = e.target.closest('[data-set-cat-mode]');
    if (catModeBtn) {
      state.catMode = catModeBtn.dataset.setCatMode;
      state.catEliminated = [];
      saveState();
      menuOpen = false;
      menuOverlayEl.classList.add('hidden');
      render(true);
      showToast(state.catMode === 'points' ? 'Points Mode' : 'Elimination Mode');
      return;
    }

    const remBtn = e.target.closest('[data-remove-player]');
    if (remBtn && state.players.length > 2) {
      state.players = state.players.filter((p) => p.id !== remBtn.dataset.removePlayer);
      state.catEliminated = state.catEliminated.filter((id) => id !== remBtn.dataset.removePlayer);
      saveState();
      renderMenu();
      render(false);
      return;
    }

    const revBtn = e.target.closest('[data-revoke]');
    if (revBtn) { revokeItem(revBtn.dataset.revoke); return; }

    const menuBtn = e.target.closest('[data-menu]');
    if (!menuBtn) return;
    const cmd = menuBtn.dataset.menu;
    if (cmd === 'close') {
      menuOpen = false;
      menuOverlayEl.classList.add('hidden');
      render(false);
    } else if (cmd === 'undo') {
      undoLast();
    } else if (cmd === 'skip-song-word') {
      menuOpen = false;
      menuOverlayEl.classList.add('hidden');
      showToast('Skipped word');
      finishSongWord('skip');
    } else if (cmd === 'reveal-giveup') {
      const revealed = state.revealWord.toUpperCase();
      state.revealWord = '';
      state.revealIndex = 0;
      state.revealTried = [];
      menuOpen = false;
      menuOverlayEl.classList.add('hidden');
      go('REVEAL_PICK');
      triggerVisualFx('skip');
      showToast(`Word was: ${revealed}`);
    } else if (cmd === 'process-queue') {
      processQueue();
    } else if (cmd === 'add-player') {
      state.players.push({ id: `p_${Date.now()}`, name: `Player ${state.players.length + 1}`, score: 0 });
      saveState();
      renderMenu();
      render(false);
    } else if (cmd === 'reset') {
      const names = state.players.map((p) => ({ id: p.id, name: p.name, score: 0 }));
      state = { ...defaultState(), players: names, allowRootMatch: state.allowRootMatch };
      verifyState = null;
      saveState();
      menuOpen = false;
      menuOverlayEl.classList.add('hidden');
      render(true);
      showToast('New trip started');
    }
  });

  menuContentEl.addEventListener('input', (e) => {
    const inp = e.target.closest('[data-edit-player]');
    if (inp) {
      const p = state.players.find((pl) => pl.id === inp.dataset.editPlayer);
      if (p) { p.name = inp.value.trim() || 'Player'; saveState(); renderTopBar(); }
    }
  });

  menuContentEl.addEventListener('change', (e) => {
    if (e.target && e.target.id === 'menuRootToggle') {
      state.allowRootMatch = e.target.checked;
      saveState();
    } else if (e.target && e.target.id === 'menuCatLetterToggle') {
      state.catUseLetter = e.target.checked;
      state.catLetter = state.catUseLetter
        ? STARTING_LETTERS[Math.floor(Math.random() * STARTING_LETTERS.length)]
        : '';
      saveState();
      render(false);
    }
  });

  window.addEventListener('online', () => {
    renderTopBar();
    if (state.pendingQueue.length) { showToast('Back online — checking queue...'); processQueue(); }
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

  render(false);
})();
