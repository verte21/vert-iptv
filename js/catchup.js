(function (global) {
  'use strict';

  var NS = (global.vertIPTV = global.vertIPTV || {});

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function formatDatePattern(epochSec, pattern, useLocal) {
    var d = new Date(epochSec * 1000);
    var Y = String(useLocal ? d.getFullYear() : d.getUTCFullYear());
    var m = pad2((useLocal ? d.getMonth() : d.getUTCMonth()) + 1);
    var day = pad2(useLocal ? d.getDate() : d.getUTCDate());
    var H = pad2(useLocal ? d.getHours() : d.getUTCHours());
    var M = pad2(useLocal ? d.getMinutes() : d.getUTCMinutes());
    var S = pad2(useLocal ? d.getSeconds() : d.getUTCSeconds());

    var out = '';
    for (var i = 0; i < pattern.length; i++) {
      var ch = pattern[i];
      if (ch === 'Y') out += Y;
      else if (ch === 'y') out += Y.slice(2);
      else if (ch === 'm') out += m;
      else if (ch === 'd') out += day;
      else if (ch === 'H') out += H;
      else if (ch === 'M') out += M;
      else if (ch === 'S') out += S;
      else out += ch;
    }
    return out;
  }

  function expandTemplate(template, startSec, endSec, nowSec, channel) {
    var durSec = Math.max(60, endSec - startSec);
    var durMin = Math.max(1, Math.ceil(durSec / 60));
    var offsetSec = Math.max(0, nowSec - startSec);

    var dUtc = new Date(startSec * 1000);
    var Y = String(dUtc.getUTCFullYear());
    var m = pad2(dUtc.getUTCMonth() + 1);
    var d = pad2(dUtc.getUTCDate());
    var H = pad2(dUtc.getUTCHours());
    var M = pad2(dUtc.getUTCMinutes());
    var S = pad2(dUtc.getUTCSeconds());

    return template.replace(/(\$?)\{([^}]+)\}/g, function (full, dollar, token) {
      var isLocal = dollar === '$' && token.indexOf('start:') === 0;
      if (token === 'utc' || token === 'start') return String(startSec);
      if (token === 'utcend' || token === 'end') return String(endSec);
      if (token === 'lutc' || token === 'timestamp' || token === 'now') return String(nowSec);
      if (token === 'duration') return String(durSec);
      if (token === 'duration:60') return String(durMin);
      if (token === 'offset') return String(offsetSec);
      if (token === 'offset:60') return String(Math.floor(offsetSec / 60));
      if (token === 'Y') return Y;
      if (token === 'm') return m;
      if (token === 'd') return d;
      if (token === 'H') return H;
      if (token === 'M') return M;
      if (token === 'S') return S;
      if (token === 'channel_id' || token === 'id') return encodeURIComponent(channel.tvgId || channel.id || '');

      var colonIdx = token.indexOf(':');
      if (colonIdx > 0) {
        var prefix = token.slice(0, colonIdx);
        var fmt = token.slice(colonIdx + 1);
        if (prefix === 'duration') {
          var div = Number(fmt) || 1;
          return String(Math.max(1, Math.round(durSec / div)));
        }
        if (prefix === 'offset') {
          var odiv = Number(fmt) || 1;
          return String(Math.max(0, Math.round(offsetSec / odiv)));
        }
        if (prefix === 'utc' || prefix === 'start') {
          return formatDatePattern(startSec, fmt, isLocal);
        }
        if (prefix === 'utcend' || prefix === 'end') {
          return formatDatePattern(endSec, fmt, isLocal);
        }
        if (prefix === 'lutc' || prefix === 'timestamp') {
          return formatDatePattern(nowSec, fmt, false);
        }
      }
      return full;
    });
  }

  function appendQuery(baseUrl, queryPart) {
    var cleanPart = queryPart.replace(/^[?&]+/, '');
    return baseUrl + (baseUrl.indexOf('?') === -1 ? '?' : '&') + cleanPart;
  }

  // Detect Xtream-Codes style live stream URLs inside an M3U playlist:
  // http(s)://host:port/live/user/pass/12345.ts (or .m3u8)
  // or http(s)://host:port/user/pass/12345
  function parseXtreamLiveUrl(url) {
    var m = /^https?:\/\/([^/]+)\/(?:live\/)?([^/]+)\/([^/]+)\/(\d+)(?:\.(ts|m3u8))?(?:\?.*)?$/i.exec(url);
    if (!m) return null;
    return {
      origin: url.slice(0, url.indexOf(m[1]) + m[1].length),
      user: m[2],
      pass: m[3],
      streamId: m[4],
      ext: m[5] || 'ts'
    };
  }

  function buildXtreamCandidates(xc, startSec, endSec) {
    var durMin = Math.max(1, Math.ceil(Math.max(60, endSec - startSec) / 60));
    var utcStart = formatDatePattern(startSec, 'Y-m-d:H-M', false);
    var localStart = formatDatePattern(startSec, 'Y-m-d:H-M', true);

    var out = [
      xc.origin + '/timeshift/' + xc.user + '/' + xc.pass + '/' + durMin + '/' + utcStart + '/' + xc.streamId + '.' + xc.ext,
      xc.origin + '/streaming/timeshift.php?username=' + encodeURIComponent(xc.user) +
        '&password=' + encodeURIComponent(xc.pass) +
        '&stream=' + xc.streamId +
        '&start=' + utcStart +
        '&duration=' + durMin
    ];

    if (localStart !== utcStart) {
      out.push(
        xc.origin + '/timeshift/' + xc.user + '/' + xc.pass + '/' + durMin + '/' + localStart + '/' + xc.streamId + '.' + xc.ext
      );
    }
    return out;
  }

  function buildFlussonicCandidates(liveUrl, startSec, endSec) {
    var durSec = Math.max(60, endSec - startSec);
    var qIdx = liveUrl.indexOf('?');
    var pathPart = qIdx === -1 ? liveUrl : liveUrl.slice(0, qIdx);
    var queryPart = qIdx === -1 ? '' : liveUrl.slice(qIdx);
    var out = [];

    if (/\/(index|mono|video)\.m3u8$/i.test(pathPart)) {
      out.push(pathPart.replace(/\/(index|mono|video)\.m3u8$/i, '/index-' + startSec + '-' + durSec + '.m3u8') + queryPart);
      out.push(pathPart.replace(/\/(index|mono|video)\.m3u8$/i, '/archive-' + startSec + '-' + durSec + '.m3u8') + queryPart);
    } else if (/\/mpegts$/i.test(pathPart)) {
      out.push(pathPart.replace(/\/mpegts$/i, '/archive/' + startSec + '/' + durSec + '/mpegts') + queryPart);
    } else {
      var slashIdx = pathPart.lastIndexOf('/');
      if (slashIdx > 8) {
        var dir = pathPart.slice(0, slashIdx);
        out.push(dir + '/index-' + startSec + '-' + durSec + '.m3u8' + queryPart);
        out.push(dir + '/archive-' + startSec + '-' + durSec + '.ts' + queryPart);
      }
    }
    return out;
  }

  function pushUnique(list, url) {
    if (url && list.indexOf(url) === -1) list.push(url);
  }

  function buildCatchupCandidates(channel, startSec, endSec, settings) {
    var liveUrl = channel.url;
    var nowSec = Math.floor(Date.now() / 1000);
    var mode = (settings && settings.catchupMode) || 'auto';
    var chType = (channel.catchupType || '').toLowerCase();
    var chSource = channel.catchupSource || '';
    var candidates = [];

    // Demo channel handling: keep same playable stream with a virtual archive marker
    if (channel.isDemo) {
      return [appendQuery(liveUrl, 'vertiptv_archive_start=' + startSec + '&vertiptv_archive_end=' + endSec)];
    }

    var effectiveType = mode !== 'auto' ? mode : chType;

    // 1. Explicit catchup-source template in M3U
    if (chSource && (mode === 'auto' || mode === 'append')) {
      var expanded = expandTemplate(chSource, startSec, endSec, nowSec, channel);
      if (/^https?:\/\//i.test(expanded)) {
        pushUnique(candidates, expanded);
      } else if (expanded.charAt(0) === '?' || expanded.charAt(0) === '&' || effectiveType === 'append') {
        pushUnique(candidates, appendQuery(liveUrl, expanded));
      } else {
        var baseSlash = liveUrl.lastIndexOf('/');
        if (baseSlash > 8) {
          pushUnique(candidates, liveUrl.slice(0, baseSlash + 1) + expanded.replace(/^\//, ''));
        }
        pushUnique(candidates, appendQuery(liveUrl, expanded));
      }
    }

    // 2. Xtream Codes pattern (explicit or auto-detected from URL)
    var xcParsed = parseXtreamLiveUrl(liveUrl);
    if (effectiveType === 'xc' || (effectiveType === '' && xcParsed) || (mode === 'auto' && xcParsed)) {
      if (xcParsed) {
        var xcUrls = buildXtreamCandidates(xcParsed, startSec, endSec);
        for (var i = 0; i < xcUrls.length; i++) pushUnique(candidates, xcUrls[i]);
      }
    }

    // 3. Flussonic pattern
    if (
      effectiveType === 'flussonic' ||
      effectiveType === 'flussonic-hls' ||
      effectiveType === 'flussonic-ts' ||
      effectiveType === 'fs' ||
      (mode === 'auto' && /\/(index|mono|video)\.m3u8(\?|$)/i.test(liveUrl))
    ) {
      var flUrls = buildFlussonicCandidates(liveUrl, startSec, endSec);
      for (var j = 0; j < flUrls.length; j++) pushUnique(candidates, flUrls[j]);
    }

    // 4. Universal shift (?utc=...&lutc=...) & start/end fallbacks
    pushUnique(candidates, appendQuery(liveUrl, 'utc=' + startSec + '&lutc=' + nowSec));
    pushUnique(candidates, appendQuery(liveUrl, 'start=' + startSec + '&end=' + endSec));

    return candidates;
  }

  function getChannelRawCatchupDays(channel, settings) {
    if (channel && typeof channel.catchupDays === 'number' && !isNaN(channel.catchupDays)) {
      return Math.max(0, channel.catchupDays);
    }
    return Math.max(0, (settings && settings.catchupDays) || 3);
  }

  function getChannelCatchupDays(channel, settings) {
    return Math.min(3, getChannelRawCatchupDays(channel, settings));
  }

  function isProgramCatchupAvailable(channel, program, nowSec, settings) {
    if (!channel || !program) return false;
    var rawDays = getChannelRawCatchupDays(channel, settings);
    if (rawDays <= 0) return false;
    var now = nowSec || Math.floor(Date.now() / 1000);
    if (program.s > now) return false;
    var cutoffSec = now - rawDays * 86400;
    return program.s >= cutoffSec;
  }

  NS.Catchup = {
    buildCatchupCandidates: buildCatchupCandidates,
    getChannelRawCatchupDays: getChannelRawCatchupDays,
    getChannelCatchupDays: getChannelCatchupDays,
    isProgramCatchupAvailable: isProgramCatchupAvailable,
    formatDatePattern: formatDatePattern
  };
})(window);
