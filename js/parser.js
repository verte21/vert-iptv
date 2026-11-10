(function (global) {
  'use strict';

  var NS = (global.vertIPTV = global.vertIPTV || {});

  // Shared core parsing code stringified into a Blob Worker (and callable on main thread with scheduler.yield fallback)
  function createParserCore() {
    function normalizeKey(str) {
      if (!str) return '';
      return String(str)
        .toLowerCase()
        .replace(/\b(hd|fhd|uhd|4k|sd|pl|tv|hevc|h265|raw)\b/g, '')
        .replace(/[^a-z0-9\u00c0-\u024f]+/g, '');
    }

    function decodeEntities(str) {
      if (!str || str.indexOf('&') === -1) return str || '';
      return str
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#(\d+);/g, function (_, code) {
          return String.fromCharCode(Number(code));
        })
        .replace(/&#x([0-9a-fA-F]+);/g, function (_, hex) {
          return String.fromCharCode(parseInt(hex, 16));
        });
    }

    function parseAttrs(line) {
      var attrs = {};
      var re = /([a-zA-Z0-9_-]+)\s*=\s*"([^"]*)"/g;
      var m;
      while ((m = re.exec(line)) !== null) {
        attrs[m[1].toLowerCase()] = m[2];
      }
      return attrs;
    }

    function parseM3U(text, defaultCatchupDays) {
      var channels = [];
      var groupSet = {};
      var groups = [];
      var headerEpgUrls = [];
      var globalCatchupType = '';
      var globalCatchupSource = '';
      var globalCatchupDays = Number(defaultCatchupDays) || 3;

      var len = text.length;
      var pos = 0;
      var pendingInf = null;
      var pendingGroup = '';

      while (pos < len) {
        var nl = text.indexOf('\n', pos);
        if (nl === -1) nl = len;
        var line = text.slice(pos, nl).trim();
        pos = nl + 1;

        if (!line) continue;

        if (line.charCodeAt(0) === 35) {
          // '#'
          if (line.indexOf('#EXTM3U') === 0) {
            var hAttrs = parseAttrs(line);
            var rawTvg = hAttrs['x-tvg-url'] || hAttrs['url-tvg'] || hAttrs['tvg-url'] || '';
            if (rawTvg) {
              var parts = rawTvg.split(',');
              for (var p = 0; p < parts.length; p++) {
                var u = parts[p].trim();
                if (u && headerEpgUrls.indexOf(u) === -1) headerEpgUrls.push(u);
              }
            }
            if (hAttrs['catchup'] || hAttrs['catchup-type']) {
              globalCatchupType = hAttrs['catchup'] || hAttrs['catchup-type'];
            }
            if (hAttrs['catchup-source']) {
              globalCatchupSource = hAttrs['catchup-source'];
            }
            if (hAttrs['catchup-days'] || hAttrs['timeshift']) {
              globalCatchupDays = Number(hAttrs['catchup-days'] || hAttrs['timeshift']) || globalCatchupDays;
            }
          } else if (line.indexOf('#EXTINF:') === 0 || line.indexOf('#EXTINF ') === 0) {
            var commaIdx = -1;
            var inQuotes = false;
            for (var c = 8; c < line.length; c++) {
              var ch = line.charCodeAt(c);
              if (ch === 34) inQuotes = !inQuotes;
              else if (ch === 44 && !inQuotes) {
                commaIdx = c;
                break;
              }
            }
            var metaPart = commaIdx === -1 ? line : line.slice(0, commaIdx);
            var titlePart = commaIdx === -1 ? '' : line.slice(commaIdx + 1).trim();
            pendingInf = {
              attrs: parseAttrs(metaPart),
              title: titlePart
            };
          } else if (line.indexOf('#EXTGRP:') === 0) {
            pendingGroup = line.slice(8).trim();
          }
          continue;
        }

        // Stream URL line
        if (pendingInf || /^https?:\/\/|^rtmp:\/\/|^mms:\/\//i.test(line)) {
          var attrs = pendingInf ? pendingInf.attrs : {};
          var name = (pendingInf && pendingInf.title) || attrs['tvg-name'] || 'Channel ' + (channels.length + 1);
          var group = attrs['group-title'] || pendingGroup || 'General';
          var tvgId = attrs['tvg-id'] || '';
          var tvgName = attrs['tvg-name'] || '';
          var logo = attrs['tvg-logo'] || '';
          var chNo = Number(attrs['tvg-chno'] || attrs[' channel-number']) || channels.length + 1;

          var cType = attrs['catchup'] || attrs['catchup-type'] || globalCatchupType || '';
          var cSource = attrs['catchup-source'] || globalCatchupSource || '';
          var cDaysRaw = attrs['catchup-days'] || attrs['timeshift'] || attrs['tvg-rec'];
          var cDays = cDaysRaw !== undefined ? Number(cDaysRaw) : globalCatchupDays;
          if (isNaN(cDays) || cDays < 0) cDays = globalCatchupDays;

          if (!groupSet[group]) {
            groupSet[group] = 0;
            groups.push(group);
          }
          groupSet[group]++;

          var key = (tvgId || name) + '::' + channels.length;
          channels.push({
            key: key,
            num: chNo,
            name: name,
            normName: normalizeKey(name),
            group: group,
            logo: logo,
            url: line,
            tvgId: tvgId,
            tvgName: tvgName,
            catchupType: cType,
            catchupSource: cSource,
            catchupDays: cDays
          });

          pendingInf = null;
          pendingGroup = '';
        }
      }

      var groupSummaries = groups.map(function (g) {
        return { name: g, count: groupSet[g] };
      });

      return {
        channels: channels,
        groups: groupSummaries,
        headerEpgUrls: headerEpgUrls
      };
    }

    // Fast integer parser for XMLTV timestamps: "20261109193000 +0100" -> epoch seconds
    function parseXmltvTimeFast(raw) {
      if (!raw || raw.length < 12) return 0;
      var Y = (raw.charCodeAt(0) - 48) * 1000 +
              (raw.charCodeAt(1) - 48) * 100 +
              (raw.charCodeAt(2) - 48) * 10 +
              (raw.charCodeAt(3) - 48);
      var m = (raw.charCodeAt(4) - 48) * 10 + (raw.charCodeAt(5) - 48);
      var d = (raw.charCodeAt(6) - 48) * 10 + (raw.charCodeAt(7) - 48);
      var H = (raw.charCodeAt(8) - 48) * 10 + (raw.charCodeAt(9) - 48);
      var M = (raw.charCodeAt(10) - 48) * 10 + (raw.charCodeAt(11) - 48);
      var S = raw.length >= 14 && raw.charCodeAt(12) >= 48 && raw.charCodeAt(12) <= 57
        ? (raw.charCodeAt(12) - 48) * 10 + (raw.charCodeAt(13) - 48)
        : 0;

      var utcMs = Date.UTC(Y, m - 1, d, H, M, S);
      if (isNaN(utcMs)) return 0;
      var sec = Math.floor(utcMs / 1000);

      // Parse optional timezone offset e.g. " +0100" or " -0500"
      var signIdx = -1;
      for (var i = 12; i < raw.length; i++) {
        var c = raw.charCodeAt(i);
        if (c === 43 || c === 45) {
          signIdx = i;
          break;
        }
      }
      if (signIdx !== -1 && signIdx + 4 < raw.length) {
        var sign = raw.charCodeAt(signIdx) === 43 ? 1 : -1;
        var tzH = (raw.charCodeAt(signIdx + 1) - 48) * 10 + (raw.charCodeAt(signIdx + 2) - 48);
        var tzM = (raw.charCodeAt(signIdx + 3) - 48) * 10 + (raw.charCodeAt(signIdx + 4) - 48);
        if (!isNaN(tzH) && !isNaN(tzM)) {
          sec -= sign * (tzH * 3600 + tzM * 60);
        }
      }
      return sec;
    }

    function extractAttr(tagHeader, attrName) {
      var needle = attrName + '="';
      var idx = tagHeader.indexOf(needle);
      if (idx === -1) {
        needle = attrName + "='";
        idx = tagHeader.indexOf(needle);
        if (idx === -1) return '';
        var endSq = tagHeader.indexOf("'", idx + needle.length);
        return endSq === -1 ? '' : tagHeader.slice(idx + needle.length, endSq);
      }
      var endDq = tagHeader.indexOf('"', idx + needle.length);
      return endDq === -1 ? '' : tagHeader.slice(idx + needle.length, endDq);
    }

    function extractTagText(block, tagName) {
      var openIdx = block.indexOf('<' + tagName);
      if (openIdx === -1) return '';
      var gtIdx = block.indexOf('>', openIdx + tagName.length + 1);
      if (gtIdx === -1) return '';
      if (block.charCodeAt(gtIdx - 1) === 47) return ''; // self-closing
      var closeIdx = block.indexOf('</' + tagName + '>', gtIdx + 1);
      if (closeIdx === -1) return '';
      var raw = block.slice(gtIdx + 1, closeIdx);
      if (raw.indexOf('<![CDATA[') !== -1) {
        raw = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
      }
      return decodeEntities(raw.trim());
    }

    function parseXMLTV(xmlText, channels, catchupDays, epgOffsetMin) {
      var nowSec = Math.floor(Date.now() / 1000);
      var days = Math.max(1, Number(catchupDays) || 3);
      var minEndSec = nowSec - Math.round((days + 0.5) * 86400);
      var maxStartSec = nowSec + 36 * 3600;
      var offsetSec = (Number(epgOffsetMin) || 0) * 60;

      // Map XMLTV channel IDs -> our playlist channel bucket keys (tvgId or normName)
      var exactIdMap = Object.create(null);
      var normNameMap = Object.create(null);

      for (var i = 0; i < channels.length; i++) {
        var ch = channels[i];
        var bucket = ch.tvgId || ('norm:' + ch.normName);
        if (ch.tvgId) {
          exactIdMap[ch.tvgId] = bucket;
          exactIdMap[ch.tvgId.toLowerCase()] = bucket;
        }
        if (ch.tvgName) {
          var nt = normalizeKey(ch.tvgName);
          if (nt && !normNameMap[nt]) normNameMap[nt] = bucket;
        }
        if (ch.normName && !normNameMap[ch.normName]) {
          normNameMap[ch.normName] = bucket;
        }
      }

      // Pass 1: Scan <channel id="..."> blocks to link display-name aliases to playlist buckets
      var cPos = 0;
      while (true) {
        var cStart = xmlText.indexOf('<channel ', cPos);
        if (cStart === -1) break;
        var cEnd = xmlText.indexOf('</channel>', cStart + 9);
        if (cEnd === -1) break;
        cPos = cEnd + 10;

        var cHeadEnd = xmlText.indexOf('>', cStart + 8);
        if (cHeadEnd === -1 || cHeadEnd > cEnd) continue;
        var xmlChId = decodeEntities(extractAttr(xmlText.slice(cStart, cHeadEnd + 1), 'id'));
        if (!xmlChId) continue;

        if (!exactIdMap[xmlChId] && !exactIdMap[xmlChId.toLowerCase()]) {
          var cBody = xmlText.slice(cHeadEnd + 1, cEnd);
          var disp = extractTagText(cBody, 'display-name');
          if (disp) {
            var nd = normalizeKey(disp);
            if (nd && normNameMap[nd]) {
              exactIdMap[xmlChId] = normNameMap[nd];
              exactIdMap[xmlChId.toLowerCase()] = normNameMap[nd];
            }
          }
        }
      }

      // Pass 2: Fast zero-DOM scan of <programme ...>...</programme>
      var epgByBucket = Object.create(null);
      var totalMatched = 0;
      var pPos = 0;

      while (true) {
        var pStart = xmlText.indexOf('<programme ', pPos);
        if (pStart === -1) break;
        var pHeadEnd = xmlText.indexOf('>', pStart + 11);
        if (pHeadEnd === -1) break;
        var pClose = xmlText.indexOf('</programme>', pHeadEnd + 1);
        if (pClose === -1) break;
        pPos = pClose + 12;

        var head = xmlText.slice(pStart + 10, pHeadEnd);
        var rawCh = extractAttr(head, 'channel');
        if (!rawCh) continue;

        var bucketKey =
          exactIdMap[rawCh] ||
          exactIdMap[rawCh.toLowerCase()] ||
          (rawCh.indexOf('&') !== -1 ? exactIdMap[decodeEntities(rawCh)] : '') ||
          normNameMap[normalizeKey(rawCh)];

        if (!bucketKey) continue;

        var startSec = parseXmltvTimeFast(extractAttr(head, 'start')) + offsetSec;
        var stopSec = parseXmltvTimeFast(extractAttr(head, 'stop')) + offsetSec;
        if (!startSec || !stopSec || stopSec <= startSec) continue;
        if (stopSec < minEndSec || startSec > maxStartSec) continue;

        var body = xmlText.slice(pHeadEnd + 1, pClose);
        var title = extractTagText(body, 'title') || 'Program';
        var desc = extractTagText(body, 'desc');
        if (desc.length > 260) desc = desc.slice(0, 257) + '...';

        var arr = epgByBucket[bucketKey];
        if (!arr) {
          arr = [];
          epgByBucket[bucketKey] = arr;
        }
        arr.push({ s: startSec, e: stopSec, t: title, d: desc });
        totalMatched++;
      }

      // Sort each channel schedule by start timestamp and deduplicate exact start collisions
      var keys = Object.keys(epgByBucket);
      for (var k = 0; k < keys.length; k++) {
        var list = epgByBucket[keys[k]];
        list.sort(function (a, b) {
          return a.s - b.s;
        });
      }

      return {
        epgByBucket: epgByBucket,
        totalPrograms: totalMatched,
        matchedChannels: keys.length
      };
    }

    return {
      normalizeKey: normalizeKey,
      parseM3U: parseM3U,
      parseXMLTV: parseXMLTV
    };
  }

  var localCore = createParserCore();

  // Yield helper per modern-web-guidance `performance` (`scheduler.yield()` with setTimeout fallback)
  function yieldToMain() {
    if (typeof scheduler !== 'undefined' && typeof scheduler.yield === 'function') {
      return scheduler.yield();
    }
    return new Promise(function (resolve) {
      setTimeout(resolve, 0);
    });
  }

  // Create Blob Worker so heavy M3U/EPG parsing runs 100% off the TV UI thread (works on file:// in .wgt and http://)
  var workerInstance = null;
  var reqSeq = 0;
  var pendingReqs = Object.create(null);

  function getWorker() {
    if (workerInstance !== null) return workerInstance;
    if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined') {
      workerInstance = false;
      return false;
    }
    try {
      var workerCode =
        'var core = (' + createParserCore.toString() + ')();\n' +
        'self.onmessage = function(ev) {\n' +
        '  var msg = ev.data;\n' +
        '  try {\n' +
        '    if (msg.type === "parseM3U") {\n' +
        '      var res = core.parseM3U(msg.text, msg.catchupDays);\n' +
        '      self.postMessage({ id: msg.id, ok: true, result: res });\n' +
        '    } else if (msg.type === "parseXMLTV") {\n' +
        '      var res2 = core.parseXMLTV(msg.xmlText, msg.channels, msg.catchupDays, msg.epgOffsetMin);\n' +
        '      self.postMessage({ id: msg.id, ok: true, result: res2 });\n' +
        '    }\n' +
        '  } catch (err) {\n' +
        '    self.postMessage({ id: msg.id, ok: false, error: String(err && err.message || err) });\n' +
        '  }\n' +
        '};';
      var blob = new Blob([workerCode], { type: 'application/javascript' });
      var w = new Worker(URL.createObjectURL(blob));
      w.onmessage = function (ev) {
        var data = ev.data;
        var entry = pendingReqs[data.id];
        if (!entry) return;
        delete pendingReqs[data.id];
        if (data.ok) entry.resolve(data.result);
        else entry.reject(new Error(data.error || 'Worker error'));
      };
      w.onerror = function () {
        workerInstance = false;
      };
      workerInstance = w;
      return w;
    } catch (_) {
      workerInstance = false;
      return false;
    }
  }

  function runInWorker(type, payload, fallbackFn) {
    var w = getWorker();
    if (!w) {
      return yieldToMain().then(fallbackFn);
    }
    return new Promise(function (resolve, reject) {
      var id = ++reqSeq;
      pendingReqs[id] = { resolve: resolve, reject: reject };
      payload.id = id;
      payload.type = type;
      w.postMessage(payload);
    });
  }

  function parseM3UAsync(text, catchupDays) {
    return runInWorker(
      'parseM3U',
      { text: text, catchupDays: catchupDays },
      function () {
        return localCore.parseM3U(text, catchupDays);
      }
    );
  }

  function parseXMLTVAsync(xmlText, channels, catchupDays, epgOffsetMin) {
    // Strip channels down to lightweight matching metadata before structured cloning to Worker
    var slimChannels = channels.map(function (c) {
      return {
        tvgId: c.tvgId,
        tvgName: c.tvgName,
        normName: c.normName
      };
    });
    return runInWorker(
      'parseXMLTV',
      {
        xmlText: xmlText,
        channels: slimChannels,
        catchupDays: catchupDays,
        epgOffsetMin: epgOffsetMin
      },
      function () {
        return localCore.parseXMLTV(xmlText, slimChannels, catchupDays, epgOffsetMin);
      }
    );
  }

  // Decompress gzipped ArrayBuffer if magic bytes 0x1f 0x8b are present (supports .xml.gz EPG feeds on 2017+ TVs!)
  function decodeBufferSmart(buffer) {
    var bytes = new Uint8Array(buffer);
    if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
      if (typeof DecompressionStream !== 'undefined') {
        var ds = new DecompressionStream('gzip');
        var stream = new Blob([bytes]).stream().pipeThrough(ds);
        return new Response(stream).text();
      }
      if (global.pako && typeof global.pako.ungzip === 'function') {
        try {
          var inflated = global.pako.ungzip(bytes);
          if (typeof inflated === 'string') return Promise.resolve(inflated);
          bytes = inflated;
        } catch (gzErr) {
          return Promise.reject(new Error('Gzip EPG decode failed: ' + gzErr));
        }
      }
    }
    if (typeof TextDecoder !== 'undefined') {
      return Promise.resolve(new TextDecoder('utf-8').decode(bytes));
    }
    var out = '';
    var chunk = 8192;
    for (var i = 0; i < bytes.length; i += chunk) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(bytes.length, i + chunk)));
    }
    try {
      return Promise.resolve(decodeURIComponent(escape(out)));
    } catch (_) {
      return Promise.resolve(out);
    }
  }

  function canUseLocalProxy() {
    var proto = global.location && global.location.protocol;
    return proto === 'http:' || proto === 'https:';
  }

  // Universal binary XHR loader with transient-error retry (handles TV Wi-Fi wake hiccups cleanly)
  function xhrArrayBufferOnce(url) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.responseType = 'arraybuffer';
      xhr.timeout = 55000;
      xhr.onload = function () {
        if ((xhr.status >= 200 && xhr.status < 300) || (xhr.status === 0 && xhr.response)) {
          resolve(xhr.response);
        } else {
          reject(new Error('HTTP ' + xhr.status));
        }
      };
      xhr.onerror = function () {
        reject(new Error('Network / CORS error'));
      };
      xhr.ontimeout = function () {
        reject(new Error('Request timed out'));
      };
      xhr.send();
    });
  }

  function xhrArrayBuffer(url) {
    return xhrArrayBufferOnce(url).catch(function (firstErr) {
      return new Promise(function (resolve) {
        setTimeout(resolve, 800);
      }).then(function () {
        return xhrArrayBufferOnce(url).catch(function () {
          throw firstErr;
        });
      });
    });
  }

  function fetchTextSmart(url, useProxyPref) {
    var targetUrl = url;
    if (useProxyPref && canUseLocalProxy() && /^https?:\/\//i.test(url)) {
      targetUrl = '/proxy?url=' + encodeURIComponent(url);
    }

    return xhrArrayBuffer(targetUrl)
      .catch(function (err) {
        if (!useProxyPref && canUseLocalProxy() && /^https?:\/\//i.test(url)) {
          return xhrArrayBuffer('/proxy?url=' + encodeURIComponent(url));
        }
        throw err;
      })
      .then(decodeBufferSmart);
  }

  function getChannelBucketKey(channel) {
    if (!channel) return '';
    return channel.tvgId || ('norm:' + channel.normName);
  }

  // O(log N) binary search for program airing at `timestampSec`
  function findProgramIndexAt(programs, timestampSec) {
    if (!programs || !programs.length) return -1;
    var lo = 0;
    var hi = programs.length - 1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      var p = programs[mid];
      if (timestampSec < p.s) {
        hi = mid - 1;
      } else if (timestampSec >= p.e) {
        lo = mid + 1;
      } else {
        return mid;
      }
    }
    return -1;
  }

  NS.Parser = {
    normalizeKey: localCore.normalizeKey,
    parseM3UAsync: parseM3UAsync,
    parseXMLTVAsync: parseXMLTVAsync,
    decodeBufferSmart: decodeBufferSmart,
    fetchTextSmart: fetchTextSmart,
    getChannelBucketKey: getChannelBucketKey,
    findProgramIndexAt: findProgramIndexAt,
    yieldToMain: yieldToMain
  };
})(window);
