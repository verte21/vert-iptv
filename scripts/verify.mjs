import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

let simulatedWgtPrivateFile = '';

// Minimal browser-like global context to load our modular scripts directly
const sandbox = {
  window: {},
  console,
  Date,
  Math,
  Set,
  Number,
  String,
  Array,
  Object,
  RegExp,
  Promise,
  encodeURIComponent,
  parseInt,
  isNaN,
  isFinite,
  setTimeout,
  clearTimeout,
  TextDecoder,
  Uint8Array,
  localStorage: {
    _map: new Map(),
    getItem(k) { return this._map.has(k) ? this._map.get(k) : null; },
    setItem(k, v) { this._map.set(k, String(v)); },
    clear() { this._map.clear(); }
  },
  tizen: {
    filesystem: {
      resolve(loc, ok) {
        if (loc !== 'wgt-private') return;
        const fObj = {
          get fileSize() { return simulatedWgtPrivateFile.length; },
          openStream(mode, cb) {
            cb({
              write(txt) { simulatedWgtPrivateFile = txt; },
              read() { return simulatedWgtPrivateFile; },
              close() {}
            });
          }
        };
        ok({
          resolve() { return fObj; },
          createFile() { return fObj; }
        });
      }
    }
  }
};
sandbox.window = sandbox;
vm.createContext(sandbox);

for (const rel of ['vendor/pako_inflate.min.js', 'js/storage.js', 'js/catchup.js', 'js/parser.js', 'js/demo-data.js']) {
  const code = fs.readFileSync(path.join(rootDir, rel), 'utf8');
  vm.runInContext(code, sandbox, { filename: rel });
}

const { Storage, Catchup, Parser, DemoData } = sandbox.vertIPTV;

