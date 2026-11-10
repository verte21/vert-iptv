(function (global) {
  'use strict';

  var NS = (global.vertIPTV = global.vertIPTV || {});

  function createPlayer(opts) {
    var avObj = opts.avElement;
    var videoEl = opts.videoElement;
    var onState = opts.onState || function () {};
    var onTime = opts.onTime || function () {};
    var onError = opts.onError || function () {};
    var onMuteChange = opts.onMuteChange || function () {};

    var loadToken = 0;
    var tuneDebounceTimer = null;
    var prepareWatchdogTimer = null;
    var reconnectTimer = null;
    var healthyTimer = null;
    var timeTimer = null;

    var hlsInstance = null;
    var mpegtsInstance = null;
    var activeEngine = 'none'; // 'avplay' | 'mpegts' | 'hls' | 'native'
    var isPaused = false;
    var userMuted = false;
    var autoplayBlockedMuted = false;
    var currentSession = null;

    function hasAvPlay() {
      return !!(global.webapis && global.webapis.avplay && typeof global.webapis.avplay.open === 'function');
    }

    function disableSamsungScreenSaver() {
      if (!global.webapis || !global.webapis.appcommon) return;
      try {
        var stateEnum = global.webapis.appcommon.AppCommonScreenSaverState;
        var offVal = stateEnum ? stateEnum.SCREEN_SAVER_OFF : 0;
        global.webapis.appcommon.setScreenSaver(offVal, function () {}, function () {});
      } catch (_) {}
    }

    function is4kPanelSupported() {
      try {
        return !!(
          global.webapis &&
          global.webapis.productinfo &&
          typeof global.webapis.productinfo.isUdPanelSupported === 'function' &&
          global.webapis.productinfo.isUdPanelSupported()
        );
      } catch (_) {
        return false;
      }
    }

    function emitMuteState() {
      onMuteChange({
        muted: !!(userMuted || autoplayBlockedMuted || (videoEl && videoEl.muted)),
        autoplayBlocked: autoplayBlockedMuted
      });
    }

    function unlockAutoplayAudio() {
      if (!autoplayBlockedMuted) return;
      autoplayBlockedMuted = false;
      if (videoEl && !userMuted) {
        videoEl.muted = false;
        videoEl.volume = 1.0;
        if (videoEl.paused && (activeEngine === 'hls' || activeEngine === 'mpegts' || activeEngine === 'native')) {
          videoEl.play().catch(function () {});
        }
      }
      emitMuteState();
    }

    ['mousedown', 'keydown'].forEach(function (evName) {
      global.addEventListener(evName, unlockAutoplayAudio, true);
    });

    function clearTimers() {
      if (tuneDebounceTimer) {
        clearTimeout(tuneDebounceTimer);
        tuneDebounceTimer = null;
      }
      if (prepareWatchdogTimer) {
        clearTimeout(prepareWatchdogTimer);
        prepareWatchdogTimer = null;
      }
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (healthyTimer) {
        clearTimeout(healthyTimer);
        healthyTimer = null;
      }
      if (timeTimer) {
        clearInterval(timeTimer);
        timeTimer = null;
      }
    }

    // Only reset `reconnectCount = 0` after 3.5s of stable playback (prevents infinite MANIFEST_PARSED <-> MEDIA_ERROR blink loops!)
    function armHealthyStreamTimer(token) {
      if (healthyTimer) clearTimeout(healthyTimer);
      healthyTimer = setTimeout(function () {
        healthyTimer = null;
        if (token === loadToken && currentSession) {
          currentSession.reconnectCount = 0;
        }
      }, 3500);
    }

    function destroyHls() {
      if (hlsInstance) {
        try {
          hlsInstance.destroy();
        } catch (_) {}
        hlsInstance = null;
      }
    }

    function destroyMpegts() {
      if (mpegtsInstance) {
        try {
          mpegtsInstance.unload();
          mpegtsInstance.detachMediaElement();
          mpegtsInstance.destroy();
        } catch (_) {}
        mpegtsInstance = null;
      }
    }

    function detachHtml5Engines() {
      destroyHls();
      destroyMpegts();
      if (videoEl) {
        try {
          videoEl.onloadedmetadata = null;
          videoEl.onplaying = null;
          videoEl.onerror = null;
          videoEl.pause();
          videoEl.removeAttribute('src');
        } catch (_) {}
      }
    }

    function stopHtml5() {
      detachHtml5Engines();
      if (videoEl) {
        try { videoEl.load(); } catch (_) {}
        videoEl.style.display = 'none';
      }
    }

    // Strict Tizen AVPlay teardown: ONLY call stop() in PLAYING or PAUSED before close()!
    function stopAvPlay() {
      if (!hasAvPlay()) return;
      var av = global.webapis.avplay;
      try {
        var st = av.getState();
        if (st === 'PLAYING' || st === 'PAUSED') {
          try { av.stop(); } catch (_) {}
        }
        if (st && st !== 'NONE') {
          try { av.close(); } catch (_) {}
        }
      } catch (_) {
        try { av.close(); } catch (_2) {}
      }
      if (avObj) avObj.style.visibility = 'hidden';
    }

    function stopAll() {
      loadToken++;
      clearTimers();
      stopAvPlay();
      stopHtml5();
      activeEngine = 'none';
      isPaused = false;
    }

    function getElapsedArchivePlaySec() {
      if (!currentSession || currentSession.mode !== 'archive') return 0;
      if (activeEngine === 'hls' || activeEngine === 'mpegts' || activeEngine === 'native') {
        var ct = Number(videoEl && videoEl.currentTime) || 0;
        if (ct > 0 && isFinite(ct) && ct < 86400) {
          return Math.floor(ct);
        }
      }
      if (activeEngine === 'avplay' && hasAvPlay()) {
        try {
          var ms = global.webapis.avplay.getCurrentTime();
          if (ms > 0 && ms < 86400000) return Math.floor(ms / 1000);
        } catch (_) {}
      }
      if (!currentSession.playStartedMs) return 0;
      return Math.max(0, Math.floor((Date.now() - currentSession.playStartedMs) / 1000));
    }

    function emitArchiveClock() {
      if (!currentSession) return;
      if (currentSession.mode === 'archive' && currentSession.program) {
        var dur = Math.max(60, currentSession.program.e - currentSession.program.s);
        var pos = Math.min(dur, Math.max(0, (currentSession.seekOffsetSec || 0) + getElapsedArchivePlaySec()));
        onTime({
          mode: 'archive',
          positionSec: pos,
          durationSec: dur,
          absoluteSec: currentSession.program.s + pos
        });
      } else {
        onTime({ mode: 'live' });
      }
    }

    function startClock() {
      if (timeTimer) clearInterval(timeTimer);
      timeTimer = setInterval(emitArchiveClock, 1000);
    }

    function scheduleLiveReconnect(reason) {
      if (!currentSession || currentSession.mode !== 'live' || currentSession.fatalCodecError) {
        onState('error');
        onError(reason || 'Archive stream unavailable');
        return;
      }
      currentSession.reconnectCount = (currentSession.reconnectCount || 0) + 1;
      if (currentSession.reconnectCount > 2) {
        onState('error');
        onError(reason || 'Channel stream unsupported or offline');
        return;
      }
      var delays = [1500, 3200];
      var delayMs = delays[currentSession.reconnectCount - 1] || 2500;
      var savedToken = loadToken;
      onState('buffering');
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(function () {
        if (savedToken !== loadToken || !currentSession) return;
        currentSession.urlIndex = 0;
        var token = ++loadToken;
        trySessionUrls(token, (currentSession.settings && currentSession.settings.preferEngine) || 'auto');
      }, delayMs);
    }

    function applyAvPlayDisplaySettings(av) {
      try {
        av.setDisplayRect(0, 0, 1920, 1080);
      } catch (_) {}
      try {
        av.setDisplayMethod('PLAYER_DISPLAY_MODE_AUTO_ASPECT_RATIO');
      } catch (_) {
        try {
          av.setDisplayMethod('PLAYER_DISPLAY_MODE_FULL_SCREEN');
        } catch (_2) {}
      }
    }

    function playWithAvPlay(url, token, onEngineFail) {
      try {
        stopHtml5();
        stopAvPlay();
        disableSamsungScreenSaver();
        if (avObj) avObj.style.visibility = 'visible';

        var av = global.webapis.avplay;
        av.open(url);
        applyAvPlayDisplaySettings(av);

        if (is4kPanelSupported()) {
          try {
            av.setStreamingProperty('SET_MODE_4K', 'TRUE');
          } catch (_) {}
        }

        try {
          av.setTimeoutForBuffering(10);
        } catch (_) {}

        var settled = false;
        function failOnce(msg) {
          if (settled || token !== loadToken) return;
          settled = true;
          if (prepareWatchdogTimer) {
            clearTimeout(prepareWatchdogTimer);
            prepareWatchdogTimer = null;
          }
          onEngineFail(msg);
        }

        if (prepareWatchdogTimer) clearTimeout(prepareWatchdogTimer);
        prepareWatchdogTimer = setTimeout(function () {
          failOnce('AVPlay prepare timeout');
        }, 15000);

        av.setListener({
          onbufferingstart: function () {
            if (token !== loadToken) return;
            onState('buffering');
          },
          onbufferingprogress: function (percent) {
            if (token !== loadToken) return;
            onState('buffering', percent);
          },
          onbufferingcomplete: function () {
            if (token !== loadToken) return;
            armHealthyStreamTimer(token);
            onState('playing');
          },
          onstreamcompleted: function () {
            if (token !== loadToken) return;
            if (currentSession && currentSession.mode === 'live') {
              scheduleLiveReconnect('Live stream reset');
            } else {
              onState('ended');
            }
          },
          onerror: function (errType) {
            if (token !== loadToken) return;
            if (!settled) {
              failOnce('AVPlay error: ' + errType);
            } else if (currentSession && currentSession.mode === 'live') {
              scheduleLiveReconnect('AVPlay stream error: ' + errType);
            }
          }
        });

        av.prepareAsync(
          function () {
            if (token !== loadToken) {
              stopAvPlay();
              return;
            }
            settled = true;
            if (prepareWatchdogTimer) {
              clearTimeout(prepareWatchdogTimer);
              prepareWatchdogTimer = null;
            }
            try {
              applyAvPlayDisplaySettings(av);
              activeEngine = 'avplay';
              isPaused = false;
              if (currentSession) currentSession.playStartedMs = Date.now();
              av.play();
              armHealthyStreamTimer(token);
              onState('playing');
              startClock();
            } catch (playErr) {
              onEngineFail(String(playErr));
            }
          },
          function (prepErr) {
            failOnce('AVPlay prepare failed: ' + prepErr);
          }
        );
      } catch (ex) {
        onEngineFail(String(ex));
      }
    }

    function startVideoElementPlayback(token) {
      videoEl.onplaying = function () {
        if (token !== loadToken) return;
        if (currentSession) currentSession.playStartedMs = Date.now();
        armHealthyStreamTimer(token);
        onState('playing');
        startClock();
      };
      videoEl.muted = userMuted;
      videoEl.volume = 1.0;
      var p = videoEl.play();
      if (p && typeof p.catch === 'function') {
        p.catch(function () {
          autoplayBlockedMuted = true;
          videoEl.muted = true;
          emitMuteState();
          videoEl.play().catch(function () {});
        });
      }
    }

    function isRawMpegTsUrl(url) {
      if (/^\/stream\?url=/i.test(url)) return true;
      if (/\.m3u8(\?|$)/i.test(url) || /[?&]hls=1\b/i.test(url)) return false;
      if (/\.mp4(\?|$)/i.test(url)) return false;
      if (/\.ts(\?|$)/i.test(url)) return true;
      if (/\/proxy\?url=/i.test(url)) {
        var decoded = '';
        try { decoded = decodeURIComponent(url); } catch (_) { decoded = url; }
        if (/\.m3u8(\?|$)/i.test(decoded)) return false;
        return true;
      }
      return /\/(live\/)?[^/]+\/[^/]+\/\d+(\?|$)/i.test(url);
    }

    // Continuous MPEG-TS demuxer (`mpegts.js`) for `/stream` (M4 hardware deinterlaced) & raw TiviMate `.ts` streams!
    function playWithMpegTs(url, token, onEngineFail) {
      try {
        var isLocalHwStream = /^\/stream\?url=/i.test(url);
        var mpegPlayer = global.mpegts.createPlayer(
          {
            type: 'mpegts',
            isLive: !currentSession || currentSession.mode === 'live',
            url: url,
            cors: true
          },
          {
            enableWorker: true,
            enableStashBuffer: true,
            stashInitialSize: isLocalHwStream ? 128 * 1024 : 384 * 1024,
            fixAudioTimestampGap: true,
            liveBufferLatencyChasing: false,
            autoCleanupSourceBuffer: true,
            autoCleanupMaxBackwardDuration: 45,
            autoCleanupMinBackwardDuration: 20
          }
        );
        mpegtsInstance = mpegPlayer;
        activeEngine = 'mpegts';
        isPaused = false;

        var failed = false;
        mpegPlayer.on(global.mpegts.Events.ERROR, function (errType, errDetail) {
          if (failed || token !== loadToken) return;
          failed = true;
          destroyMpegts();
          onEngineFail('MPEG-TS error: ' + errType + ' ' + (errDetail || ''));
        });

        mpegPlayer.attachMediaElement(videoEl);
        mpegPlayer.load();
        startVideoElementPlayback(token);
      } catch (err) {
        destroyMpegts();
        onEngineFail('mpegts init failed: ' + err);
      }
    }

    function playWithHtml5(url, token, onEngineFail) {
      stopAvPlay();
      // Detach prior MSE instance WITHOUT toggling `videoEl.style.display = 'none'` (eliminates black DOM blink!)
      detachHtml5Engines();
      if (!videoEl) {
        onEngineFail('No HTML5 video element');
        return;
      }

      if (videoEl.style.display !== 'block') {
        videoEl.style.display = 'block';
      }
      autoplayBlockedMuted = false;
      emitMuteState();

      // 1. Raw continuous TiviMate MPEG-TS (.ts / extensionless) -> mpegts.js
      if (isRawMpegTsUrl(url) && global.mpegts && typeof global.mpegts.isSupported === 'function' && global.mpegts.isSupported()) {
        playWithMpegTs(url, token, onEngineFail);
        return;
      }

      // 2. HLS (.m3u8) -> Hls.js with DVB PTS discontinuity & anti-flicker tuning
      var isM3u8 = /\.m3u8(\?|$)/i.test(url) || url.indexOf('m3u8') !== -1 || /[?&]hls=1\b/i.test(url);
      if (global.Hls && global.Hls.isSupported() && (isM3u8 || !/\.mp4(\?|$)/i.test(url))) {
        var hls = new global.Hls({
          enableWorker: true,
          lowLatencyMode: false,
          liveSyncDurationCount: 3,
          liveMaxLatencyDurationCount: 8,
          maxBufferLength: 30,
          maxMaxBufferLength: 60,
          backBufferLength: 25,
          maxBufferHole: 0.5,
          nudgeOffset: 0.2,
          nudgeMaxRetry: 5,
          stretchShortVideoTrack: true,
          manifestLoadingTimeOut: 12000,
          manifestLoadingMaxRetry: 1,
          levelLoadingTimeOut: 12000,
          fragLoadingTimeOut: 15000,
          fragLoadingMaxRetry: 2
        });
        hlsInstance = hls;

        var mediaRecoveredOnce = false;
        var codecSwappedOnce = false;
        var netRetriedOnce = false;

        hls.on(global.Hls.Events.MANIFEST_PARSED, function () {
          if (token !== loadToken) return;
          activeEngine = 'hls';
          isPaused = false;
          startVideoElementPlayback(token);
          if (currentSession && currentSession.channel && currentSession.channel.isDemo && currentSession.seekOffsetSec > 0) {
            try {
              if (videoEl.duration > 30) {
                videoEl.currentTime = currentSession.seekOffsetSec % Math.floor(videoEl.duration);
              }
            } catch (_) {}
          }
        });

        hls.on(global.Hls.Events.ERROR, function (_, data) {
          if (token !== loadToken || !data || !data.fatal) return;

          if (data.type === global.Hls.ErrorTypes.MEDIA_ERROR) {
            var isCodecErr =
              data.details === 'bufferAddCodecError' ||
              data.details === 'manifestIncompatibleCodecsError';
            if (isCodecErr) {
              if (!codecSwappedOnce) {
                codecSwappedOnce = true;
                try { hls.swapAudioCodec(); } catch (_) {}
                hls.recoverMediaError();
                return;
              }
              if (currentSession) currentSession.fatalCodecError = true;
              destroyHls();
              onEngineFail('Browser MSE codec unsupported (' + data.details + ' — plays natively on Samsung TV AVPlay)');
              return;
            }
            if (!mediaRecoveredOnce) {
              mediaRecoveredOnce = true;
              hls.recoverMediaError();
              return;
            }
            destroyHls();
            onEngineFail('HLS media error: ' + (data.details || 'fatal'));
            return;
          }

          if (data.type === global.Hls.ErrorTypes.NETWORK_ERROR && data.details !== 'manifestParsingError' && !netRetriedOnce) {
            netRetriedOnce = true;
            hls.startLoad();
            return;
          }

          destroyHls();
          onEngineFail('HLS fatal: ' + (data.details || data.type));
        });

        hls.loadSource(url);
        hls.attachMedia(videoEl);
        return;
      }

      // 3. Native <video> fallback (Safari HLS / MP4)
      activeEngine = 'native';
      videoEl.src = url;
      videoEl.onloadedmetadata = function () {
        if (token !== loadToken) return;
        isPaused = false;
        startVideoElementPlayback(token);
      };
      videoEl.onerror = function () {
        if (token !== loadToken) return;
        onEngineFail('Native video playback error');
      };
    }

    function attemptUrlWithEngines(url, preferEngine, token, onExhausted) {
      var canAv = hasAvPlay();
      var tryAvFirst = canAv && preferEngine !== 'hls';

      if (tryAvFirst) {
        playWithAvPlay(url, token, function (avErr) {
          if (token !== loadToken) return;
          if (preferEngine === 'avplay') {
            onExhausted(avErr);
            return;
          }
          playWithHtml5(url, token, function (hErr) {
            if (token !== loadToken) return;
            onExhausted(avErr + ' | ' + hErr);
          });
        });
      } else {
        playWithHtml5(url, token, function (hErr) {
          if (token !== loadToken) return;
          if (canAv && preferEngine !== 'hls') {
            playWithAvPlay(url, token, onExhausted);
          } else {
            onExhausted(hErr);
          }
        });
      }
    }

    function trySessionUrls(token, preferEngine) {
      if (!currentSession || token !== loadToken) return;
      var idx = currentSession.urlIndex;
      var urls = currentSession.urls;
      if (idx >= urls.length) {
        scheduleLiveReconnect(currentSession.lastError || 'Stream unavailable');
        return;
      }
      var targetUrl = urls[idx];
      onState('buffering');

      attemptUrlWithEngines(targetUrl, preferEngine, token, function (errMsg) {
        if (token !== loadToken) return;
        currentSession.lastError = errMsg;
        currentSession.urlIndex++;
        trySessionUrls(token, preferEngine);
      });
    }

    function canUseBrowserStreamProxy() {
      var proto = global.location && global.location.protocol;
      return !hasAvPlay() && (proto === 'http:' || proto === 'https:');
    }

    // On Samsung TV (`hasAvPlay()`), returns untouched native URLs immediately!
    // On Mac (`server.mjs`), routes external IPTV channels through `/stream` first (Apple M4 hardware VideoToolbox + `bwdif`
    // broadcast deinterlacer — eliminates 1080i blinking, HEVC/MPEG-2 incompatibility, and AC-3 silence!), with `/proxy` fallback.
    function withBrowserFallbacks(urls, isDemoChannel) {
      if (!canUseBrowserStreamProxy()) return urls;
      var out = [];
      function addUnique(u) {
        if (u && out.indexOf(u) === -1) out.push(u);
      }

      for (var i = 0; i < urls.length; i++) {
        var u = urls[i];
        var isRemoteHttp = /^https?:\/\//i.test(u);
        if (isRemoteHttp && !isDemoChannel) {
          addUnique('/stream?url=' + encodeURIComponent(u));
        }
        if (isRawMpegTsUrl(u)) {
          if (isRemoteHttp) addUnique('/proxy?url=' + encodeURIComponent(u));
          addUnique(u);
          if (/\.ts(\?|$)/i.test(u)) {
            var m3u8Var = u.replace(/\.ts(\?|$)/i, '.m3u8$1');
            if (isRemoteHttp) addUnique('/proxy?hls=1&url=' + encodeURIComponent(m3u8Var));
            addUnique(m3u8Var);
          }
        } else {
          addUnique(u);
          if (isRemoteHttp) addUnique('/proxy?hls=1&url=' + encodeURIComponent(u));
        }
      }
      return out;
    }

    function scheduleHardwareStart(preferEngine) {
      var token = ++loadToken;
      if (tuneDebounceTimer) clearTimeout(tuneDebounceTimer);
      onState('buffering');
      var delay = hasAvPlay() ? 180 : 30;
      tuneDebounceTimer = setTimeout(function () {
        tuneDebounceTimer = null;
        if (token !== loadToken) return;
        trySessionUrls(token, preferEngine);
      }, delay);
    }

    function playLive(channel, settings) {
      clearTimers();
      var preferEngine = (settings && settings.preferEngine) || 'auto';
      currentSession = {
        mode: 'live',
        channel: channel,
        urls: withBrowserFallbacks([channel.url], !!(channel && channel.isDemo)),
        urlIndex: 0,
        program: null,
        seekOffsetSec: 0,
        playStartedMs: 0,
        reconnectCount: 0,
        lastError: '',
        settings: settings
      };
      scheduleHardwareStart(preferEngine);
    }

    function playArchive(channel, program, offsetSec, settings) {
      clearTimers();
      var preferEngine = (settings && settings.preferEngine) || 'auto';
      var clampedOffset = Math.max(0, Math.min(Math.max(0, program.e - program.s - 15), Math.floor(offsetSec || 0)));
      var effectiveStartSec = program.s + clampedOffset;
      var candidates = NS.Catchup.buildCatchupCandidates(channel, effectiveStartSec, program.e, settings);

      currentSession = {
        mode: 'archive',
        channel: channel,
        urls: withBrowserFallbacks(candidates, !!(channel && channel.isDemo)),
        urlIndex: 0,
        program: program,
        seekOffsetSec: clampedOffset,
        playStartedMs: 0,
        reconnectCount: 0,
        lastError: '',
        settings: settings
      };
      scheduleHardwareStart(preferEngine);
    }

    function seekArchiveToOffset(targetOffsetSec) {
      if (!currentSession || currentSession.mode !== 'archive' || !currentSession.program) return;
      var dur = Math.max(60, currentSession.program.e - currentSession.program.s);
      var clamped = Math.max(0, Math.min(dur - 10, Math.floor(targetOffsetSec)));

      if ((activeEngine === 'hls' || activeEngine === 'native') && videoEl && isFinite(videoEl.duration) && videoEl.duration >= dur * 0.85) {
        try {
          videoEl.currentTime = clamped;
          currentSession.seekOffsetSec = 0;
          emitArchiveClock();
          return;
        } catch (_) {}
      }

      playArchive(currentSession.channel, currentSession.program, clamped, currentSession.settings);
    }

    function togglePause() {
      if (activeEngine === 'avplay' && hasAvPlay()) {
        try {
          var st = global.webapis.avplay.getState();
          if (st === 'PLAYING') {
            global.webapis.avplay.pause();
            isPaused = true;
            onState('paused');
          } else if (st === 'PAUSED') {
            global.webapis.avplay.play();
            isPaused = false;
            onState('playing');
          }
        } catch (_) {}
      } else if ((activeEngine === 'hls' || activeEngine === 'mpegts' || activeEngine === 'native') && videoEl) {
        if (videoEl.paused) {
          videoEl.play().catch(function () {});
          isPaused = false;
          onState('playing');
        } else {
          videoEl.pause();
          isPaused = true;
          onState('paused');
        }
      }
      return isPaused;
    }

    function toggleMute() {
      if (autoplayBlockedMuted) {
        unlockAutoplayAudio();
        return false;
      }
      userMuted = !userMuted;
      if (videoEl) {
        videoEl.muted = userMuted;
        if (!userMuted) videoEl.volume = 1.0;
      }
      if (global.tizen && global.tizen.tvaudiocontrol) {
        try {
          global.tizen.tvaudiocontrol.setMute(userMuted);
        } catch (_) {}
      }
      emitMuteState();
      return userMuted;
    }

    function cycleAudioTrack() {
      if (activeEngine === 'hls' && hlsInstance && hlsInstance.audioTracks && hlsInstance.audioTracks.length > 1) {
        var nextIdx = (hlsInstance.audioTrack + 1) % hlsInstance.audioTracks.length;
        hlsInstance.audioTrack = nextIdx;
        var tr = hlsInstance.audioTracks[nextIdx];
        return (tr && (tr.name || tr.lang)) || ('Track ' + (nextIdx + 1));
      }
      if (activeEngine === 'avplay' && hasAvPlay()) {
        try {
          var tracks = global.webapis.avplay.getTotalTrackInfo();
          var audioTracks = tracks.filter(function (t) { return t.type === 'AUDIO'; });
          if (audioTracks.length > 1) {
            var cur = global.webapis.avplay.getCurrentStreamInfo().filter(function (s) { return s.type === 'AUDIO'; })[0];
            var curPos = 0;
            for (var i = 0; i < audioTracks.length; i++) {
              if (cur && Number(audioTracks[i].index) === Number(cur.index)) curPos = i;
            }
            var nextTrack = audioTracks[(curPos + 1) % audioTracks.length];
            global.webapis.avplay.setSelectTrack('AUDIO', Number(nextTrack.index));
            return nextTrack.extra_info || ('Audio Track ' + nextTrack.index);
          }
        } catch (_) {}
      }
      return '';
    }

    document.addEventListener('visibilitychange', function () {
      if (!currentSession) return;
      if (document.hidden) {
        if (activeEngine === 'avplay' && hasAvPlay()) {
          if (currentSession.mode === 'live') {
            stopAvPlay();
          } else {
            try { global.webapis.avplay.suspend(); } catch (_) {}
          }
        }
      } else {
        disableSamsungScreenSaver();
        if (currentSession.mode === 'live') {
          playLive(currentSession.channel, currentSession.settings);
        } else if (activeEngine === 'avplay' && hasAvPlay()) {
          try { global.webapis.avplay.restore(); } catch (_) {
            playArchive(currentSession.channel, currentSession.program, getElapsedArchivePlaySec(), currentSession.settings);
          }
        }
      }
    }, false);

    if (global.webapis && global.webapis.network && typeof global.webapis.network.addNetworkStateChangeListener === 'function') {
      try {
        global.webapis.network.addNetworkStateChangeListener(function (netState) {
          var ns = global.webapis.network.NetworkState;
          var reconnected = ns && (netState === ns.GATEWAY_CONNECTED || netState === ns.WIFI_CONNECTED || netState === ns.LAN_CABLE_ATTACHED);
          if (reconnected && currentSession && currentSession.mode === 'live' && !document.hidden) {
            playLive(currentSession.channel, currentSession.settings);
          }
        });
      } catch (_) {}
    }

    return {
      playLive: playLive,
      playArchive: playArchive,
      seekArchiveToOffset: seekArchiveToOffset,
      togglePause: togglePause,
      toggleMute: toggleMute,
      cycleAudioTrack: cycleAudioTrack,
      stop: stopAll,
      getSession: function () {
        return currentSession;
      },
      getCurrentArchiveOffsetSec: function () {
        if (!currentSession || currentSession.mode !== 'archive') return 0;
        return (currentSession.seekOffsetSec || 0) + getElapsedArchivePlaySec();
      },
      getActiveEngine: function () {
        return activeEngine;
      }
    };
  }

  NS.Player = {
    createPlayer: createPlayer
  };
})(window);
