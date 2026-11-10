(function (global) {
  'use strict';

  // Legacy Chromium M47 (2017 Samsung Tizen 3.0) DOM polyfills
  if (typeof Element !== 'undefined') {
    if (!Element.prototype.matches) {
      Element.prototype.matches =
        Element.prototype.webkitMatchesSelector ||
        Element.prototype.msMatchesSelector ||
        function (s) {
          var matches = (this.document || this.ownerDocument).querySelectorAll(s);
          var i = matches.length;
          while (--i >= 0 && matches.item(i) !== this) {}
          return i > -1;
        };
    }
    if (!Element.prototype.closest) {
      Element.prototype.closest = function (s) {
        var el = this;
        do {
          if (el.nodeType === 1 && el.matches(s)) return el;
          el = el.parentElement || el.parentNode;
        } while (el !== null && el.nodeType === 1);
        return null;
      };
    }
  }

  var NS = (global.vertIPTV = global.vertIPTV || {});
  var ROW_HEIGHT = 68;

  var CATCHUP_MODES = [
    { value: 'auto', label: 'Auto-Detect (M3U / XC / Flussonic / Shift)' },
    { value: 'xc', label: 'Xtream Codes (/timeshift/)' },
    { value: 'shift', label: 'Shift (?utc=&lutc=)' },
    { value: 'flussonic', label: 'Flussonic (index-UTC-DUR)' },
    { value: 'append', label: 'Append catchup-source' }
  ];
  var EPG_OFFSET_OPTS = [-120, -60, 0, 60, 120];
  var LANG_OPTS = [
    { value: 'en', shortLabel: '🌐 EN', label: 'English' },
    { value: 'de', shortLabel: '🌐 DE', label: 'Deutsch' },
    { value: 'pl', shortLabel: '🌐 PL', label: 'Polski' }
  ];

  var I18N = {
    en: {
      daysShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
      today: 'Today',
      yesterday: 'Yesterday',
      searchPlaceholder: 'Search (OK to type)...',
      returnToLive: '● Return to Live',
      soundOn: '🔊 Sound On',
      muted: '🔇 Muted',
      clickForSound: '🔇 Click / Key for Sound',
      favoriteBtn: '★ Favorite',
      usbBtn: 'USB Pendrive',
      settingsBtn: 'Playlist & EPG',
      categoriesTitle: 'Categories',
      allChannels: 'All Channels',
      favoritesGroup: '★ Favorites',
      recentGroup: '↺ Recent',
      searchPrefix: 'Search: "',
      noChannelsMatch: 'No channels match this filter.',
      liveTvStream: 'Live TV Stream',
      selectAChannel: 'Select a channel',
      noChannelSelected: 'No channel selected',
      noScheduleEntries: 'No schedule entries available.',
      daysBackBadge: '↺ {d} Days Back',
      dayBackBadge: '↺ {d} Day Back',
      broadcastSlot: 'Broadcast Slot',
      hourlyFallbackDesc: 'Direct 1-hour archive jump (no EPG metadata on this channel)',
      pillPlaying: '▶ Playing',
      pillReplay: '↺ Replay',
      pillLive: '● LIVE',
      pillUpcoming: 'Upcoming',
      footerHtml:
        '<span class="footer-item"><kbd>▲▼</kbd> Navigate</span>' +
        '<span class="footer-item"><kbd>◀▶</kbd> Categories / Channels / 3-Day Replay</span>' +
        '<span class="footer-item"><kbd>OK</kbd> Watch Live / Play Replay</span>' +
        '<span class="footer-item"><kbd>▲</kbd> Top Bar (Fav / USB / Lang / Settings)</span>' +
        '<span class="footer-item"><kbd>BACK / ESC</kbd> Fullscreen TV</span>',
      osdArchiveBadge: '↺ ARCHIVE · ',
      osdLiveBadge: '● LIVE',
      osdUpNext: 'Up Next',
      osdLiveBroadcast: 'Live Broadcast',
      osdCatchupFallback: '3-Day Catchup Playback',
      osdLiveHintText: 'Press ◀ Left for 3-Day Replay · OK for Channel Guide',
      osdArchiveControlsHtml:
        '<kbd>◀▶</kbd> Scrub ±30s &nbsp;·&nbsp; <kbd>OK</kbd> Pause/Play &nbsp;·&nbsp; <kbd>▲▼</kbd> Guide &nbsp;·&nbsp; <kbd>BACK/ESC</kbd> Live TV',
      osdLiveControlsHtml:
        '<kbd>OK</kbd> Guide &nbsp;·&nbsp; <kbd>▲▼</kbd> Channel &nbsp;·&nbsp; <kbd>◀</kbd> 3-Day Replay &nbsp;·&nbsp; <kbd>▶</kbd> Info',
      modalTitle: 'Playlist & 3-Day EPG Setup',
      modalSubtitleHtml:
        'Navigate with <strong>Arrows</strong>, press <strong>OK</strong> on a text box to edit (and <strong>OK / Esc</strong> when done), or import directly from a USB pendrive.',
      lblM3uHtml: 'M3U / M3U8 Playlist URL <small>(press OK to edit)</small>',
      lblEpgHtml: 'XMLTV EPG URL <small>(optional if embedded in M3U; .xml or .xml.gz supported)</small>',
      lblCycleMode: 'Catchup Protocol (OK)',
      lblCycleDays: 'Archive Window (OK)',
      lblCycleOffset: 'EPG Time Shift (OK)',
      lblCycleLang: 'Language (OK)',
      usbHelpHtml:
        '<strong>Zero-Typing Pendrive Tip:</strong> Put <code>iptv.json</code> with ' +
        '<code>{"m3uUrl":"...","epgUrl":"..."}</code> (or raw <code>playlist.m3u</code> + <code>epg.xml</code>) on a FAT32 USB stick, plug it into your Samsung TV, and select <strong>Scan USB Pendrive</strong>.',
      btnScanUsb: 'Scan USB Pendrive',
      btnLoadLocal: 'Load Local .m3u File',
      btnLoadDemo: 'Load Built-in Demo',
      btnCloseEsc: 'Close (Esc)',
      btnSaveReload: 'Save & Reload Playlist',
      autoTz: '0h (Auto TZ)',
      bufferingPct: 'Buffering {p}%...',
      connectingStream: 'Connecting stream...',
      toastReturnedLive: '● Returned to Live TV: ',
      toastLiveTv: '● Live TV: ',
      toastUpcoming: 'Upcoming program — airs at ',
      toastFavAdded: '★ Added to Favorites: ',
      toastFavRemoved: 'Removed from Favorites: ',
      toastPaused: '⏸ Paused',
      toastPlaying: '▶ Playing',
      toastArchPaused: '⏸ Archive Paused',
      toastArchPlaying: '▶ Archive Playing',
      toastBackExit: 'Press BACK again to exit vertIPTV',
      toastSavedSettings: '✓ Saved playlist & EPG settings',
      toastLangChanged: '🌐 Language: English'
    },
    de: {
      daysShort: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'],
      today: 'Heute',
      yesterday: 'Gestern',
      searchPlaceholder: 'Suche (OK zum Tippen)...',
      returnToLive: '● Zurück zu Live',
      soundOn: '🔊 Ton an',
      muted: '🔇 Stumm',
      clickForSound: '🔇 Taste für Ton',
      favoriteBtn: '★ Favorit',
      usbBtn: 'USB-Stick',
      settingsBtn: 'Playlist & EPG',
      categoriesTitle: 'Kategorien',
      allChannels: 'Alle Sender',
      favoritesGroup: '★ Favoriten',
      recentGroup: '↺ Zuletzt',
      searchPrefix: 'Suche: "',
      noChannelsMatch: 'Keine Sender für diesen Filter gefunden.',
      liveTvStream: 'Live-TV-Stream',
      selectAChannel: 'Sender auswählen',
      noChannelSelected: 'Kein Sender gewählt',
      noScheduleEntries: 'Keine Programmdaten verfügbar.',
      daysBackBadge: '↺ {d} Tage Archiv',
      dayBackBadge: '↺ {d} Tag Archiv',
      broadcastSlot: 'Sendefenster',
      hourlyFallbackDesc: 'Direkter 1-Stunden-Archivsprung (keine EPG-Daten auf diesem Sender)',
      pillPlaying: '▶ Läuft',
      pillReplay: '↺ Replay',
      pillLive: '● LIVE',
      pillUpcoming: 'Geplant',
      footerHtml:
        '<span class="footer-item"><kbd>▲▼</kbd> Navigieren</span>' +
        '<span class="footer-item"><kbd>◀▶</kbd> Kategorien / Sender / 3-Tage-Archiv</span>' +
        '<span class="footer-item"><kbd>OK</kbd> Live / Replay starten</span>' +
        '<span class="footer-item"><kbd>▲</kbd> Leiste (Fav / USB / Sprache / Setup)</span>' +
        '<span class="footer-item"><kbd>BACK / ESC</kbd> Vollbild-TV</span>',
      osdArchiveBadge: '↺ ARCHIV · ',
      osdLiveBadge: '● LIVE',
      osdUpNext: 'Danach',
      osdLiveBroadcast: 'Live-Übertragung',
      osdCatchupFallback: '3-Tage-Archiv Wiedergabe',
      osdLiveHintText: '◀ Links für 3-Tage-Replay · OK für Senderliste',
      osdArchiveControlsHtml:
        '<kbd>◀▶</kbd> Spulen ±30s &nbsp;·&nbsp; <kbd>OK</kbd> Pause/Play &nbsp;·&nbsp; <kbd>▲▼</kbd> Guide &nbsp;·&nbsp; <kbd>BACK/ESC</kbd> Live-TV',
      osdLiveControlsHtml:
        '<kbd>OK</kbd> Guide &nbsp;·&nbsp; <kbd>▲▼</kbd> Sender &nbsp;·&nbsp; <kbd>◀</kbd> 3-Tage-Replay &nbsp;·&nbsp; <kbd>▶</kbd> Info',
      modalTitle: 'Playlist & 3-Tage-EPG Einstellungen',
      modalSubtitleHtml:
        'Mit <strong>Pfeiltasten</strong> navigieren, <strong>OK</strong> im Textfeld zum Tippen drücken (und <strong>OK / Esc</strong> zum Beenden) oder direkt vom USB-Stick laden.',
      lblM3uHtml: 'M3U / M3U8 Playlist-URL <small>(OK zum Bearbeiten)</small>',
      lblEpgHtml: 'XMLTV EPG-URL <small>(optional falls in M3U enthalten; .xml oder .xml.gz)</small>',
      lblCycleMode: 'Catchup-Modus (OK)',
      lblCycleDays: 'Archiv-Zeitraum (OK)',
      lblCycleOffset: 'EPG-Zeitversatz (OK)',
      lblCycleLang: 'Sprache (OK)',
      usbHelpHtml:
        '<strong>USB-Stick Schnellstart:</strong> Speichere <code>iptv.json</code> mit ' +
        '<code>{"m3uUrl":"...","epgUrl":"..."}</code> (oder <code>playlist.m3u</code> + <code>epg.xml</code>) auf einem FAT32-USB-Stick und wähle <strong>USB-Stick scannen</strong>.',
      btnScanUsb: 'USB-Stick scannen',
      btnLoadLocal: 'Lokale .m3u Datei',
      btnLoadDemo: 'Demo-Sender laden',
      btnCloseEsc: 'Schließen (Esc)',
      btnSaveReload: 'Speichern & Neu laden',
      autoTz: '0h (Auto-Zeit)',
      bufferingPct: 'Puffern {p}%...',
      connectingStream: 'Verbinde Stream...',
      toastReturnedLive: '● Zurück zum Live-TV: ',
      toastLiveTv: '● Live-TV: ',
      toastUpcoming: 'Geplante Sendung — startet um ',
      toastFavAdded: '★ Zu Favoriten hinzugefügt: ',
      toastFavRemoved: 'Aus Favoriten entfernt: ',
      toastPaused: '⏸ Pausiert',
      toastPlaying: '▶ Wiedergabe',
      toastArchPaused: '⏸ Archiv pausiert',
      toastArchPlaying: '▶ Archiv läuft',
      toastBackExit: 'Nochmals ZURÜCK drücken zum Beenden',
      toastSavedSettings: '✓ Playlist & EPG gespeichert',
      toastLangChanged: '🌐 Sprache: Deutsch'
    },
    pl: {
      daysShort: ['Ndz', 'Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob'],
      today: 'Dzisiaj',
      yesterday: 'Wczoraj',
      searchPlaceholder: 'Szukaj (OK aby pisać)...',
      returnToLive: '● Powrót na żywo',
      soundOn: '🔊 Dźwięk wł.',
      muted: '🔇 Wyciszono',
      clickForSound: '🔇 Kliknij dla dźwięku',
      favoriteBtn: '★ Ulubione',
      usbBtn: 'Pendrive USB',
      settingsBtn: 'Lista i EPG',
      categoriesTitle: 'Kategorie',
      allChannels: 'Wszystkie kanały',
      favoritesGroup: '★ Ulubione',
      recentGroup: '↺ Ostatnie',
      searchPrefix: 'Szukaj: "',
      noChannelsMatch: 'Brak kanałów spełniających filtr.',
      liveTvStream: 'Transmisja na żywo',
      selectAChannel: 'Wybierz kanał',
      noChannelSelected: 'Nie wybrano kanału',
      noScheduleEntries: 'Brak programu TV dla tego dnia.',
      daysBackBadge: '↺ {d} dni wstecz',
      dayBackBadge: '↺ {d} dzień wstecz',
      broadcastSlot: 'Pasmo archiwum',
      hourlyFallbackDesc: 'Skok do archiwum co 1 godz. (brak danych EPG dla tego kanału)',
      pillPlaying: '▶ Odtwarzanie',
      pillReplay: '↺ Odtwórz',
      pillLive: '● NA ŻYWO',
      pillUpcoming: 'Wkrótce',
      footerHtml:
        '<span class="footer-item"><kbd>▲▼</kbd> Nawigacja</span>' +
        '<span class="footer-item"><kbd>◀▶</kbd> Kategorie / Kanały / Archiwum 3 dni</span>' +
        '<span class="footer-item"><kbd>OK</kbd> Na żywo / Odtwórz z archiwum</span>' +
        '<span class="footer-item"><kbd>▲</kbd> Pasek górny (Ulub. / USB / Język / Ustaw.)</span>' +
        '<span class="footer-item"><kbd>BACK / ESC</kbd> Pełny ekran</span>',
      osdArchiveBadge: '↺ ARCHIWUM · ',
      osdLiveBadge: '● NA ŻYWO',
      osdUpNext: 'Następnie',
      osdLiveBroadcast: 'Transmisja na żywo',
      osdCatchupFallback: 'Odtwarzanie z archiwum (3 dni)',
      osdLiveHintText: '◀ W lewo: Archiwum 3 dni · OK: Lista kanałów',
      osdArchiveControlsHtml:
        '<kbd>◀▶</kbd> Przewiń ±30s &nbsp;·&nbsp; <kbd>OK</kbd> Pauza/Start &nbsp;·&nbsp; <kbd>▲▼</kbd> Przewodnik &nbsp;·&nbsp; <kbd>BACK/ESC</kbd> Na żywo',
      osdLiveControlsHtml:
        '<kbd>OK</kbd> Przewodnik &nbsp;·&nbsp; <kbd>▲▼</kbd> Kanał &nbsp;·&nbsp; <kbd>◀</kbd> Archiwum 3 dni &nbsp;·&nbsp; <kbd>▶</kbd> Info',
      modalTitle: 'Ustawienia listy M3U i 3-dniowego EPG',
      modalSubtitleHtml:
        'Poruszaj się <strong>Strzałkami</strong>, naciśnij <strong>OK</strong> na polu tekstowym aby pisać (oraz <strong>OK / Esc</strong> po zakończeniu) lub wczytaj listę z pendrive USB.',
      lblM3uHtml: 'Adres URL listy M3U / M3U8 <small>(OK aby edytować)</small>',
      lblEpgHtml: 'Adres URL programu XMLTV EPG <small>(opcjonalny; obsługuje .xml oraz .xml.gz)</small>',
      lblCycleMode: 'Tryb Catchup (OK)',
      lblCycleDays: 'Okno archiwum (OK)',
      lblCycleOffset: 'Przesunięcie EPG (OK)',
      lblCycleLang: 'Język / Language (OK)',
      usbHelpHtml:
        '<strong>Szybki import z USB (bez pisania na pilocie):</strong> Wgraj plik <code>iptv.json</code> z ' +
        '<code>{"m3uUrl":"...","epgUrl":"..."}</code> (lub <code>playlist.m3u</code> + <code>epg.xml</code>) na pendrive FAT32, włóż do TV i wybierz <strong>Skanuj pendrive USB</strong>.',
      btnScanUsb: 'Skanuj pendrive USB',
      btnLoadLocal: 'Wczytaj plik .m3u',
      btnLoadDemo: 'Załaduj kanały Demo',
      btnCloseEsc: 'Zamknij (Esc)',
      btnSaveReload: 'Zapisz i przeładuj',
      autoTz: '0h (Auto strefa)',
      bufferingPct: 'Buforowanie {p}%...',
      connectingStream: 'Łączenie ze strumieniem...',
      toastReturnedLive: '● Powrót do TV na żywo: ',
      toastLiveTv: '● Na żywo: ',
      toastUpcoming: 'Program jeszcze się nie zaczął — emisja o ',
      toastFavAdded: '★ Dodano do ulubionych: ',
      toastFavRemoved: 'Usunięto z ulubionych: ',
      toastPaused: '⏸ Pauza',
      toastPlaying: '▶ Odtwarzanie',
      toastArchPaused: '⏸ Archiwum wstrzymane',
      toastArchPlaying: '▶ Odtwarzanie archiwum',
      toastBackExit: 'Naciśnij ponownie BACK aby wyjść z vertIPTV',
      toastSavedSettings: '✓ Zapisano ustawienia listy i EPG',
      toastLangChanged: '🌐 Język: Polski'
    }
  };

  NS.I18n = I18N;

  var dom = {};
  var state = {
    settings: null,
    favorites: new Set(),
    recents: [],
    allChannels: [],
    channelByKey: Object.create(null),
    channelsByGroup: Object.create(null),
    filterGen: 0,
    groupsRenderGen: 0,
    groupsRenderedGen: -1,
    groupsRenderedSelected: -1,
    groupsRenderedFocused: -1,
    poolFilterGen: -1,
    poolStartIdx: -1,
    poolEndIdx: -1,
    poolFocusedIdx: -1,
    poolActivePane: false,
    poolPlayingKey: '',
    dayTabsRenderedRef: null,
    dayTabsRenderedSelected: -1,
    dayTabsRenderedFocused: false,
    programsRenderedRef: null,
    programsRenderedChannelKey: '',
    programsRenderedPlayingArchive: -1,
    programsRenderedFocused: -2,
    rawGroups: [],
    displayGroups: [],
    filteredChannels: [],
    epgByBucket: Object.create(null),
    isDemoData: false,

    // Guide navigation state
    guideOpen: true,
    modalOpen: false,
    activePane: 'channels', // 'topbar' | 'groups' | 'channels' | 'programs'
    lastContentPane: 'channels',
    programSubFocus: 'list', // 'days' | 'list'

    selectedGroupIdx: 0,
    focusedGroupIdx: 0,

    focusedChannelIdx: 0,
    playingChannelKey: '',

    selectedDayOffset: 0,
    dayTabs: [],
    currentDayPrograms: [],
    focusedProgramIdx: 0,

    searchQuery: '',

    // Modal staged cycle values
    modalMode: 'auto',
    modalDays: 3,
    modalOffsetMin: 0,
    modalLang: 'en',

    // Audio mute state
    isMuted: false,
    isAutoplayBlocked: false,

    // Playback & Archive scrubbing state
    playbackMode: 'live',
    activeArchiveProgram: null,
    archivePosSec: 0,
    archiveDurSec: 0,
    pendingScrubOffsetSec: null,
    scrubTimer: null,
    scrubTapCount: 0,

    // OSD & Numpad timers
    osdVisible: false,
    osdTimer: null,
    numpadDigits: '',
    numpadTimer: null,
    toastTimer: null,
    backExitArmedAt: 0,
    previewSyncTimer: null
  };

  var player = null;

  function $(id) {
    return document.getElementById(id);
  }

  function getLang() {
    var code = state.settings && state.settings.lang;
    return I18N[code] ? code : 'en';
  }

  function t(key) {
    var dict = I18N[getLang()] || I18N.en;
    return dict[key] !== undefined ? dict[key] : I18N.en[key] || key;
  }

  function getLangOption(code) {
    for (var i = 0; i < LANG_OPTS.length; i++) {
      if (LANG_OPTS[i].value === code) return LANG_OPTS[i];
    }
    return LANG_OPTS[0];
  }

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function formatClock(epochSec) {
    var d = new Date(epochSec * 1000);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function formatClockWithSec(epochSec) {
    var d = new Date(epochSec * 1000);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }

  function formatShortDay(epochSec) {
    var days = t('daysShort');
    var d = new Date(epochSec * 1000);
    return days[d.getDay()] + ' ' + pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getMonogram(name) {
    if (!name) return 'TV';
    var clean = name.replace(/[^a-zA-Z0-9 ]/g, ' ').trim();
    var parts = clean.split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return clean.slice(0, 3).toUpperCase() || 'TV';
  }

  // Zero-jump container scrolling compatible with 2017 Chromium M47 (no scrollIntoView object options needed)
  function scrollChildIntoContainer(container, child, centerIt) {
    if (!container || !child) return;
    var cRect = container.getBoundingClientRect();
    var eRect = child.getBoundingClientRect();
    var cHeight = cRect.height || container.clientHeight || 600;
    if (centerIt) {
      var offsetInside = (eRect.top - cRect.top) + container.scrollTop;
      container.scrollTop = Math.max(0, Math.round(offsetInside - cHeight * 0.42));
      return;
    }
    if (eRect.top < cRect.top + 6) {
      container.scrollTop -= (cRect.top - eRect.top) + 10;
    } else if (eRect.bottom > cRect.bottom - 6) {
      container.scrollTop += (eRect.bottom - cRect.bottom) + 10;
    }
  }

  function showToast(msg, durationMs) {
    if (!dom.toast) return;
    dom.toast.textContent = msg;
    dom.toast.classList.remove('is-hidden');
    if (state.toastTimer) clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(function () {
      dom.toast.classList.add('is-hidden');
    }, durationMs || 2800);
  }

  function updateWallClock() {
    var nowSec = Math.floor(Date.now() / 1000);
    var txt = formatClock(nowSec);
    if (dom.wallClock) dom.wallClock.textContent = txt;
    if (dom.osdClock) dom.osdClock.textContent = txt;
  }

  function registerTizenKeys() {
    if (!global.tizen || !global.tizen.tvinputdevice) return;
    var keys = [
      'MediaPlay',
      'MediaPause',
      'MediaPlayPause',
      'MediaStop',
      'MediaRewind',
      'MediaFastForward',
      'ChannelUp',
      'ChannelDown',
      'Info',
      'Guide',
      'ColorF0Red',
      'ColorF1Green',
      'ColorF2Yellow',
      'ColorF3Blue',
      '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'
    ];
    for (var i = 0; i < keys.length; i++) {
      try {
        global.tizen.tvinputdevice.registerKey(keys[i]);
      } catch (_) {}
    }
  }

  // TV-Smart Input Locking: prevents Samsung TV IME keyboard from hijacking arrows until OK is pressed!
  function unlockTvInput(inputEl) {
    if (!inputEl) return;
    inputEl.readOnly = false;
    inputEl.classList.add('is-editing');
    inputEl.focus();
    try {
      var len = inputEl.value.length;
      inputEl.setSelectionRange(len, len);
    } catch (_) {}
  }

  function lockTvInput(inputEl) {
    if (!inputEl || !inputEl.getAttribute('data-tv-input')) return;
    inputEl.readOnly = true;
    inputEl.classList.remove('is-editing');
  }

  function lockAllTvInputs() {
    var inputs = document.querySelectorAll('[data-tv-input="1"]');
    for (var i = 0; i < inputs.length; i++) {
      lockTvInput(inputs[i]);
    }
  }

  function getProgramsForChannel(channel) {
    if (!channel) return [];
    var bucket = NS.Parser.getChannelBucketKey(channel);
    if (state.epgByBucket[bucket]) return state.epgByBucket[bucket];
    var fallbackNorm = 'norm:' + channel.normName;
    return state.epgByBucket[fallbackNorm] || [];
  }

  function getNowAndNextProgram(channel, nowSec) {
    var progs = getProgramsForChannel(channel);
    if (!progs.length) return { now: null, next: null };
    var idx = NS.Parser.findProgramIndexAt(progs, nowSec);
    if (idx !== -1) {
      return {
        now: progs[idx],
        next: idx + 1 < progs.length ? progs[idx + 1] : null
      };
    }
    return { now: null, next: null };
  }

  function indexChannelsState() {
    var byKey = Object.create(null);
    var byGroup = Object.create(null);
    var all = state.allChannels;
    for (var i = 0; i < all.length; i++) {
      var c = all[i];
      byKey[c.key] = c;
      var grpName = c.group || 'General';
      var gList = byGroup[grpName];
      if (!gList) {
        gList = [];
        byGroup[grpName] = gList;
      }
      gList.push(c);
    }
    state.channelByKey = byKey;
    state.channelsByGroup = byGroup;
    state.filterGen = (state.filterGen || 0) + 1;
  }

  function rebuildDisplayGroups() {
    var list = [
      { id: '__all__', name: t('allChannels'), count: state.allChannels.length },
      { id: '__fav__', name: t('favoritesGroup'), count: state.favorites.size },
      { id: '__recent__', name: t('recentGroup'), count: state.recents.length }
    ];
    for (var i = 0; i < state.rawGroups.length; i++) {
      var g = state.rawGroups[i];
      list.push({ id: 'grp:' + g.name, name: g.name, count: g.count });
    }
    state.displayGroups = list;
    state.groupsRenderGen = (state.groupsRenderGen || 0) + 1;
    if (state.selectedGroupIdx >= list.length) state.selectedGroupIdx = 0;
    if (state.focusedGroupIdx >= list.length) state.focusedGroupIdx = 0;
    if (dom.groupsCount) dom.groupsCount.textContent = String(state.rawGroups.length);
  }

  function applyChannelFilter(preserveChannelKey, deferProgramPreview) {
    var grp = state.displayGroups[state.selectedGroupIdx] || state.displayGroups[0];
    var q = state.searchQuery.trim().toLowerCase();
    var base = [];

    if (!grp || grp.id === '__all__') {
      base = state.allChannels;
    } else if (grp.id === '__fav__') {
      base = state.allChannels.filter(function (c) {
        return state.favorites.has(c.key) || (c.tvgId && state.favorites.has(c.tvgId));
      });
    } else if (grp.id === '__recent__') {
      for (var r = 0; r < state.recents.length; r++) {
        var rCh = state.channelByKey[state.recents[r]];
        if (rCh) base.push(rCh);
      }
    } else {
      base = (state.channelsByGroup && state.channelsByGroup[grp.name]) || [];
    }

    if (q) {
      base = base.filter(function (c) {
        var ln = c._lowerName !== undefined ? c._lowerName : (c._lowerName = (c.name || '').toLowerCase());
        var ns = c._numStr !== undefined ? c._numStr : (c._numStr = String(c.num || ''));
        return ln.indexOf(q) !== -1 || ns.indexOf(q) === 0;
      });
    }

    state.filteredChannels = base;
    state.filterGen = (state.filterGen || 0) + 1;
    if (dom.channelsHeaderTitle) {
      dom.channelsHeaderTitle.textContent = q ? t('searchPrefix') + state.searchQuery + '"' : (grp ? grp.name : t('allChannels'));
    }
    if (dom.channelsCount) {
      dom.channelsCount.textContent = String(base.length);
    }

    var targetKey = preserveChannelKey || state.playingChannelKey;
    var nextIdx = 0;
    if (targetKey) {
      for (var k = 0; k < base.length; k++) {
        if (base[k].key === targetKey) {
          nextIdx = k;
          break;
        }
      }
    }
    state.focusedChannelIdx = base.length ? Math.min(nextIdx, base.length - 1) : 0;

    if (dom.channelsSpacer) {
      dom.channelsSpacer.style.height = base.length * ROW_HEIGHT + 'px';
    }
    scrollChannelIntoView(state.focusedChannelIdx, true);
    renderChannelsVirtual(true);
    if (deferProgramPreview) {
      scheduleProgramPanePreview();
    } else {
      refreshProgramsForHighlightedChannel(false);
    }
  }

  function renderGroups(forceFull) {
    if (!dom.groupsList) return;
    var effFocused = state.activePane === 'groups' ? state.focusedGroupIdx : -1;

    if (
      !forceFull &&
      state.groupsRenderedGen === state.groupsRenderGen &&
      state.groupsRenderedSelected === state.selectedGroupIdx &&
      state.groupsRenderedFocused === effFocused
    ) {
      return;
    }

    if (
      !forceFull &&
      state.groupsRenderedGen === state.groupsRenderGen &&
      dom.groupsList.children &&
      dom.groupsList.children.length === state.displayGroups.length
    ) {
      var rows = dom.groupsList.children;
      for (var r = 0; r < rows.length; r++) {
        var rCls = 'group-row';
        if (r === state.selectedGroupIdx) rCls += ' is-selected';
        if (r === effFocused) rCls += ' is-focused';
        rows[r].className = rCls;
        rows[r].setAttribute('aria-selected', String(r === state.selectedGroupIdx));
      }
      state.groupsRenderedSelected = state.selectedGroupIdx;
      state.groupsRenderedFocused = effFocused;
      if (effFocused >= 0 && rows[effFocused]) {
        scrollChildIntoContainer(dom.groupsList, rows[effFocused], false);
      }
      return;
    }

    var html = '';
    for (var i = 0; i < state.displayGroups.length; i++) {
      var g = state.displayGroups[i];
      var cls = 'group-row';
      if (i === state.selectedGroupIdx) cls += ' is-selected';
      if (i === effFocused) cls += ' is-focused';
      html +=
        '<div class="' + cls + '" role="option" data-group-idx="' + i + '" aria-selected="' + (i === state.selectedGroupIdx) + '">' +
        '<span class="group-name">' + escapeHtml(g.name) + '</span>' +
        '<span class="group-badge">' + g.count + '</span>' +
        '</div>';
    }
    dom.groupsList.innerHTML = html;
    state.groupsRenderedGen = state.groupsRenderGen;
    state.groupsRenderedSelected = state.selectedGroupIdx;
    state.groupsRenderedFocused = effFocused;

    if (state.activePane === 'groups') {
      var activeNode = dom.groupsList.querySelector('[data-group-idx="' + state.focusedGroupIdx + '"]');
      scrollChildIntoContainer(dom.groupsList, activeNode, false);
    }
  }

  function scrollChannelIntoView(idx, instant) {
    var vp = dom.channelsViewport;
    if (!vp || !state.filteredChannels.length) return;
    var top = idx * ROW_HEIGHT;
    var bottom = top + ROW_HEIGHT;
    var viewTop = vp.scrollTop;
    var viewH = vp.clientHeight || 680;

    if (top < viewTop) {
      vp.scrollTop = top;
    } else if (bottom > viewTop + viewH) {
      vp.scrollTop = bottom - viewH;
    } else if (instant && Math.abs(top - viewTop) > viewH * 2) {
      vp.scrollTop = Math.max(0, top - Math.round(viewH * 0.35));
    }
  }

  function isChannelFav(ch) {
    return state.favorites.has(ch.key) || (ch.tvgId && state.favorites.has(ch.tvgId));
  }

  function renderChannelsVirtual(forceFull) {
    var vp = dom.channelsViewport;
    var pool = dom.channelsPool;
    if (!vp || !pool) return;

    var total = state.filteredChannels.length;
    if (!total) {
      state.poolFilterGen = state.filterGen;
      state.poolStartIdx = 0;
      state.poolEndIdx = 0;
      pool.style.webkitTransform = 'translate3d(0,0,0)';
      pool.style.transform = 'translate3d(0,0,0)';
      pool.innerHTML = '<div style="padding:20px;color:#94a3b8;font-size:15px;">' + escapeHtml(t('noChannelsMatch')) + '</div>';
      return;
    }

    var scrollTop = vp.scrollTop;
    var viewH = vp.clientHeight || 720;
    var rawFirst = Math.floor(scrollTop / ROW_HEIGHT);
    var startIdx = Math.max(0, Math.floor((rawFirst - 4) / 6) * 6);
    var visibleCount = Math.ceil(viewH / ROW_HEIGHT) + 16;
    var endIdx = Math.min(total, startIdx + visibleCount);
    var isPaneCh = state.activePane === 'channels';

    // Fast path 1: Exact same virtual window & focus state (e.g. duplicate scroll event after keydown)
    if (
      !forceFull &&
      state.poolFilterGen === state.filterGen &&
      state.poolStartIdx === startIdx &&
      state.poolEndIdx === endIdx &&
      state.poolFocusedIdx === state.focusedChannelIdx &&
      state.poolActivePane === isPaneCh &&
      state.poolPlayingKey === state.playingChannelKey
    ) {
      return;
    }

    // Fast path 2: Same virtual window [startIdx, endIdx), only focus/playing highlight changed -> update classes in-place without destroying <img> logos!
    if (
      !forceFull &&
      state.poolFilterGen === state.filterGen &&
      state.poolStartIdx === startIdx &&
      state.poolEndIdx === endIdx &&
      pool.children &&
      pool.children.length === endIdx - startIdx
    ) {
      var children = pool.children;
      for (var cIdx = 0; cIdx < children.length; cIdx++) {
        var itemIdx = startIdx + cIdx;
        var rowCh = state.filteredChannels[itemIdx];
        var rowFocused = isPaneCh && itemIdx === state.focusedChannelIdx;
        var rowSelected = itemIdx === state.focusedChannelIdx;
        var rowPlaying = rowCh && rowCh.key === state.playingChannelKey;
        var rowCls = 'ch-row';
        if (rowPlaying) rowCls += ' is-playing';
        if (rowSelected && !rowFocused) rowCls += ' is-selected';
        if (rowFocused) rowCls += ' is-focused';
        children[cIdx].className = rowCls;
        children[cIdx].setAttribute('aria-selected', String(rowSelected));
      }
      state.poolFocusedIdx = state.focusedChannelIdx;
      state.poolActivePane = isPaneCh;
      state.poolPlayingKey = state.playingChannelKey;
      return;
    }

    var translateVal = 'translate3d(0,' + startIdx * ROW_HEIGHT + 'px,0)';
    pool.style.webkitTransform = translateVal;
    pool.style.transform = translateVal;

    var nowSec = Math.floor(Date.now() / 1000);
    var html = '';

    for (var i = startIdx; i < endIdx; i++) {
      var ch = state.filteredChannels[i];
      var isFocused = isPaneCh && i === state.focusedChannelIdx;
      var isSelected = i === state.focusedChannelIdx;
      var isPlaying = ch.key === state.playingChannelKey;

      var cls = 'ch-row';
      if (isPlaying) cls += ' is-playing';
      if (isSelected && !isFocused) cls += ' is-selected';
      if (isFocused) cls += ' is-focused';

      var sched = getNowAndNextProgram(ch, nowSec);
      var nowTitle = sched.now ? sched.now.t : t('liveTvStream');
      var pct = 0;
      if (sched.now && sched.now.e > sched.now.s) {
        pct = Math.max(2, Math.min(100, Math.round(((nowSec - sched.now.s) / (sched.now.e - sched.now.s)) * 100)));
      }

      var cDays = NS.Catchup.getChannelCatchupDays(ch, state.settings);
      var favStar = isChannelFav(ch) ? '<span class="ch-fav" aria-label="Favorite">★</span>' : '';
      var catchupBadge = cDays > 0 ? '<span class="ch-catchup-tag">↺ ' + cDays + 'd</span>' : '';

      var logoHtml = ch.logo
        ? '<img class="ch-logo-img" src="' + escapeHtml(ch.logo) + '" alt="" width="48" height="36" loading="lazy" fetchpriority="low" decoding="async" onerror="this.style.display=\'none\';this.parentNode.textContent=\'' + escapeHtml(getMonogram(ch.name)) + '\';">'
        : escapeHtml(getMonogram(ch.name));

      html +=
        '<div class="' + cls + '" role="option" data-ch-idx="' + i + '" aria-selected="' + isSelected + '">' +
        '<span class="ch-num">' + ch.num + '</span>' +
        '<div class="ch-logo-box">' + logoHtml + '</div>' +
        '<div class="ch-info">' +
        '<div class="ch-title-line">' +
        favStar +
        '<span class="ch-name">' + escapeHtml(ch.name) + '</span>' +
        catchupBadge +
        '</div>' +
        '<div class="ch-now-prog">' + escapeHtml(nowTitle) + '</div>' +
        (pct > 0 ? '<div class="ch-mini-bar"><div class="ch-mini-bar-fill" style="width:' + pct + '%"></div></div>' : '') +
        '</div>' +
        '</div>';
    }

    pool.innerHTML = html;
    state.poolFilterGen = state.filterGen;
    state.poolStartIdx = startIdx;
    state.poolEndIdx = endIdx;
    state.poolFocusedIdx = state.focusedChannelIdx;
    state.poolActivePane = isPaneCh;
    state.poolPlayingKey = state.playingChannelKey;
  }

  function buildDayTabsForChannel(channel) {
    var daysBack = Math.min(3, NS.Catchup.getChannelCatchupDays(channel, state.settings));
    var now = new Date();
    var nowSec = Math.floor(now.getTime() / 1000);
    var todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    var todayStartSec = Math.floor(todayMidnight.getTime() / 1000);

    var tabs = [];
    for (var d = 0; d <= daysBack; d++) {
      var startSec = todayStartSec - d * 86400;
      var endSec = d === 0 ? Math.max(startSec + 86400, nowSec + 86400) : startSec + 86400;
      var label = d === 0 ? t('today') : d === 1 ? t('yesterday') : formatShortDay(startSec);
      tabs.push({
        offset: d,
        label: label,
        startSec: startSec,
        endSec: endSec
      });
    }
    state.dayTabs = tabs;
    if (state.selectedDayOffset >= tabs.length) {
      state.selectedDayOffset = 0;
    }
  }

  function computeDayPrograms(channel, dayTab) {
    if (!channel || !dayTab) return [];
    var all = getProgramsForChannel(channel);
    var nowSec = Math.floor(Date.now() / 1000);

    var matched = [];
    for (var i = 0; i < all.length; i++) {
      var p = all[i];
      if (p.e > dayTab.startSec && p.s < dayTab.endSec) {
        matched.push(p);
      }
    }

    if (!matched.length) {
      var limitSec = dayTab.offset === 0 ? Math.min(dayTab.endSec, nowSec + 3600) : dayTab.endSec;
      for (var slotSec = dayTab.startSec; slotSec < limitSec; slotSec += 3600) {
        matched.push({
          s: slotSec,
          e: slotSec + 3600,
          t: formatClock(slotSec) + ' – ' + formatClock(slotSec + 3600) + ' ' + t('broadcastSlot'),
          d: t('hourlyFallbackDesc'),
          isHourlyFallback: true
        });
      }
    }
    return matched;
  }

  function refreshProgramsForHighlightedChannel(preferPreviousShow) {
    var ch = state.filteredChannels[state.focusedChannelIdx];
    if (!ch) {
      state.currentDayPrograms = [];
      if (dom.programsChannelTitle) dom.programsChannelTitle.textContent = t('noChannelSelected');
      if (dom.dayTabs) dom.dayTabs.innerHTML = '';
      if (dom.programsList) dom.programsList.innerHTML = '';
      return;
    }

    if (dom.programsChannelTitle) {
      dom.programsChannelTitle.textContent = ch.num + '. ' + ch.name;
    }

    buildDayTabsForChannel(ch);
    var activeTab = state.dayTabs[state.selectedDayOffset] || state.dayTabs[0];
    var progs = computeDayPrograms(ch, activeTab);
    state.currentDayPrograms = progs;

    var nowSec = Math.floor(Date.now() / 1000);
    if (activeTab && activeTab.offset === 0) {
      var liveIdx = -1;
      for (var i = 0; i < progs.length; i++) {
        if (nowSec >= progs[i].s && nowSec < progs[i].e) {
          liveIdx = i;
          break;
        }
      }
      if (liveIdx === -1 && progs.length) {
        liveIdx = Math.max(0, progs.length - 1);
      }
      if (preferPreviousShow && liveIdx > 0) {
        state.focusedProgramIdx = liveIdx - 1;
      } else {
        state.focusedProgramIdx = Math.max(0, liveIdx);
      }
    } else if (progs.length) {
      var dNow = new Date();
      var approxTarget = activeTab.startSec + dNow.getHours() * 3600 + dNow.getMinutes() * 60;
      var bestIdx = 0;
      var bestDiff = Infinity;
      for (var j = 0; j < progs.length; j++) {
        var diff = Math.abs(progs[j].s - approxTarget);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestIdx = j;
        }
      }
      state.focusedProgramIdx = bestIdx;
    } else {
      state.focusedProgramIdx = 0;
    }

    renderDayTabs();
    renderProgramsList(true);
  }

  function renderDayTabs(forceFull) {
    if (!dom.dayTabs) return;
    var isDaysFocused = state.activePane === 'programs' && state.programSubFocus === 'days';
    if (
      !forceFull &&
      state.dayTabsRenderedRef === state.dayTabs &&
      state.dayTabsRenderedSelected === state.selectedDayOffset &&
      state.dayTabsRenderedFocused === isDaysFocused
    ) {
      return;
    }

    var html = '';
    for (var i = 0; i < state.dayTabs.length; i++) {
      var tab = state.dayTabs[i];
      var cls = 'day-tab';
      if (i === state.selectedDayOffset) cls += ' is-active';
      if (isDaysFocused && i === state.selectedDayOffset) {
        cls += ' is-focused';
      }
      html +=
        '<button type="button" class="' + cls + '" role="tab" data-day-idx="' + i + '" aria-selected="' + (i === state.selectedDayOffset) + '">' +
        escapeHtml(tab.label) +
        '</button>';
    }
    dom.dayTabs.innerHTML = html;
    state.dayTabsRenderedRef = state.dayTabs;
    state.dayTabsRenderedSelected = state.selectedDayOffset;
    state.dayTabsRenderedFocused = isDaysFocused;
  }

  function renderProgramsList(centerFocused, forceFull) {
    if (!dom.programsList) return;
    var progs = state.currentDayPrograms;
    if (!progs.length) {
      state.programsRenderedRef = progs;
      state.programsRenderedFocused = -1;
      dom.programsList.innerHTML = '<div style="padding:18px;color:#94a3b8;">' + escapeHtml(t('noScheduleEntries')) + '</div>';
      return;
    }

    var ch = state.filteredChannels[state.focusedChannelIdx];
    var chKey = ch ? ch.key : '';
    var archiveStart =
      state.playbackMode === 'archive' &&
      ch &&
      ch.key === state.playingChannelKey &&
      state.activeArchiveProgram
        ? state.activeArchiveProgram.s
        : -1;
    var effProgFocus =
      state.activePane === 'programs' && state.programSubFocus === 'list' ? state.focusedProgramIdx : -1;

    // Fast path 1: Same program list, channel, archive state, and focus index
    if (
      !forceFull &&
      state.programsRenderedRef === progs &&
      state.programsRenderedChannelKey === chKey &&
      state.programsRenderedPlayingArchive === archiveStart &&
      state.programsRenderedFocused === effProgFocus
    ) {
      if (centerFocused) {
        var existingTarget = dom.programsList.querySelector('[data-prog-idx="' + state.focusedProgramIdx + '"]');
        scrollChildIntoContainer(dom.programsList, existingTarget, true);
      }
      return;
    }

    // Fast path 2: Same program list, only focus index changed -> update classes in-place
    if (
      !forceFull &&
      state.programsRenderedRef === progs &&
      state.programsRenderedChannelKey === chKey &&
      state.programsRenderedPlayingArchive === archiveStart &&
      dom.programsList.children &&
      dom.programsList.children.length === progs.length
    ) {
      var nowFast = Math.floor(Date.now() / 1000);
      var pRows = dom.programsList.children;
      for (var k = 0; k < pRows.length; k++) {
        var pk = progs[k];
        var kLive = nowFast >= pk.s && nowFast < pk.e;
        var kFuture = pk.s > nowFast;
        var kFocused = k === effProgFocus;
        var kArch = archiveStart !== -1 && archiveStart === pk.s;
        var kCls = 'prog-item';
        if (k >= 10 && Math.abs(k - state.focusedProgramIdx) > 8) kCls += ' prog-item--deferred';
        if (kLive) kCls += ' is-live';
        if (kFuture) kCls += ' is-future';
        if (kArch) kCls += ' is-playing-archive';
        if (kFocused) kCls += ' is-focused';
        pRows[k].className = kCls;
        pRows[k].setAttribute('aria-selected', String(kFocused));
      }
      state.programsRenderedFocused = effProgFocus;
      var fastTarget = pRows[state.focusedProgramIdx] || dom.programsList.querySelector('[data-prog-idx="' + state.focusedProgramIdx + '"]');
      scrollChildIntoContainer(dom.programsList, fastTarget, !!centerFocused);
      return;
    }

    var nowSec = Math.floor(Date.now() / 1000);
    var html = '';

    for (var i = 0; i < progs.length; i++) {
      var p = progs[i];
      var isLive = nowSec >= p.s && nowSec < p.e;
      var isPast = p.e <= nowSec;
      var isFuture = p.s > nowSec;
      var isFocused = i === effProgFocus;
      var isPlayingThisArchive = archiveStart !== -1 && archiveStart === p.s;

      var cls = 'prog-item';
      if (i >= 10 && Math.abs(i - state.focusedProgramIdx) > 8) cls += ' prog-item--deferred';
      if (isLive) cls += ' is-live';
      if (isFuture) cls += ' is-future';
      if (isPlayingThisArchive) cls += ' is-playing-archive';
      if (isFocused) cls += ' is-focused';

      var pillHtml = '';
      if (isPlayingThisArchive) {
        pillHtml = '<span class="prog-pill prog-pill--replay">' + escapeHtml(t('pillPlaying')) + '</span>';
      } else if (isPast) {
        pillHtml = '<span class="prog-pill prog-pill--replay">' + escapeHtml(t('pillReplay')) + '</span>';
      } else if (isLive) {
        pillHtml = '<span class="prog-pill prog-pill--live">' + escapeHtml(t('pillLive')) + '</span>';
      } else {
        pillHtml = '<span class="prog-pill prog-pill--upcoming">' + escapeHtml(t('pillUpcoming')) + '</span>';
      }

      html +=
        '<div class="' + cls + '" role="option" data-prog-idx="' + i + '" aria-selected="' + isFocused + '">' +
        '<div class="prog-time">' + formatClock(p.s) + ' – ' + formatClock(p.e) + '</div>' +
        '<div class="prog-body">' +
        '<div class="prog-title">' + escapeHtml(p.t) + '</div>' +
        (p.d ? '<div class="prog-desc">' + escapeHtml(p.d) + '</div>' : '') +
        '</div>' +
        pillHtml +
        '</div>';
    }

    dom.programsList.innerHTML = html;
    state.programsRenderedRef = progs;
    state.programsRenderedChannelKey = chKey;
    state.programsRenderedPlayingArchive = archiveStart;
    state.programsRenderedFocused = effProgFocus;

    var target = dom.programsList.querySelector('[data-prog-idx="' + state.focusedProgramIdx + '"]');
    scrollChildIntoContainer(dom.programsList, target, !!centerFocused);
  }

  function updatePaneBorders() {
    if (dom.paneGroups) dom.paneGroups.classList.toggle('is-pane-active', state.activePane === 'groups');
    if (dom.paneChannels) dom.paneChannels.classList.toggle('is-pane-active', state.activePane === 'channels');
    if (dom.panePrograms) dom.panePrograms.classList.toggle('is-pane-active', state.activePane === 'programs');

    if (state.activePane !== 'topbar') {
      lockAllTvInputs();
      if (document.activeElement && dom.guideTopbar && dom.guideTopbar.contains(document.activeElement)) {
        document.activeElement.blur();
      }
    }
  }

  function setActivePane(pane) {
    if (pane !== 'topbar') state.lastContentPane = pane;
    state.activePane = pane;
    updatePaneBorders();
    renderGroups();
    renderChannelsVirtual();
    renderDayTabs();
    renderProgramsList(false);

    if (pane === 'topbar' && dom.guideTopbar) {
      var startBtn = !dom.btnLiveNow.classList.contains('is-hidden') ? dom.btnLiveNow : dom.btnFavToggle;
      NS.SpatialNav.updateRovingTabindex(dom.guideTopbar, startBtn || dom.searchInput, '.top-control');
    }
  }

  function getChannelByKey(key) {
    if (!key) return null;
    if (state.channelByKey && state.channelByKey[key]) return state.channelByKey[key];
    for (var i = 0; i < state.allChannels.length; i++) {
      if (state.allChannels[i].key === key) return state.allChannels[i];
    }
    return null;
  }

  function syncReturnToLiveButton() {
    if (!dom.btnLiveNow) return;
    dom.btnLiveNow.classList.toggle('is-hidden', state.playbackMode !== 'archive');
  }

  function tuneLiveChannel(channel, closeDrawerAfter) {
    if (!channel) return;
    state.playingChannelKey = channel.key;
    state.playbackMode = 'live';
    state.activeArchiveProgram = null;
    state.pendingScrubOffsetSec = null;

    NS.Storage.setLastChannel(channel.key);
    state.recents = NS.Storage.pushRecent(channel.key);
    rebuildDisplayGroups();

    syncReturnToLiveButton();
    player.playLive(channel, state.settings);

    renderGroups();
    renderChannelsVirtual();
    renderProgramsList(false);

    if (closeDrawerAfter) {
      setGuideOpen(false);
    }
    showOsd(4200);
  }

  function startArchivePlayback(channel, program, initialOffsetSec) {
    if (!channel || !program) return;
    var nowSec = Math.floor(Date.now() / 1000);
    if (program.s > nowSec) {
      showToast(t('toastUpcoming') + formatClock(program.s));
      return;
    }

    // Selecting the currently airing (newest / live) show in the guide tunes Live TV instead of restarting from 00:00
    if (nowSec >= program.s && nowSec < program.e) {
      if (channel.key === state.playingChannelKey && state.playbackMode === 'live') {
        setGuideOpen(false);
        showOsd(4200);
      } else {
        tuneLiveChannel(channel, true);
        showToast(t('toastLiveTv') + program.t);
      }
      return;
    }

    state.playingChannelKey = channel.key;
    state.playbackMode = 'archive';
    state.activeArchiveProgram = program;
    state.archivePosSec = initialOffsetSec || 0;
    state.archiveDurSec = Math.max(60, program.e - program.s);
    state.pendingScrubOffsetSec = null;

    NS.Storage.setLastChannel(channel.key);
    state.recents = NS.Storage.pushRecent(channel.key);
    rebuildDisplayGroups();
    syncReturnToLiveButton();

    player.playArchive(channel, program, initialOffsetSec || 0, state.settings);

    setGuideOpen(false);
    showOsd(5500);
    showToast(t('pillReplay') + ': ' + program.t + ' (' + formatShortDay(program.s) + ' ' + formatClock(program.s) + ')');
  }

  function returnToLive() {
    var ch = getChannelByKey(state.playingChannelKey) || state.filteredChannels[state.focusedChannelIdx] || state.allChannels[0];
    if (!ch) return;
    tuneLiveChannel(ch, true);
    showToast(t('toastReturnedLive') + ch.name);
  }

  function setGuideOpen(open) {
    state.guideOpen = open;
    if (dom.guideDrawer) {
      dom.guideDrawer.classList.toggle('is-hidden', !open);
    }
    if (open) {
      hideOsd();
      if (state.playingChannelKey) {
        for (var i = 0; i < state.filteredChannels.length; i++) {
          if (state.filteredChannels[i].key === state.playingChannelKey) {
            state.focusedChannelIdx = i;
            break;
          }
        }
      }
      scrollChannelIntoView(state.focusedChannelIdx, true);
      renderGroups();
      renderChannelsVirtual();
      refreshProgramsForHighlightedChannel(false);
      updatePaneBorders();
    } else {
      lockAllTvInputs();
    }
  }

  function updateOsdContent() {
    var ch = getChannelByKey(state.playingChannelKey) || state.filteredChannels[state.focusedChannelIdx];
    if (!ch) return;

    if (dom.osdChNum) dom.osdChNum.textContent = String(ch.num);
    if (dom.osdChName) dom.osdChName.textContent = ch.name;

    var nowSec = Math.floor(Date.now() / 1000);

    if (state.playbackMode === 'archive' && state.activeArchiveProgram) {
      var p = state.activeArchiveProgram;
      var dur = Math.max(60, p.e - p.s);
      var pos = state.pendingScrubOffsetSec !== null ? state.pendingScrubOffsetSec : state.archivePosSec;
      pos = Math.max(0, Math.min(dur, pos));
      var pct = Math.max(0, Math.min(100, (pos / dur) * 100));

      if (dom.osdModeBadge) {
        dom.osdModeBadge.className = 'mode-badge mode-badge--archive';
        dom.osdModeBadge.textContent = t('osdArchiveBadge') + formatShortDay(p.s);
      }
      if (dom.osdProgTitle) {
        var scrubSuffix = state.pendingScrubOffsetSec !== null ? '  [Seek -> ' + formatClockWithSec(p.s + pos) + ']' : '';
        dom.osdProgTitle.textContent = p.t + scrubSuffix;
      }
      if (dom.osdTimeStart) dom.osdTimeStart.textContent = formatClockWithSec(p.s + pos);
      if (dom.osdTimeEnd) dom.osdTimeEnd.textContent = formatClock(p.e);
      if (dom.osdProgressFill) dom.osdProgressFill.style.width = pct.toFixed(1) + '%';
      if (dom.osdNextInfo) dom.osdNextInfo.textContent = p.d || t('osdCatchupFallback');
      if (dom.osdControlsHint) {
        dom.osdControlsHint.innerHTML = t('osdArchiveControlsHtml');
      }
    } else {
      var sched = getNowAndNextProgram(ch, nowSec);
      if (dom.osdModeBadge) {
        dom.osdModeBadge.className = 'mode-badge mode-badge--live';
        dom.osdModeBadge.textContent = t('osdLiveBadge');
      }
      if (sched.now) {
        var lDur = Math.max(60, sched.now.e - sched.now.s);
        var lPct = Math.max(0, Math.min(100, ((nowSec - sched.now.s) / lDur) * 100));
        if (dom.osdProgTitle) dom.osdProgTitle.textContent = sched.now.t;
        if (dom.osdTimeStart) dom.osdTimeStart.textContent = formatClock(sched.now.s);
        if (dom.osdTimeEnd) dom.osdTimeEnd.textContent = formatClock(sched.now.e);
        if (dom.osdProgressFill) dom.osdProgressFill.style.width = lPct.toFixed(1) + '%';
        if (dom.osdNextInfo) {
          dom.osdNextInfo.textContent = sched.next
            ? t('osdUpNext') + ' (' + formatClock(sched.next.s) + '): ' + sched.next.t
            : (sched.now.d || t('osdLiveHintText'));
        }
      } else {
        if (dom.osdProgTitle) dom.osdProgTitle.textContent = t('osdLiveBroadcast');
        if (dom.osdTimeStart) dom.osdTimeStart.textContent = '--:--';
        if (dom.osdTimeEnd) dom.osdTimeEnd.textContent = '--:--';
        if (dom.osdProgressFill) dom.osdProgressFill.style.width = '100%';
        if (dom.osdNextInfo) dom.osdNextInfo.textContent = t('osdLiveHintText');
      }
      if (dom.osdControlsHint) {
        dom.osdControlsHint.innerHTML = t('osdLiveControlsHtml');
      }
    }
  }

  function showOsd(timeoutMs) {
    if (state.guideOpen || state.modalOpen) return;
    state.osdVisible = true;
    updateOsdContent();
    if (dom.osdBar) dom.osdBar.classList.remove('is-hidden');
    if (state.osdTimer) clearTimeout(state.osdTimer);
    state.osdTimer = setTimeout(function () {
      if (state.pendingScrubOffsetSec === null) hideOsd();
    }, timeoutMs || 4200);
  }

  function hideOsd() {
    state.osdVisible = false;
    if (state.osdTimer) {
      clearTimeout(state.osdTimer);
      state.osdTimer = null;
    }
    if (dom.osdBar) dom.osdBar.classList.add('is-hidden');
  }

  function zapChannel(delta) {
    var list = state.filteredChannels.length ? state.filteredChannels : state.allChannels;
    if (!list.length) return;
    var curIdx = 0;
    for (var i = 0; i < list.length; i++) {
      if (list[i].key === state.playingChannelKey) {
        curIdx = i;
        break;
      }
    }
    var nextIdx = (curIdx + delta + list.length) % list.length;
    state.focusedChannelIdx = nextIdx;
    tuneLiveChannel(list[nextIdx], false);
  }

  function scrubArchiveBy(deltaDirection) {
    if (state.playbackMode !== 'archive' || !state.activeArchiveProgram) return;
    state.scrubTapCount++;
    var stepSec = state.scrubTapCount > 4 ? 90 : 30;
    var base = state.pendingScrubOffsetSec !== null ? state.pendingScrubOffsetSec : player.getCurrentArchiveOffsetSec();
    var dur = Math.max(60, state.activeArchiveProgram.e - state.activeArchiveProgram.s);
    var nextOffset = Math.max(0, Math.min(dur - 10, base + deltaDirection * stepSec));

    state.pendingScrubOffsetSec = nextOffset;
    showOsd(5000);

    if (state.scrubTimer) clearTimeout(state.scrubTimer);
    state.scrubTimer = setTimeout(function () {
      var commitOffset = state.pendingScrubOffsetSec;
      state.pendingScrubOffsetSec = null;
      state.scrubTapCount = 0;
      if (commitOffset !== null) {
        state.archivePosSec = commitOffset;
        player.seekArchiveToOffset(commitOffset);
      }
    }, 450);
  }

  function toggleFavoriteOnHighlighted() {
    var ch = state.filteredChannels[state.focusedChannelIdx] || getChannelByKey(state.playingChannelKey);
    if (!ch) return;
    if (state.favorites.has(ch.key)) {
      state.favorites.delete(ch.key);
      showToast(t('toastFavRemoved') + ch.name);
    } else {
      state.favorites.add(ch.key);
      showToast(t('toastFavAdded') + ch.name);
    }
    NS.Storage.saveFavorites(state.favorites);
    rebuildDisplayGroups();
    renderGroups();
    renderChannelsVirtual(true);
  }

  function handleNumberKey(digit) {
    if (digit === '0' && !state.numpadDigits && !state.guideOpen && state.playbackMode === 'archive') {
      returnToLive();
      return;
    }
    state.numpadDigits += digit;
    if (state.numpadDigits.length > 4) state.numpadDigits = state.numpadDigits.slice(-4);

    if (dom.numpadBadge) {
      dom.numpadBadge.textContent = 'CH ' + state.numpadDigits;
      dom.numpadBadge.classList.remove('is-hidden');
    }

    if (state.numpadTimer) clearTimeout(state.numpadTimer);
    state.numpadTimer = setTimeout(commitNumpadChannel, 1150);
  }

  function commitNumpadChannel() {
    if (state.numpadTimer) {
      clearTimeout(state.numpadTimer);
      state.numpadTimer = null;
    }
    var targetNum = Number(state.numpadDigits);
    state.numpadDigits = '';
    if (dom.numpadBadge) dom.numpadBadge.classList.add('is-hidden');
    if (!targetNum) return;

    var found = null;
    for (var i = 0; i < state.allChannels.length; i++) {
      if (state.allChannels[i].num === targetNum) {
        found = state.allChannels[i];
        break;
      }
    }
    if (!found && targetNum >= 1 && targetNum <= state.allChannels.length) {
      found = state.allChannels[targetNum - 1];
    }
    if (found) {
      tuneLiveChannel(found, true);
    } else {
      showToast('Channel ' + targetNum + ' not found');
    }
  }

  function updateMuteButtonText() {
    if (!dom.btnMuteToggle) return;
    var isMuted = !!state.isMuted;
    dom.btnMuteToggle.classList.toggle('is-muted', isMuted);
    dom.btnMuteToggle.classList.toggle('btn-live', isMuted);
    dom.btnMuteToggle.setAttribute('aria-pressed', isMuted ? 'true' : 'false');
    dom.btnMuteToggle.setAttribute('aria-label', isMuted ? t('muted') : t('soundOn'));
  }

  function applyLanguage() {
    var code = getLang();
    var langOpt = getLangOption(code);
    if (document.documentElement) {
      document.documentElement.setAttribute('lang', code);
    }
    if (dom.searchInput) dom.searchInput.placeholder = t('searchPlaceholder');
    if (dom.btnLiveNow) dom.btnLiveNow.textContent = t('returnToLive');
    updateMuteButtonText();
    if (dom.btnFavToggle) dom.btnFavToggle.textContent = t('favoriteBtn');
    if (dom.btnUsbImport) dom.btnUsbImport.textContent = t('usbBtn');
    if (dom.btnLangToggle) dom.btnLangToggle.textContent = langOpt.shortLabel;
    if (dom.btnOpenSettings) dom.btnOpenSettings.textContent = t('settingsBtn');
    if (dom.groupsHeaderTitle) dom.groupsHeaderTitle.textContent = t('categoriesTitle');
    if (dom.programsCatchupHint) dom.programsCatchupHint.textContent = t('daysBackBadge').replace('{d}', '3');
    if (dom.guideFooter) dom.guideFooter.innerHTML = t('footerHtml');

    if (dom.settingsTitle) dom.settingsTitle.textContent = t('modalTitle');
    if (dom.settingsSubtitle) dom.settingsSubtitle.innerHTML = t('modalSubtitleHtml');
    if (dom.lblM3u) dom.lblM3u.innerHTML = t('lblM3uHtml');
    if (dom.lblEpg) dom.lblEpg.innerHTML = t('lblEpgHtml');
    if (dom.lblCycleMode) dom.lblCycleMode.textContent = t('lblCycleMode');
    if (dom.lblCycleOffset) dom.lblCycleOffset.textContent = t('lblCycleOffset');
    if (dom.lblCycleLang) dom.lblCycleLang.textContent = t('lblCycleLang');
    if (dom.usbHelpText) dom.usbHelpText.innerHTML = t('usbHelpHtml');
    if (dom.btnModalUsb) dom.btnModalUsb.textContent = t('btnScanUsb');
    if (dom.btnModalLocalfile) dom.btnModalLocalfile.textContent = t('btnLoadLocal');
    if (dom.btnModalDemo) dom.btnModalDemo.textContent = t('btnLoadDemo');
    if (dom.btnModalCancel) dom.btnModalCancel.textContent = t('btnCloseEsc');
    if (dom.btnModalSave) dom.btnModalSave.textContent = t('btnSaveReload');

    renderModalCycleButtons();
    if (state.allChannels.length) {
      rebuildDisplayGroups();
      renderGroups(true);
      applyChannelFilter(state.filteredChannels[state.focusedChannelIdx] ? state.filteredChannels[state.focusedChannelIdx].key : '', false);
    }
    if (state.osdVisible) {
      updateOsdContent();
    }
  }

  function cycleLanguage() {
    var cur = getLang();
    var idx = 0;
    for (var i = 0; i < LANG_OPTS.length; i++) {
      if (LANG_OPTS[i].value === cur) idx = i;
    }
    var nextLang = LANG_OPTS[(idx + 1) % LANG_OPTS.length].value;
    state.settings = NS.Storage.saveSettings({ lang: nextLang });
    state.modalLang = nextLang;
    applyLanguage();
    if (!state.guideOpen && !state.modalOpen) {
      showToast(t('toastLangChanged'), 1600);
    }
  }

  // Modal Cycle Buttons Rendering
  function renderModalCycleButtons() {
    var modeObj = CATCHUP_MODES[0];
    for (var i = 0; i < CATCHUP_MODES.length; i++) {
      if (CATCHUP_MODES[i].value === state.modalMode) modeObj = CATCHUP_MODES[i];
    }
    if (dom.btnCycleMode) dom.btnCycleMode.textContent = '▸ ' + modeObj.label;
    var offHr = state.modalOffsetMin / 60;
    var offLabel = offHr === 0 ? t('autoTz') : (offHr > 0 ? '+' + offHr + 'h' : offHr + 'h');
    if (dom.btnCycleOffset) dom.btnCycleOffset.textContent = '▸ ' + offLabel;
    var mLangOpt = getLangOption(state.modalLang || getLang());
    if (dom.btnCycleLang) dom.btnCycleLang.textContent = '▸ ' + mLangOpt.shortLabel + ' · ' + mLangOpt.label;
  }

  function openSettingsModal() {
    state.modalOpen = true;
    hideOsd();
    lockAllTvInputs();

    dom.inpM3u.value = state.settings.m3uUrl || '';
    dom.inpEpg.value = state.settings.epgUrl || '';
    state.modalMode = state.settings.catchupMode || 'auto';
    state.modalOffsetMin = Number(state.settings.epgOffsetMin) || 0;
    state.modalLang = getLang();
    renderModalCycleButtons();

    if (dom.remotePushHint) {
      if (global.location && /^https?:/.test(global.location.protocol)) {
        dom.remotePushHint.textContent = 'Phone URL paste: ' + global.location.origin + '/remote';
      } else {
        dom.remotePushHint.textContent = 'Pendrive auto-load: place iptv.json on USB stick';
      }
    }

    dom.settingsModal.classList.remove('is-hidden');
    NS.SpatialNav.updateRovingTabindex(dom.settingsCard, dom.inpM3u, '.modal-control');
  }

  function closeSettingsModal() {
    lockAllTvInputs();
    state.modalOpen = false;
    dom.settingsModal.classList.add('is-hidden');
    if (state.guideOpen) {
      setActivePane(state.lastContentPane || 'channels');
    }
  }

  function applyBundleToState(bundle, badgeLabel, isDemo) {
    state.allChannels = bundle.channels || [];
    state.rawGroups = bundle.groups || [];
    state.epgByBucket = bundle.epgByBucket || Object.create(null);
    state.isDemoData = !!isDemo;
    indexChannelsState();

    if (dom.playlistBadge) dom.playlistBadge.textContent = badgeLabel;

    rebuildDisplayGroups();
    var savedLast = NS.Storage.getLastChannel();
    applyChannelFilter(savedLast);
    renderGroups();

    var initialChannel = getChannelByKey(savedLast) || state.filteredChannels[0] || state.allChannels[0];
    if (initialChannel && !state.playingChannelKey) {
      tuneLiveChannel(initialChannel, false);
    }
  }

  function persistActiveSnapshot(sourceLabel, epgUrl) {
    NS.Storage.saveSnapshot('active_playlist', {
      m3uUrl: state.settings.m3uUrl || '',
      epgUrl: epgUrl || state.settings.epgUrl || '',
      sourceLabel: sourceLabel || '',
      channels: state.allChannels,
      groups: state.rawGroups,
      epgByBucket: state.epgByBucket,
      savedAt: Date.now()
    });
  }

  function syncSettingsToCompanionServer(cfg) {
    if (!global.location || !/^https?:/.test(global.location.protocol)) return;
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/remote-config', true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.send(JSON.stringify(cfg));
    } catch (_) {}
  }

  function loadAndHydrateEpg(epgUrl, channels) {
    if (!epgUrl) {
      if (dom.epgSyncPill) dom.epgSyncPill.textContent = 'Hourly 3d Replay Ready';
      persistActiveSnapshot('', '');
      return Promise.resolve();
    }
    if (dom.epgSyncPill) dom.epgSyncPill.textContent = 'Syncing 3d EPG...';

    return NS.Parser.fetchTextSmart(epgUrl, state.settings.useCorsProxy)
      .then(function (xmlText) {
        return NS.Parser.parseXMLTVAsync(
          xmlText,
          channels,
          state.settings.catchupDays,
          state.settings.epgOffsetMin
        );
      })
      .then(function (epgRes) {
        state.epgByBucket = epgRes.epgByBucket;
        if (dom.epgSyncPill) {
          dom.epgSyncPill.textContent = 'EPG: ' + epgRes.matchedChannels + ' ch (' + epgRes.totalPrograms + ' shows)';
        }
        renderChannelsVirtual(true);
        refreshProgramsForHighlightedChannel(false);
        persistActiveSnapshot('', epgUrl);
      })
      .catch(function (err) {
        if (dom.epgSyncPill) dom.epgSyncPill.textContent = 'EPG failed (Hourly Replay active)';
        persistActiveSnapshot('', epgUrl);
        showToast('EPG note: ' + (err && err.message ? err.message : 'unavailable') + ' — hourly 3d slots active');
      });
  }

  function loadFromRawM3uText(m3uText, sourceLabel, explicitEpgText, explicitEpgUrl) {
    if (dom.epgSyncPill) dom.epgSyncPill.textContent = 'Parsing M3U...';
    return NS.Parser.parseM3UAsync(m3uText, state.settings.catchupDays).then(function (parsed) {
      if (!parsed.channels.length) {
        showToast('No playable channels found in M3U');
        return;
      }
      state.playingChannelKey = '';
      applyBundleToState(
        {
          channels: parsed.channels,
          groups: parsed.groups,
          epgByBucket: Object.create(null)
        },
        sourceLabel + ' (' + parsed.channels.length + ' ch)',
        false
      );
      persistActiveSnapshot(sourceLabel, explicitEpgUrl || state.settings.epgUrl || '');

      if (explicitEpgText) {
        if (dom.epgSyncPill) dom.epgSyncPill.textContent = 'Parsing USB EPG...';
        return NS.Parser.parseXMLTVAsync(
          explicitEpgText,
          parsed.channels,
          state.settings.catchupDays,
          state.settings.epgOffsetMin
        ).then(function (epgRes) {
          state.epgByBucket = epgRes.epgByBucket;
          if (dom.epgSyncPill) dom.epgSyncPill.textContent = 'EPG: ' + epgRes.matchedChannels + ' ch';
          renderChannelsVirtual(true);
          refreshProgramsForHighlightedChannel(false);
          persistActiveSnapshot(sourceLabel, '');
        });
      }

      var targetEpgUrl = explicitEpgUrl || state.settings.epgUrl || (parsed.headerEpgUrls && parsed.headerEpgUrls[0]) || '';
      if (targetEpgUrl && !state.settings.epgUrl) {
        state.settings = NS.Storage.saveSettings({ epgUrl: targetEpgUrl });
      }
      return loadAndHydrateEpg(targetEpgUrl, parsed.channels);
    });
  }

  function loadConfiguredUrls(forceNetwork) {
    var m3uUrl = (state.settings.m3uUrl || '').trim();
    if (!m3uUrl) {
      if (!forceNetwork) {
        return NS.Storage.loadSnapshot('active_playlist').then(function (snap) {
          if (snap && snap.channels && snap.channels.length) {
            applyBundleToState(snap, snap.sourceLabel || ('Saved (' + snap.channels.length + ' ch)'), false);
            if (dom.epgSyncPill) dom.epgSyncPill.textContent = 'Restored Saved Playlist';
            return;
          }
          var demo = NS.DemoData.buildDemoBundle();
          applyBundleToState(demo, 'Demo Mode (5 ch)', true);
          if (dom.epgSyncPill) dom.epgSyncPill.textContent = '3-Day Demo EPG Active';
        });
      }
      var demoNow = NS.DemoData.buildDemoBundle();
      applyBundleToState(demoNow, 'Demo Mode (5 ch)', true);
      if (dom.epgSyncPill) dom.epgSyncPill.textContent = '3-Day Demo EPG Active';
      return Promise.resolve();
    }

    var cacheChain = forceNetwork ? Promise.resolve(null) : NS.Storage.loadSnapshot('active_playlist');

    return cacheChain.then(function (cached) {
      if (cached && cached.m3uUrl === m3uUrl && cached.channels && cached.channels.length) {
        applyBundleToState(cached, 'Cached (' + cached.channels.length + ' ch)', false);
        if (dom.epgSyncPill) dom.epgSyncPill.textContent = 'Instant Cache · Refreshing...';
      } else {
        if (dom.epgSyncPill) dom.epgSyncPill.textContent = 'Downloading M3U...';
      }

      return NS.Parser.fetchTextSmart(m3uUrl, state.settings.useCorsProxy)
        .then(function (m3uText) {
          return NS.Parser.parseM3UAsync(m3uText, state.settings.catchupDays);
        })
        .then(function (parsed) {
          if (!parsed.channels.length) {
            throw new Error('Playlist returned 0 channels');
          }
          var hadCached = !!(cached && cached.channels && cached.channels.length);
          state.allChannels = parsed.channels;
          state.rawGroups = parsed.groups;
          state.isDemoData = false;
          indexChannelsState();
          if (dom.playlistBadge) dom.playlistBadge.textContent = parsed.channels.length + ' Channels';

          rebuildDisplayGroups();
          applyChannelFilter(state.playingChannelKey || NS.Storage.getLastChannel());
          renderGroups();

          if (!hadCached && !state.playingChannelKey && state.filteredChannels[0]) {
            tuneLiveChannel(state.filteredChannels[0], false);
          }

          var resolvedEpg = (state.settings.epgUrl || '').trim() || (parsed.headerEpgUrls && parsed.headerEpgUrls[0]) || '';
          return loadAndHydrateEpg(resolvedEpg, parsed.channels);
        })
        .catch(function (err) {
          showToast('M3U fetch error: ' + (err && err.message ? err.message : String(err)), 4200);
          if (!state.allChannels.length) {
            var demoFallback = NS.DemoData.buildDemoBundle();
            applyBundleToState(demoFallback, 'Demo Fallback', true);
          }
        });
    });
  }

  function handleUsbImport(silentIfNone) {
    NS.UsbLoader.scanUsbPendrive().then(function (res) {
      if (!res.available) {
        if (!silentIfNone && dom.filePickerM3u) dom.filePickerM3u.click();
        return;
      }
      if (!res.found) {
        if (!silentIfNone) showToast(res.reason || 'No iptv.json or .m3u found on USB pendrive', 3800);
        return;
      }

      if (res.config && res.config.m3uUrl) {
        var usbCfg = {
          m3uUrl: res.config.m3uUrl,
          epgUrl: res.config.epgUrl || state.settings.epgUrl || '',
          catchupDays: res.config.catchupDays || state.settings.catchupDays,
          catchupMode: res.config.catchupMode || state.settings.catchupMode
        };
        state.settings = NS.Storage.saveSettings(usbCfg);
        syncSettingsToCompanionServer(usbCfg);
        showToast('Imported URLs from USB (' + res.label + ')!');
        if (state.modalOpen) closeSettingsModal();
        loadConfiguredUrls(true);
        return;
      }

      if (res.m3uText) {
        showToast('Loaded ' + res.m3uName + ' from USB (' + res.label + ')!');
        if (state.modalOpen) closeSettingsModal();
        loadFromRawM3uText(res.m3uText, 'USB: ' + res.m3uName, res.epgText, '');
      }
    });
  }

  function scheduleProgramPanePreview() {
    if (state.previewSyncTimer) clearTimeout(state.previewSyncTimer);
    state.previewSyncTimer = setTimeout(function () {
      refreshProgramsForHighlightedChannel(false);
    }, 55);
  }

  function isActivelyEditingInput(el) {
    if (!el || !el.tagName) return false;
    var tag = el.tagName.toUpperCase();
    return (tag === 'INPUT' || tag === 'TEXTAREA') && !el.readOnly;
  }

  function handleKeyDown(e) {
    var code = e.keyCode || e.which || 0;
    var key = e.key || '';
    var target = e.target;
    var editingInput = isActivelyEditingInput(target);

    // Samsung Tizen 3.0 (2017 M47) + modern keyCode & key normalization:
    // 10009 = Return/Back, 65385 = IME Cancel, 65376 = IME Done, 27 = Esc
    var isBack =
      code === 10009 ||
      code === 65385 ||
      key === 'Escape' ||
      code === 27 ||
      ((key === 'Backspace' || code === 8) && !editingInput);
    var isEnter = key === 'Enter' || code === 13 || code === 65376;
    var isUp = key === 'ArrowUp' || code === 38;
    var isDown = key === 'ArrowDown' || code === 40;
    var isLeft = key === 'ArrowLeft' || code === 37;
    var isRight = key === 'ArrowRight' || code === 39;
    var isChUp = key === 'ChannelUp' || key === 'PageUp' || code === 427 || code === 33;
    var isChDown = key === 'ChannelDown' || key === 'PageDown' || code === 428 || code === 34;
    var isPlayPause =
      key === 'MediaPlayPause' || key === 'MediaPlay' || key === 'MediaPause' ||
      code === 10252 || code === 415 || code === 19 ||
      ((key === ' ' || code === 32) && !editingInput && target.tagName !== 'BUTTON');
    var isRewind = key === 'MediaRewind' || code === 412;
    var isFastForward = key === 'MediaFastForward' || code === 417;
    var isRedFav = key === 'ColorF0Red' || code === 403 || ((key === 'f' || key === 'F' || code === 70) && !editingInput);
    var isGreenCatchup = key === 'ColorF1Green' || code === 404 || key === 'Guide' || code === 458 || ((key === 'g' || key === 'G' || code === 71) && !editingInput);
    var isYellowLang = key === 'ColorF2Yellow' || code === 405 || ((key === 'l' || key === 'L' || code === 76) && !editingInput);
    var isBlueSettings = key === 'ColorF3Blue' || code === 406 || ((key === 's' || key === 'S' || code === 83) && !editingInput);
    var isInfo = key === 'Info' || code === 457 || ((key === 'i' || key === 'I' || code === 73) && !editingInput);
    var isMuteKey = !editingInput && (key === 'm' || key === 'M' || code === 77 || key === 'AudioVolumeMute' || code === 449);
    var isAudioTrackKey = !editingInput && (key === 'a' || key === 'A' || code === 65);

    // Handle TV-Smart Input toggle (OK unlocks input for typing; OK / Back / Up / Down locks it back!)
    if (target && target.getAttribute && target.getAttribute('data-tv-input') === '1') {
      if (target.readOnly) {
        if (isEnter) {
          e.preventDefault();
          unlockTvInput(target);
          return;
        }
      } else {
        if (isEnter || isBack) {
          e.preventDefault();
          lockTvInput(target);
          return;
        }
        if (isUp || isDown) {
          lockTvInput(target);
          // Fall through so Up/Down moves to adjacent control!
        } else {
          return; // Let typing keys & Left/Right work natively inside unlocked text field
        }
      }
    }

    // 1. Settings Modal Open
    if (state.modalOpen) {
      if (isBack) {
        e.preventDefault();
        closeSettingsModal();
      }
      return;
    }

    if (isMuteKey) {
      e.preventDefault();
      var nowMuted = player.toggleMute();
      showToast(nowMuted ? t('muted') : t('soundOn'), 1500);
      return;
    }

    if (isAudioTrackKey) {
      e.preventDefault();
      var trackLabel = player.cycleAudioTrack();
      showToast(trackLabel ? '🔊 Audio Track: ' + trackLabel : 'Single audio track on this stream', 2000);
      return;
    }

    if (isYellowLang) {
      e.preventDefault();
      cycleLanguage();
      return;
    }

    if (isBlueSettings) {
      e.preventDefault();
      openSettingsModal();
      return;
    }

    if (isRedFav) {
      e.preventDefault();
      toggleFavoriteOnHighlighted();
      return;
    }

    if (isPlayPause) {
      e.preventDefault();
      var paused = player.togglePause();
      showToast(paused ? t('toastPaused') : t('toastPlaying'), 1400);
      showOsd(3500);
      return;
    }

    // Numeric keys 0-9 (supports both modern `e.key` and Tizen 3.0 `keyCode` 48..57)
    var digitChar = '';
    if (/^[0-9]$/.test(key)) {
      digitChar = key;
    } else if (code >= 48 && code <= 57) {
      digitChar = String(code - 48);
    }
    if (!editingInput && digitChar) {
      e.preventDefault();
      handleNumberKey(digitChar);
      return;
    }

    // 2. Fullscreen TV Mode (Pure OK / Esc / Arrows Steering!)
    if (!state.guideOpen) {
      if (state.numpadDigits && isEnter) {
        e.preventDefault();
        commitNumpadChannel();
        return;
      }

      if (state.playbackMode === 'archive') {
        if (isLeft || isRewind) {
          e.preventDefault();
          scrubArchiveBy(-1);
          return;
        }
        if (isRight || isFastForward) {
          e.preventDefault();
          scrubArchiveBy(1);
          return;
        }
        if (isEnter) {
          e.preventDefault();
          var pState = player.togglePause();
          showToast(pState ? t('toastArchPaused') : t('toastArchPlaying'), 1400);
          showOsd(4500);
          return;
        }
        if (isUp || isDown || isChUp || isChDown || isGreenCatchup) {
          e.preventDefault();
          setGuideOpen(true);
          setActivePane('programs');
          return;
        }
        if (isBack) {
          e.preventDefault();
          if (state.osdVisible) {
            hideOsd();
          } else {
            returnToLive();
          }
          return;
        }
      }

      // Live TV Fullscreen Steering:
      // OK = Open Guide (1 press!) | Up/Down = Zap Channel | Left = 3-Day Replay | Right = Info OSD | Back = Hide OSD / Exit
      if (isUp || isChUp) {
        e.preventDefault();
        zapChannel(-1);
        return;
      }
      if (isDown || isChDown) {
        e.preventDefault();
        zapChannel(1);
        return;
      }
      if (isLeft || isGreenCatchup) {
        e.preventDefault();
        state.selectedDayOffset = 0;
        setGuideOpen(true);
        refreshProgramsForHighlightedChannel(true);
        state.programSubFocus = 'list';
        setActivePane('programs');
        return;
      }
      if (isRight || isInfo) {
        e.preventDefault();
        if (state.osdVisible) hideOsd();
        else showOsd(5000);
        return;
      }
      if (isEnter) {
        e.preventDefault();
        setGuideOpen(true);
        setActivePane('channels');
        return;
      }
      if (isBack) {
        e.preventDefault();
        if (state.osdVisible) {
          hideOsd();
          return;
        }
        var nowMs = Date.now();
        if (nowMs - state.backExitArmedAt < 2500) {
          if (global.tizen && global.tizen.application) {
            try {
              global.tizen.application.getCurrentApplication().exit();
            } catch (_) {}
          }
        } else {
          state.backExitArmedAt = nowMs;
          showToast(t('toastBackExit'), 2200);
        }
      }
      return;
    }

    // 3. Guide Drawer Open (Pure Arrows + OK + Esc)
    if (isBack) {
      e.preventDefault();
      setGuideOpen(false);
      return;
    }

    // Topbar active
    if (state.activePane === 'topbar') {
      if (isDown) {
        e.preventDefault();
        lockAllTvInputs();
        if (document.activeElement) document.activeElement.blur();
        setActivePane(state.lastContentPane || 'channels');
      }
      return;
    }

    // Column 1: Categories / Groups
    if (state.activePane === 'groups') {
      if (isUp) {
        e.preventDefault();
        if (state.focusedGroupIdx === 0) {
          setActivePane('topbar');
        } else {
          state.focusedGroupIdx--;
          state.selectedGroupIdx = state.focusedGroupIdx;
          applyChannelFilter('', true);
          renderGroups();
        }
      } else if (isDown) {
        e.preventDefault();
        if (state.focusedGroupIdx < state.displayGroups.length - 1) {
          state.focusedGroupIdx++;
          state.selectedGroupIdx = state.focusedGroupIdx;
          applyChannelFilter('', true);
          renderGroups();
        }
      } else if (isRight || isEnter) {
        e.preventDefault();
        state.selectedGroupIdx = state.focusedGroupIdx;
        applyChannelFilter('', false);
        setActivePane('channels');
      }
      return;
    }

    // Column 2: Virtualized Channels
    if (state.activePane === 'channels') {
      var chLen = state.filteredChannels.length;
      if (isUp) {
        e.preventDefault();
        if (state.focusedChannelIdx <= 0) {
          setActivePane('topbar');
        } else {
          state.focusedChannelIdx--;
          scrollChannelIntoView(state.focusedChannelIdx, false);
          renderChannelsVirtual();
          scheduleProgramPanePreview();
        }
      } else if (isDown) {
        e.preventDefault();
        if (state.focusedChannelIdx < chLen - 1) {
          state.focusedChannelIdx++;
          scrollChannelIntoView(state.focusedChannelIdx, false);
          renderChannelsVirtual();
          scheduleProgramPanePreview();
        }
      } else if (isChUp) {
        e.preventDefault();
        state.focusedChannelIdx = Math.max(0, state.focusedChannelIdx - 10);
        scrollChannelIntoView(state.focusedChannelIdx, true);
        renderChannelsVirtual();
        scheduleProgramPanePreview();
      } else if (isChDown) {
        e.preventDefault();
        state.focusedChannelIdx = Math.min(Math.max(0, chLen - 1), state.focusedChannelIdx + 10);
        scrollChannelIntoView(state.focusedChannelIdx, true);
        renderChannelsVirtual();
        scheduleProgramPanePreview();
      } else if (isLeft) {
        e.preventDefault();
        state.focusedGroupIdx = state.selectedGroupIdx;
        setActivePane('groups');
      } else if (isRight || isGreenCatchup) {
        e.preventDefault();
        state.programSubFocus = 'list';
        refreshProgramsForHighlightedChannel(false);
        setActivePane('programs');
      } else if (isEnter) {
        e.preventDefault();
        var targetCh = state.filteredChannels[state.focusedChannelIdx];
        if (!targetCh) return;
        if (targetCh.key === state.playingChannelKey && state.playbackMode === 'live') {
          setGuideOpen(false);
        } else {
          tuneLiveChannel(targetCh, true);
        }
      }
      return;
    }

    // Column 3: 3-Day Catchup Programs
    if (state.activePane === 'programs') {
      if (state.programSubFocus === 'days') {
        if (isLeft) {
          e.preventDefault();
          if (state.selectedDayOffset === 0) {
            setActivePane('channels');
          } else {
            state.selectedDayOffset--;
            refreshProgramsForHighlightedChannel(false);
          }
        } else if (isRight) {
          e.preventDefault();
          if (state.selectedDayOffset < state.dayTabs.length - 1) {
            state.selectedDayOffset++;
            refreshProgramsForHighlightedChannel(false);
          }
        } else if (isDown || isEnter) {
          e.preventDefault();
          state.programSubFocus = 'list';
          renderDayTabs();
          renderProgramsList(true);
        } else if (isUp) {
          e.preventDefault();
          setActivePane('topbar');
        }
        return;
      }

      var pLen = state.currentDayPrograms.length;
      if (isUp) {
        e.preventDefault();
        if (state.focusedProgramIdx <= 0) {
          state.programSubFocus = 'days';
          renderDayTabs();
          renderProgramsList(false);
        } else {
          state.focusedProgramIdx--;
          renderProgramsList(false);
        }
      } else if (isDown) {
        e.preventDefault();
        if (state.focusedProgramIdx < pLen - 1) {
          state.focusedProgramIdx++;
          renderProgramsList(false);
        }
      } else if (isChUp) {
        e.preventDefault();
        state.focusedProgramIdx = Math.max(0, state.focusedProgramIdx - 6);
        renderProgramsList(true);
      } else if (isChDown) {
        e.preventDefault();
        state.focusedProgramIdx = Math.min(Math.max(0, pLen - 1), state.focusedProgramIdx + 6);
        renderProgramsList(true);
      } else if (isLeft) {
        e.preventDefault();
        if (state.selectedDayOffset > 0) {
          state.selectedDayOffset--;
          refreshProgramsForHighlightedChannel(false);
        } else {
          setActivePane('channels');
        }
      } else if (isRight) {
        e.preventDefault();
        if (state.selectedDayOffset < state.dayTabs.length - 1) {
          state.selectedDayOffset++;
          refreshProgramsForHighlightedChannel(false);
        }
      } else if (isEnter) {
        e.preventDefault();
        var selCh = state.filteredChannels[state.focusedChannelIdx];
        var selProg = state.currentDayPrograms[state.focusedProgramIdx];
        if (!selCh || !selProg) return;
        startArchivePlayback(selCh, selProg, 0);
      }
    }
  }

  function checkCompanionRemoteConfig() {
    if (!global.location || !/^https?:/.test(global.location.protocol)) return;
    NS.Parser.fetchTextSmart('/api/remote-config', false)
      .then(function (raw) {
        var data = JSON.parse(raw);
        if (
          data &&
          data.m3uUrl &&
          (data.m3uUrl !== state.settings.m3uUrl || (data.epgUrl && data.epgUrl !== state.settings.epgUrl))
        ) {
          state.settings = NS.Storage.saveSettings({
            m3uUrl: data.m3uUrl,
            epgUrl: data.epgUrl || state.settings.epgUrl,
            catchupDays: data.catchupDays || state.settings.catchupDays,
            catchupMode: data.catchupMode || state.settings.catchupMode
          });
          showToast('Synced saved playlist & EPG!');
          loadConfiguredUrls(true);
        }
      })
      .catch(function () {});
  }

  function readLocalFileText(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(String(reader.result || ''));
      };
      reader.onerror = function () {
        reject(reader.error || new Error('File read error'));
      };
      reader.readAsText(file, 'UTF-8');
    });
  }

  function bindDomAndEvents() {
    dom.avPlayer = $('av-player');
    dom.html5Player = $('html5-player');
    dom.streamStatus = $('stream-status');
    dom.streamStatusText = $('stream-status-text');
    dom.numpadBadge = $('numpad-badge');
    dom.toast = $('toast');

    dom.guideDrawer = $('guide-drawer');
    dom.guideTopbar = $('guide-topbar');
    dom.playlistBadge = $('playlist-badge');
    dom.searchInput = $('search-input');
    dom.btnLiveNow = $('btn-live-now');
    dom.btnMuteToggle = $('btn-mute-toggle');
    dom.btnFavToggle = $('btn-fav-toggle');
    dom.btnUsbImport = $('btn-usb-import');
    dom.btnLangToggle = $('btn-lang-toggle');
    dom.btnOpenSettings = $('btn-open-settings');
    dom.epgSyncPill = $('epg-sync-pill');
    dom.wallClock = $('wall-clock');

    dom.paneGroups = $('pane-groups');
    dom.groupsHeaderTitle = $('groups-header-title');
    dom.groupsCount = $('groups-count');
    dom.groupsList = $('groups-list');

    dom.paneChannels = $('pane-channels');
    dom.channelsHeaderTitle = $('channels-header-title');
    dom.channelsCount = $('channels-count');
    dom.channelsViewport = $('channels-viewport');
    dom.channelsSpacer = $('channels-spacer');
    dom.channelsPool = $('channels-pool');

    dom.panePrograms = $('pane-programs');
    dom.programsChannelTitle = $('programs-channel-title');
    dom.programsCatchupHint = $('programs-catchup-hint');
    dom.dayTabs = $('day-tabs');
    dom.programsList = $('programs-list');
    dom.guideFooter = $('guide-footer');

    dom.osdBar = $('osd-bar');
    dom.osdChNum = $('osd-ch-num');
    dom.osdChName = $('osd-ch-name');
    dom.osdModeBadge = $('osd-mode-badge');
    dom.osdProgTitle = $('osd-prog-title');
    dom.osdClock = $('osd-clock');
    dom.osdTimeStart = $('osd-time-start');
    dom.osdTimeEnd = $('osd-time-end');
    dom.osdProgressFill = $('osd-progress-fill');
    dom.osdNextInfo = $('osd-next-info');
    dom.osdControlsHint = $('osd-controls-hint');

    dom.settingsModal = $('settings-modal');
    dom.settingsCard = $('settings-card');
    dom.settingsTitle = $('settings-title');
    dom.settingsSubtitle = $('settings-subtitle');
    dom.lblM3u = $('lbl-m3u');
    dom.lblEpg = $('lbl-epg');
    dom.lblCycleMode = $('lbl-cycle-mode');
    dom.lblCycleOffset = $('lbl-cycle-offset');
    dom.lblCycleLang = $('lbl-cycle-lang');
    dom.usbHelpText = $('usb-help-text');
    dom.inpM3u = $('inp-m3u');
    dom.inpEpg = $('inp-epg');
    dom.btnCycleMode = $('btn-cycle-mode');
    dom.btnCycleOffset = $('btn-cycle-offset');
    dom.btnCycleLang = $('btn-cycle-lang');
    dom.btnModalUsb = $('btn-modal-usb');
    dom.btnModalLocalfile = $('btn-modal-localfile');
    dom.btnModalDemo = $('btn-modal-demo');
    dom.filePickerM3u = $('file-picker-m3u');
    dom.btnModalCancel = $('btn-modal-cancel');
    dom.btnModalSave = $('btn-modal-save');
    dom.remotePushHint = $('remote-push-hint');

    NS.SpatialNav.attachSpatialContainer(dom.guideTopbar, '.top-control');
    NS.SpatialNav.attachSpatialContainer(dom.settingsCard, '.modal-control');

    // Unlock TV-smart inputs on mouse click too so desktop browser typing feels effortless
    var tvInputs = document.querySelectorAll('[data-tv-input="1"]');
    for (var ti = 0; ti < tvInputs.length; ti++) {
      (function (inp) {
        inp.addEventListener('click', function () {
          unlockTvInput(inp);
        });
        inp.addEventListener('blur', function () {
          lockTvInput(inp);
        });
      })(tvInputs[ti]);
    }

    // Virtual scroll handler (rAF throttled, boolean false for M47 compatibility)
    var scrollTick = false;
    dom.channelsViewport.addEventListener(
      'scroll',
      function () {
        if (scrollTick) return;
        scrollTick = true;
        requestAnimationFrame(function () {
          scrollTick = false;
          renderChannelsVirtual();
        });
      },
      false
    );

    var searchTimer = null;
    dom.searchInput.addEventListener('input', function () {
      var val = dom.searchInput.value;
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        state.searchQuery = val;
        applyChannelFilter('');
      }, 120);
    });

    dom.groupsList.addEventListener('click', function (e) {
      var row = e.target.closest('[data-group-idx]');
      if (!row) return;
      var idx = Number(row.getAttribute('data-group-idx'));
      state.focusedGroupIdx = idx;
      state.selectedGroupIdx = idx;
      applyChannelFilter('');
      setActivePane('channels');
    });

    dom.channelsPool.addEventListener('click', function (e) {
      var row = e.target.closest('[data-ch-idx]');
      if (!row) return;
      var idx = Number(row.getAttribute('data-ch-idx'));
      var ch = state.filteredChannels[idx];
      if (!ch) return;
      if (state.focusedChannelIdx === idx && ch.key === state.playingChannelKey && state.playbackMode === 'live') {
        setGuideOpen(false);
        return;
      }
      state.focusedChannelIdx = idx;
      setActivePane('channels');
      refreshProgramsForHighlightedChannel(false);
      tuneLiveChannel(ch, false);
    });

    dom.dayTabs.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-day-idx]');
      if (!btn) return;
      state.selectedDayOffset = Number(btn.getAttribute('data-day-idx'));
      state.programSubFocus = 'list';
      setActivePane('programs');
      refreshProgramsForHighlightedChannel(false);
    });

    dom.programsList.addEventListener('click', function (e) {
      var item = e.target.closest('[data-prog-idx]');
      if (!item) return;
      var idx = Number(item.getAttribute('data-prog-idx'));
      state.focusedProgramIdx = idx;
      state.programSubFocus = 'list';
      setActivePane('programs');
      var selCh = state.filteredChannels[state.focusedChannelIdx];
      var selProg = state.currentDayPrograms[idx];
      if (selCh && selProg) startArchivePlayback(selCh, selProg, 0);
    });

    $('video-stage').addEventListener('click', function () {
      if (!state.guideOpen && !state.modalOpen) {
        setGuideOpen(true);
      }
    });

    dom.btnLiveNow.addEventListener('click', returnToLive);
    dom.btnMuteToggle.addEventListener('click', function () {
      var nowMuted = player.toggleMute();
      showToast(nowMuted ? t('muted') : t('soundOn'), 1500);
    });
    dom.btnFavToggle.addEventListener('click', toggleFavoriteOnHighlighted);
    dom.btnUsbImport.addEventListener('click', function () {
      handleUsbImport(false);
    });
    if (dom.btnLangToggle) {
      dom.btnLangToggle.addEventListener('click', cycleLanguage);
    }
    dom.btnOpenSettings.addEventListener('click', openSettingsModal);

    // Cycle buttons inside Settings Modal
    dom.btnCycleMode.addEventListener('click', function () {
      var cur = 0;
      for (var i = 0; i < CATCHUP_MODES.length; i++) {
        if (CATCHUP_MODES[i].value === state.modalMode) cur = i;
      }
      state.modalMode = CATCHUP_MODES[(cur + 1) % CATCHUP_MODES.length].value;
      renderModalCycleButtons();
    });

    dom.btnCycleOffset.addEventListener('click', function () {
      var idx = EPG_OFFSET_OPTS.indexOf(state.modalOffsetMin);
      state.modalOffsetMin = EPG_OFFSET_OPTS[(idx + 1) % EPG_OFFSET_OPTS.length];
      renderModalCycleButtons();
    });

    if (dom.btnCycleLang) {
      dom.btnCycleLang.addEventListener('click', function () {
        cycleLanguage();
      });
    }

    dom.btnModalCancel.addEventListener('click', closeSettingsModal);
    dom.btnModalUsb.addEventListener('click', function () {
      handleUsbImport(false);
    });
    dom.btnModalLocalfile.addEventListener('click', function () {
      dom.filePickerM3u.click();
    });
    dom.filePickerM3u.addEventListener('change', function () {
      var file = dom.filePickerM3u.files && dom.filePickerM3u.files[0];
      if (!file) return;
      readLocalFileText(file).then(function (txt) {
        if (/^\s*\{/.test(txt)) {
          try {
            var j = JSON.parse(txt);
            if (j.m3uUrl) {
              dom.inpM3u.value = j.m3uUrl;
              if (j.epgUrl) dom.inpEpg.value = j.epgUrl;
              showToast('Loaded iptv.json into form — press Save & Reload');
              return;
            }
          } catch (_) {}
        }
        closeSettingsModal();
        loadFromRawM3uText(txt, 'File: ' + file.name, '', '');
      });
    });

    dom.btnModalDemo.addEventListener('click', function () {
      state.settings = NS.Storage.saveSettings({ m3uUrl: '', epgUrl: '' });
      NS.Storage.clearSnapshots();
      syncSettingsToCompanionServer({ m3uUrl: '', epgUrl: '', catchupMode: 'auto', catchupDays: 3 });
      state.playingChannelKey = '';
      closeSettingsModal();
      loadConfiguredUrls(true);
      showToast('Loaded 5-channel Demo with 3-Day Catchup!');
    });

    dom.btnModalSave.addEventListener('click', function () {
      var nextCfg = {
        m3uUrl: dom.inpM3u.value.trim(),
        epgUrl: dom.inpEpg.value.trim(),
        catchupMode: state.modalMode,
        catchupDays: 3,
        epgOffsetMin: state.modalOffsetMin,
        lang: state.modalLang || getLang()
      };
      state.settings = NS.Storage.saveSettings(nextCfg);
      syncSettingsToCompanionServer(nextCfg);
      state.playingChannelKey = '';
      closeSettingsModal();
      applyLanguage();
      showToast(t('toastSavedSettings'));
      loadConfiguredUrls(true);
    });

    // Auto-persist pasted M3U/EPG inputs on change so closing modal early never loses typed URLs
    [dom.inpM3u, dom.inpEpg].forEach(function (inp) {
      inp.addEventListener('change', function () {
        var mVal = dom.inpM3u.value.trim();
        var eVal = dom.inpEpg.value.trim();
        if (mVal || eVal) {
          state.settings = NS.Storage.saveSettings({
            m3uUrl: mVal || state.settings.m3uUrl,
            epgUrl: eVal || state.settings.epgUrl
          });
          syncSettingsToCompanionServer(state.settings);
        }
      });
    });

    document.addEventListener('keydown', handleKeyDown, false);
  }

  function init() {
    registerTizenKeys();
    bindDomAndEvents();

    state.settings = NS.Storage.loadSettings();
    state.favorites = NS.Storage.loadFavorites();
    state.recents = NS.Storage.loadRecents();
    applyLanguage();

    player = NS.Player.createPlayer({
      avElement: dom.avPlayer,
      videoElement: dom.html5Player,
      onState: function (st, pct) {
        if (!dom.streamStatus) return;
        if (st === 'buffering') {
          dom.streamStatusText.textContent = pct
            ? t('bufferingPct').replace('{p}', String(pct))
            : t('connectingStream');
          dom.streamStatus.classList.remove('is-hidden');
        } else {
          dom.streamStatus.classList.add('is-hidden');
        }
      },
      onTime: function (info) {
        if (info.mode === 'archive') {
          state.archivePosSec = info.positionSec;
          state.archiveDurSec = info.durationSec;
          if (state.osdVisible && state.pendingScrubOffsetSec === null) {
            updateOsdContent();
          }
        }
      },
      onError: function (msg) {
        showToast(msg, 4000);
      },
      onMuteChange: function (m) {
        state.isMuted = !!m.muted;
        state.isAutoplayBlocked = !!m.autoplayBlocked;
        updateMuteButtonText();
      }
    });

    updateWallClock();
    setInterval(function () {
      updateWallClock();
    }, 15000);

    setActivePane('channels');

    // Recover from Tizen wgt-private or IndexedDB if Smart Hub ever cleared localStorage!
    NS.Storage.loadSettingsGuaranteed().then(function (guaranteedSettings) {
      state.settings = guaranteedSettings;
      state.favorites = NS.Storage.loadFavorites();
      applyLanguage();
      return loadConfiguredUrls(false);
    }).then(function () {
      if (!state.settings.m3uUrl && NS.UsbLoader.hasTizenFs()) {
        handleUsbImport(true);
      }
      checkCompanionRemoteConfig();
    });

    if (global.location && /^https?:/.test(global.location.protocol)) {
      setInterval(checkCompanionRemoteConfig, 8000);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, false);
  } else {
    init();
  }
})(window);