async function run() {
  console.log('1. Testing M3U parser + x-tvg-url + catchup attributes...');
  const sampleM3u = `#EXTM3U x-tvg-url="http://epg.example.com/guide.xml.gz" catchup="shift" catchup-days="3"
#EXTINF:-1 tvg-id="tvp1.pl" tvg-name="TVP 1 HD" tvg-logo="http://img/1.png" group-title="Poland",TVP 1 HD
http://panel.example.com:8080/live/demo_user/secret123/101.ts
#EXTINF:-1 tvg-id="" group-title="Sports" catchup="flussonic" catchup-days="5",Polsat Sport Premium 1
http://fluss.example.com/polsatsport1/index.m3u8
#EXTINF:-1 tvg-id="custom.ch" catchup="default" catchup-source="https://arch.example.com/ch/{channel_id}/play.m3u8?s={utc}&d={duration:60}",Custom Archive TV
https://arch.example.com/ch/custom.ch/live.m3u8
`;

  const parsed = await Parser.parseM3UAsync(sampleM3u, 3);
  assert.equal(parsed.headerEpgUrls[0], 'http://epg.example.com/guide.xml.gz');
  assert.equal(parsed.channels.length, 3);
  assert.equal(parsed.channels[0].name, 'TVP 1 HD');
  assert.equal(parsed.channels[0].catchupDays, 3);
  assert.equal(parsed.channels[1].catchupDays, 5);
  assert.equal(parsed.channels[1].catchupType, 'flussonic');

  console.log('2. Benchmarking 10,000-channel M3U parse speed...');
  const bigLines = ['#EXTM3U'];
  for (let i = 1; i <= 10000; i++) {
    bigLines.push(`#EXTINF:-1 tvg-id="ch${i}" group-title="Group ${i % 25}",Channel ${i} FHD`);
    bigLines.push(`http://cdn.example.com/live/user/pass/${i}.ts`);
  }
  const t0 = performance.now();
  const bigParsed = await Parser.parseM3UAsync(bigLines.join('\n'), 3);
  const dt = performance.now() - t0;
  assert.equal(bigParsed.channels.length, 10000);
  console.log(`   ✓ Parsed 10,000 channels in ${dt.toFixed(1)} ms`);

  console.log('3. Testing 3-day XMLTV EPG parser (timezone math + display-name matching + window pruning)...');
  const nowSec = Math.floor(Date.now() / 1000);
  const fmtXmlTime = (sec) => {
    const d = new Date(sec * 1000);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}00 +0000`;
  };

  const twoDaysAgo = nowSec - 2 * 86400;
  const sixDaysAgo = nowSec - 6 * 86400; // Should be pruned for 3-day window!
  const xmlSample = `<?xml version="1.0" encoding="UTF-8"?>
<tv>
  <channel id="tvp1.pl"><display-name>TVP 1</display-name></channel>
  <channel id="xml.sport.alias"><display-name>Polsat Sport Premium 1</display-name></channel>
  <programme start="${fmtXmlTime(sixDaysAgo)}" stop="${fmtXmlTime(sixDaysAgo + 3600)}" channel="tvp1.pl">
    <title>Too Old Program (6d ago)</title>
  </programme>
  <programme start="${fmtXmlTime(twoDaysAgo)}" stop="${fmtXmlTime(twoDaysAgo + 3600)}" channel="tvp1.pl">
    <title>Wiadomości &amp; Sport (2d ago)</title>
    <desc>Evening replay edition</desc>
  </programme>
  <programme start="${fmtXmlTime(nowSec - 900)}" stop="${fmtXmlTime(nowSec + 2700)}" channel="tvp1.pl">
    <title>Live Match Now</title>
  </programme>
  <programme start="${fmtXmlTime(nowSec - 1800)}" stop="${fmtXmlTime(nowSec + 1800)}" channel="xml.sport.alias">
    <title>Champions League Studio</title>
  </programme>
</tv>`;

  const epgRes = await Parser.parseXMLTVAsync(xmlSample, parsed.channels, 3, 0);
  assert.equal(epgRes.totalPrograms, 3, '6-day-old show must be pruned, 3 valid shows kept');
  const tvpSchedule = epgRes.epgByBucket['tvp1.pl'];
  assert.equal(tvpSchedule.length, 2);
  assert.equal(tvpSchedule[0].t, 'Wiadomości & Sport (2d ago)');
  const liveIdx = Parser.findProgramIndexAt(tvpSchedule, nowSec);
  assert.equal(tvpSchedule[liveIdx].t, 'Live Match Now');

  // Verify display-name fallback matched Polsat Sport Premium 1 even though tvg-id was empty in M3U!
  const sportBucket = Parser.getChannelBucketKey(parsed.channels[1]);
  assert.equal(epgRes.epgByBucket[sportBucket].length, 1);
  assert.equal(epgRes.epgByBucket[sportBucket][0].t, 'Champions League Studio');

  console.log('4. Testing Catchup URL builders (Xtream / Flussonic / Custom Template / Shift)...');
  const start = 1794164400; // deterministic epoch
  const end = start + 3600;

  // Xtream auto-detected from M3U live URL
  const xcUrls = Catchup.buildCatchupCandidates(parsed.channels[0], start, end, { catchupMode: 'auto' });
  assert.ok(xcUrls.some((u) => u.includes('/timeshift/demo_user/secret123/60/') && u.endsWith('/101.ts')));
  assert.ok(xcUrls.some((u) => u.includes('/streaming/timeshift.php?username=demo_user')));

  // Flussonic
  const flUrls = Catchup.buildCatchupCandidates(parsed.channels[1], start, end, { catchupMode: 'auto' });
  assert.equal(flUrls[0], `http://fluss.example.com/polsatsport1/index-${start}-3600.m3u8`);

  // Custom catchup-source template
  const customUrls = Catchup.buildCatchupCandidates(parsed.channels[2], start, end, { catchupMode: 'auto' });
  assert.equal(customUrls[0], `https://arch.example.com/ch/custom.ch/play.m3u8?s=${start}&d=60`);

  // Demo bundle sanity
  const demo = DemoData.buildDemoBundle();
  assert.equal(demo.channels.length, 5);
  assert.ok(demo.epgByBucket['demo.info24'].length > 40);

  console.log('5. Testing Samsung wgt-private persistence recovery + 2017 pako .xml.gz EPG decompression...');
  Storage.saveSettings({ m3uUrl: 'http://my.tv/list.m3u', epgUrl: 'http://my.tv/epg.xml.gz' });
  // Simulate Smart Hub wiping WebView localStorage after TV power loss!
  sandbox.localStorage.clear();
  const recovered = await Storage.loadSettingsGuaranteed();
  assert.equal(recovered.m3uUrl, 'http://my.tv/list.m3u');
  assert.equal(recovered.epgUrl, 'http://my.tv/epg.xml.gz');

  // Test Parser.decodeBufferSmart on real .xml.gz payload (no DecompressionStream, matching 2017 Tizen 3.0!)
  const gzBuf = zlib.gzipSync(Buffer.from(xmlSample, 'utf8'));
  const ungzXml = await Parser.decodeBufferSmart(gzBuf);
  assert.ok(ungzXml.includes('Champions League Studio'));

  console.log('6. Regression test: TiviMate raw .ts demuxing & zero infinite blink loops on codec/segment failure...');
  {
    let fakeNow = 50000;
    const q = [];
    let tid = 1;
    const setT = (fn, ms) => {
      const id = tid++;
      q.push({ id, due: fakeNow + (ms || 0), fn });
      q.sort((a, b) => a.due - b.due);
      return id;
    };
    const clrT = (id) => {
      const i = q.findIndex((x) => x.id === id);
      if (i !== -1) q.splice(i, 1);
    };

    let hlsLoads = 0;
    let mpegtsLoads = 0;
    const states = [];

    class MockHls {
      static isSupported() { return true; }
      static get Events() { return { MANIFEST_PARSED: 'mp', ERROR: 'err' }; }
      static get ErrorTypes() { return { MEDIA_ERROR: 'media', NETWORK_ERROR: 'net' }; }
      constructor() { this.h = {}; }
      on(e, fn) { this.h[e] = fn; }
      loadSource() {
        hlsLoads++;
        setT(() => {
          this.h.mp && this.h.mp();
          setT(() => {
            this.h.err && this.h.err('err', { fatal: true, type: 'media', details: 'bufferAddCodecError' });
          }, 40);
        }, 10);
      }
      attachMedia() {}
      swapAudioCodec() {}
      recoverMediaError() {
        setT(() => {
          this.h.err && this.h.err('err', { fatal: true, type: 'media', details: 'bufferAddCodecError' });
        }, 20);
      }
      startLoad() {
        hlsLoads++;
        setT(() => {
          this.h.err && this.h.err('err', { fatal: true, type: 'net', details: 'fragLoadError' });
        }, 20);
      }
      destroy() {}
    }

    const mockMpegts = {
      isSupported: () => true,
      Events: { ERROR: 'error' },
      createPlayer(cfg) {
        let errHandler = null;
        return {
          on(ev, fn) { if (ev === 'error') errHandler = fn; },
          attachMediaElement() {},
          load() {
            mpegtsLoads++;
            if (cfg && cfg.url && cfg.url.includes('777.m3u8')) {
              setT(() => { errHandler && errHandler('NetworkError', 'HttpStatusCodeInvalid'); }, 10);
            }
          },
          play() { return Promise.resolve(); },
          unload() {},
          detachMediaElement() {},
          destroy() {}
        };
      }
    };

    const pBox = {
      window: null,
      document: { addEventListener() {}, hidden: false },
      location: { protocol: 'http:', host: 'localhost:8787' },
      Hls: MockHls,
      mpegts: mockMpegts,
      Date: { now: () => fakeNow },
      Math, Number, String, Array, Object, RegExp, Promise, encodeURIComponent, isFinite,
      setTimeout: setT, clearTimeout: clrT, setInterval: () => 999, clearInterval: () => {},
      addEventListener() {}
    };
    pBox.window = pBox;
    vm.createContext(pBox);
    vm.runInContext(fs.readFileSync(path.join(rootDir, 'js/catchup.js'), 'utf8'), pBox);
    vm.runInContext(fs.readFileSync(path.join(rootDir, 'js/player.js'), 'utf8'), pBox);

    const fakeVid = {
      style: { display: 'none' }, muted: false, volume: 1, paused: false,
      removeAttribute() {}, load() {}, pause() {}, play() { return Promise.resolve(); }
    };
    const pl = pBox.vertIPTV.Player.createPlayer({
      avElement: { style: {} },
      videoElement: fakeVid,
      onState(s) { states.push(s); },
      onError(e) { states.push('ERR:' + e); }
    });

    // 6A: Codec failure after MANIFEST_PARSED must terminate cleanly, NOT blink `playing` <-> `buffering` 8+ times!
    pl.playLive({ url: 'http://provider.test:8080/live/u/p/777.m3u8' }, { preferEngine: 'auto' });
    let guard = 0;
    while (q.length && guard++ < 250 && fakeNow < 80000) {
      const n = q.shift();
      fakeNow = n.due;
      n.fn();
    }
    const playingEmits = states.filter((s) => s === 'playing').length;
    assert.ok(hlsLoads <= 16, `Expected bounded HLS retries (<=16), got ${hlsLoads}`);
    assert.ok(playingEmits <= 4, `Expected no infinite playing/buffering blink loop, got ${playingEmits} playing transitions`);

    // 6B: Raw TiviMate .ts channel uses mpegts.js directly in browser mode!
    pl.playLive({ url: 'http://provider.test:8080/live/u/p/101.ts' }, { preferEngine: 'auto' });
    while (q.length && guard++ < 300 && fakeNow < 85000) {
      const n = q.shift();
      fakeNow = n.due;
      n.fn();
    }
    assert.ok(mpegtsLoads >= 1, 'Expected raw .ts stream to play via mpegts.js');
  }

  console.log('7. Testing Samsung TV packaging, Public-tier privileges, SSSP size, and USB README safety...');
  {
    const cfgXml = fs.readFileSync(path.join(rootDir, 'config.xml'), 'utf8');
    assert.ok(!/\.partner"|privilege\/vpnservice|privilege\/drminfo|on-boot\s*=\s*"true"|auto-restart\s*=\s*"true"/i.test(cfgXml),
      'config.xml must strictly use Public-level Tizen privileges so standard certificates install on all retail TVs');

    const pkgJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
    assert.equal(pkgJson.packageType, 'app', 'package.json should include TizenBrew module metadata');
    assert.equal(pkgJson.appPath, 'index.html');

    // Verify USB loader ignores README-INSTALL.txt so it is never mistaken for a .txt M3U playlist
    const usbBox = {
      window: {},
      Promise,
      tizen: {
        filesystem: {
          listStorages(ok) { ok([{ type: 'EXTERNAL', state: 'MOUNTED', label: 'usb1' }]); },
          resolve(_label, ok) {
            ok({
              listFiles(cb) {
                cb([
                  { isFile: true, name: 'README-INSTALL.txt', fileSize: 100, openStream() { throw new Error('Should not read README'); } },
                  {
                    isFile: true,
                    name: 'iptv.json',
                    fileSize: 42,
                    openStream(_m, fn) { fn({ read: () => '{"m3uUrl":"http://ok.tv/list.m3u"}', close() {} }); }
                  }
                ]);
              }
            });
          }
        }
      }
    };
    usbBox.window = usbBox;
    vm.createContext(usbBox);
    vm.runInContext(fs.readFileSync(path.join(rootDir, 'js/usb-loader.js'), 'utf8'), usbBox);
    const usbScan = await usbBox.vertIPTV.UsbLoader.scanUsbPendrive();
    assert.equal(usbScan.found, true);
    assert.equal(usbScan.m3uName, '', 'README-INSTALL.txt must not be treated as an M3U playlist');
    assert.equal(usbScan.config.m3uUrl, 'http://ok.tv/list.m3u');

    const wgtPath = path.join(rootDir, 'dist', 'vertIPTV.wgt');
    const ssspXmlPath = path.join(rootDir, 'dist', 'usb-pendrive-root', 'SSSP', 'sssp_config.xml');
    if (fs.existsSync(wgtPath) && fs.existsSync(ssspXmlPath)) {
      const wgtBuf = fs.readFileSync(wgtPath);
      const wgtAscii = wgtBuf.toString('latin1');
      assert.ok(wgtAscii.includes('author-signature.xml') && wgtAscii.includes('signature1.xml'),
        'dist/vertIPTV.wgt must contain W3C author-signature.xml and signature1.xml');
      const ssspXml = fs.readFileSync(ssspXmlPath, 'utf8');
      const m = ssspXml.match(/<size>(\d+)<\/size>/);
      assert.ok(m && Number(m[1]) === wgtBuf.length, 'SSSP sssp_config.xml <size> must match exact .wgt byte length');
    }
  }

  console.log('8. Benchmarking 50,000-programme XMLTV (with unmatched channels)...');
  {
    const xmlBig = ['<?xml version="1.0" encoding="UTF-8"?><tv>'];
    const tStartStr = fmtXmlTime(nowSec - 1800);
    const tStopStr = fmtXmlTime(nowSec + 1800);
    for (let i = 1; i <= 50000; i++) {
      const chId = i % 3 === 0 ? `ch${(i % 500) + 1}` : `foreign.unmatched.${i % 1200}`;
      xmlBig.push(`<programme start="${tStartStr}" stop="${tStopStr}" channel="${chId}"><title>Show ${i}</title></programme>`);
    }
    xmlBig.push('</tv>');
    const tXml0 = performance.now();
    const bigEpg = await Parser.parseXMLTVAsync(xmlBig.join('\n'), bigParsed.channels, 3, 0);
    const dtXml = performance.now() - tXml0;
    assert.equal(bigEpg.totalPrograms, 16666);
    console.log(`   ✓ Parsed 50,000 XMLTV programmes (filtered 33,334 unmatched) in ${dtXml.toFixed(1)} ms`);
  }

  console.log('9. Testing Multi-Language UI dictionaries (EN / DE / PL) & persistence...');
  {
    const savedPl = Storage.saveSettings({ lang: 'pl' });
    assert.equal(savedPl.lang, 'pl');
    const savedDe = Storage.saveSettings({ lang: 'de' });
    assert.equal(savedDe.lang, 'de');
    const fallbackInvalid = Storage.saveSettings({ lang: 'invalid_code' });
    assert.equal(fallbackInvalid.lang, 'en');

    const appCode = fs.readFileSync(path.join(rootDir, 'js/app.js'), 'utf8');
    const i18nBox = {
      window: {},
      document: {
        readyState: 'loading',
        addEventListener() {},
        getElementById() { return null; },
        querySelectorAll() { return []; }
      }
    };
    i18nBox.window = i18nBox;
    vm.createContext(i18nBox);
    vm.runInContext(appCode, i18nBox, { filename: 'js/app.js' });
    const i18n = i18nBox.vertIPTV.I18n;
    assert.ok(i18n && i18n.en && i18n.de && i18n.pl, 'I18n must include en, de, and pl dictionaries');
    const enKeys = Object.keys(i18n.en);
    for (const k of enKeys) {
      assert.ok(i18n.de[k] !== undefined, `Missing German translation key: ${k}`);
      assert.ok(i18n.pl[k] !== undefined, `Missing Polish translation key: ${k}`);
    }
    assert.equal(i18n.en.today, 'Today');
    assert.equal(i18n.de.today, 'Heute');
    assert.equal(i18n.pl.today, 'Dzisiaj');
  }

  console.log('✅ All parser, 3-day EPG, catchup URL, Samsung wgt-private persistence, .xml.gz, anti-blink, TV installer, and EN/DE/PL i18n tests passed!');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
