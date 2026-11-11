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

  // Verify TiviMate-compatible per-channel timeshift availability (0d, 1d, 3d, 7d)
  const testNowSec = 1794350000;
  const chZero = { catchupDays: 0 };
  const chThree = { catchupDays: 3 };
  const chSeven = { catchupDays: 7 };
  assert.equal(Catchup.getChannelCatchupDays(chZero, { catchupDays: 3 }), 0);
  assert.equal(Catchup.getChannelCatchupDays(chThree, { catchupDays: 3 }), 3);
  assert.equal(Catchup.getChannelCatchupDays(chSeven, { catchupDays: 3 }), 3);
  assert.equal(Catchup.getChannelRawCatchupDays(chSeven, { catchupDays: 3 }), 7);
  // 80 hours ago (>72h, <168h): unavailable on 0d and 3d channels, available on 7d channel
  const prog80hAgo = { s: testNowSec - 80 * 3600, e: testNowSec - 79 * 3600 };
  assert.equal(Catchup.isProgramCatchupAvailable(chZero, prog80hAgo, testNowSec, { catchupDays: 3 }), false);
  assert.equal(Catchup.isProgramCatchupAvailable(chThree, prog80hAgo, testNowSec, { catchupDays: 3 }), false);
  assert.equal(Catchup.isProgramCatchupAvailable(chSeven, prog80hAgo, testNowSec, { catchupDays: 3 }), true);

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
    const savedPl = Storage.saveSettings({ lang: 'pl', catchupDays: 7 });
    assert.equal(savedPl.lang, 'pl');
    assert.equal(savedPl.catchupDays, 3, 'Storage must cap catchupDays at 3');
    assert.equal(Catchup.getChannelCatchupDays(parsed.channels[1], savedPl), 3, 'getChannelCatchupDays must cap at 3 days back');
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

  console.log('10. Testing Android TV Bridge (ExoPlayer playback, SharedPreferences recovery, USB scan, & APK)...');
  {
    const nativePrefs = new Map();
    let lastPlayedUrl = '';
    let lastPlayedLive = false;
    let pausedFlag = false;
    let mutedFlag = false;
    let volumePct = 80;

    const androidBox = {
      window: null,
      document: { addEventListener() {}, hidden: false },
      location: { protocol: 'file:', host: '' },
      Date, Math, Number, String, Array, Object, RegExp, Promise, Set, encodeURIComponent, isFinite,
      setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {},
      addEventListener() {},
      localStorage: {
        _m: new Map(),
        getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
        setItem(k, v) { this._m.set(k, String(v)); },
        clear() { this._m.clear(); }
      },
      AndroidTvBridge: {
        saveNativeState(k, v) { nativePrefs.set(k, String(v)); },
        loadNativeState(k) { return nativePrefs.get(k) || ''; },
        scanUsbDrives() {
          return JSON.stringify({
            available: true,
            found: true,
            label: 'USB_DRIVE_1',
            config: { m3uUrl: 'http://android-usb.tv/playlist.m3u', epgUrl: 'http://android-usb.tv/epg.xml.gz' },
            m3uText: '',
            m3uName: '',
            epgText: '',
            epgName: ''
          });
        },
        playStream(url, isLive) {
          lastPlayedUrl = url;
          lastPlayedLive = isLive;
          if (androidBox.__onAndroidPlayerEvent) {
            androidBox.__onAndroidPlayerEvent('buffering', '');
            androidBox.__onAndroidPlayerEvent('playing', '');
          }
        },
        stopStream() {},
        togglePause() {
          pausedFlag = !pausedFlag;
          return pausedFlag;
        },
        getCurrentPositionMs() { return 42000; },
        setMuted(m) { mutedFlag = !!m; },
        adjustVolume(step) {
          volumePct = Math.max(0, Math.min(100, volumePct + step * 10));
          return volumePct;
        },
        cycleAudioTrack() { return 'Polish (AC-3)'; }
      }
    };
    androidBox.window = androidBox;
    vm.createContext(androidBox);
    for (const rel of ['js/storage.js', 'js/catchup.js', 'js/usb-loader.js', 'js/player.js']) {
      vm.runInContext(fs.readFileSync(path.join(rootDir, rel), 'utf8'), androidBox, { filename: rel });
    }

    // 10A: SharedPreferences recovery when Android WebView localStorage is cleared
    androidBox.vertIPTV.Storage.saveSettings({ m3uUrl: 'http://shield.tv/live.m3u', epgUrl: 'http://shield.tv/epg.xml' });
    androidBox.localStorage.clear();
    const recAndroid = await androidBox.vertIPTV.Storage.loadSettingsGuaranteed();
    assert.equal(recAndroid.m3uUrl, 'http://shield.tv/live.m3u');
    assert.equal(recAndroid.epgUrl, 'http://shield.tv/epg.xml');

    // 10B: USB Pendrive scan via AndroidTvBridge
    assert.equal(androidBox.vertIPTV.UsbLoader.hasTizenFs(), true);
    const andUsb = await androidBox.vertIPTV.UsbLoader.scanUsbPendrive();
    assert.equal(andUsb.found, true);
    assert.equal(andUsb.config.m3uUrl, 'http://android-usb.tv/playlist.m3u');

    // 10C: Hardware ExoPlayer bridge playback, volume, mute, pause, and audio track cycling
    const pStates = [];
    const andPlayer = androidBox.vertIPTV.Player.createPlayer({
      avElement: { style: {} },
      videoElement: { style: {}, pause() {}, removeAttribute() {}, load() {} },
      onState(st) { pStates.push(st); }
    });
    andPlayer.playLive({ url: 'http://shield.tv:8080/live/u/p/505.ts' }, { preferEngine: 'auto' });
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(lastPlayedUrl, 'http://shield.tv:8080/live/u/p/505.ts');
    assert.equal(lastPlayedLive, true);
    assert.equal(andPlayer.getActiveEngine(), 'android');
    assert.ok(pStates.includes('playing'));
    assert.equal(andPlayer.togglePause(), true);
    assert.equal(andPlayer.adjustVolume(1), 90);
    assert.equal(andPlayer.toggleMute(), true);
    assert.equal(mutedFlag, true);
    assert.equal(andPlayer.cycleAudioTrack(), 'Polish (AC-3)');

    // 10D: Verify Android TV Manifest Leanback launcher & compiled APK
    const manifestXml = fs.readFileSync(path.join(rootDir, 'android-tv/app/src/main/AndroidManifest.xml'), 'utf8');
    assert.ok(manifestXml.includes('android.software.leanback'), 'AndroidManifest.xml must declare android.software.leanback');
    assert.ok(manifestXml.includes('android.intent.category.LEANBACK_LAUNCHER'), 'AndroidManifest.xml must include LEANBACK_LAUNCHER intent');

    const apkPath = path.join(rootDir, 'dist', 'vertIPTV-tv.apk');
    if (fs.existsSync(apkPath)) {
      const apkBuf = fs.readFileSync(apkPath);
      assert.ok(apkBuf.length > 500000, 'dist/vertIPTV-tv.apk should be a valid non-empty APK binary');
      assert.equal(apkBuf[0], 0x50, 'APK must start with ZIP magic byte P');
      assert.equal(apkBuf[1], 0x4b, 'APK must start with ZIP magic byte K');
    }
  }

  console.log('11. Testing Performance Optimizations (Worker search tokens, Singleton IDB, Live Buffer Cushion, & Streaming EPG Pruning)...');
  {
    // 11A: Worker-computed _lowerName and _numStr tokens in parseM3UAsync
    assert.equal(parsed.channels[0]._lowerName, 'tvp 1 hd');
    assert.equal(parsed.channels[0]._numStr, '1');
    assert.equal(parsed.channels[1]._lowerName, 'polsat sport premium 1');
    assert.equal(parsed.channels[1]._numStr, '2');

    // 11B: Singleton IndexedDB connection pooling in Storage (indexedDB.open called only once across multiple ops)
    let idbOpenCount = 0;
    let idbCloseCount = 0;
    const idbStore = new Map();
    const idbBox = {
      window: null,
      Promise,
      Object,
      String,
      Number,
      Boolean,
      Set,
      Array,
      Date,
      Math,
      localStorage: { getItem: () => null, setItem() {} },
      indexedDB: {
        open() {
          idbOpenCount++;
          const req = {};
          setTimeout(() => {
            req.result = {
              objectStoreNames: { contains: () => true },
              close() { idbCloseCount++; },
              transaction() {
                const tx = {
                  objectStore() {
                    return {
                      put(val, key) {
                        idbStore.set(key, val);
                        setTimeout(() => tx.oncomplete && tx.oncomplete(), 1);
                      },
                      get(key) {
                        const gReq = {};
                        setTimeout(() => {
                          gReq.result = idbStore.get(key);
                          gReq.onsuccess && gReq.onsuccess();
                        }, 1);
                        return gReq;
                      },
                      delete(key) {
                        idbStore.delete(key);
                        setTimeout(() => tx.oncomplete && tx.oncomplete(), 1);
                      }
                    };
                  }
                };
                return tx;
              }
            };
            req.onsuccess && req.onsuccess();
          }, 1);
          return req;
        }
      }
    };
    idbBox.window = idbBox;
    vm.createContext(idbBox);
    vm.runInContext(fs.readFileSync(path.join(rootDir, 'js/storage.js'), 'utf8'), idbBox);
    await idbBox.vertIPTV.Storage.saveSnapshot('active_playlist', { channels: [1, 2, 3] });
    await idbBox.vertIPTV.Storage.saveSnapshot('active_epg', { epgByBucket: { a: [] } });
    const snapLoaded = await idbBox.vertIPTV.Storage.loadSnapshot('active_playlist');
    assert.equal(snapLoaded.channels.length, 3);
    await idbBox.vertIPTV.Storage.clearSnapshots();
    assert.equal(idbOpenCount, 1, 'Expected singleton IDB connection to open only once across 4 operations');
    assert.equal(idbCloseCount, 0, 'Expected singleton IDB connection not to close after normal transactions');

    // 11C: Verify Android TV MainActivity live buffer cushion (2500ms / 4000ms), setMaxPlaybackSpeed(1.0f), DefaultAllocator, EPG pruning, & HE-AAC SBR audio fix
    const mainJava = fs.readFileSync(
      path.join(rootDir, 'android-tv/app/src/main/java/tv/vertiptv/app/MainActivity.java'),
      'utf8'
    );
    assert.ok(mainJava.includes('new DefaultAllocator(true, C.DEFAULT_BUFFER_SEGMENT_SIZE, 64)'), 'MainActivity must use pre-warmed DefaultAllocator');
    assert.ok(mainJava.includes('2500,\n                        4000'), 'MainActivity must use 2.5s initial / 4.0s rebuffer live cushion');
    assert.ok(mainJava.includes('.setMaxPlaybackSpeed(1.0f)'), 'MainActivity must lock live maxPlaybackSpeed to 1.0f so safety buffer is never drained');
    assert.ok(mainJava.includes('parseXmltvAttrEpochSec'), 'MainActivity must prune expired XMLTV programmes in Java streaming filter');
    assert.ok(mainJava.includes('DefaultRenderersFactory.EXTENSION_RENDERER_MODE_ON'), 'MainActivity must use EXTENSION_RENDERER_MODE_ON so MediaCodecAudioRenderer handles 24/48kHz HE-AAC SBR (Eska TV HD) while FfmpegAudioRenderer handles MP2/AC-3/E-AC-3/DTS');
    assert.ok(mainJava.includes('.setEnableFloatOutput(false)'), 'MainActivity must force 16-bit PCM AudioSink output for Android TV HDMI compatibility');
    assert.ok(mainJava.includes('DefaultTsPayloadReaderFactory.FLAG_DETECT_ACCESS_UNITS') && mainJava.includes('DefaultTsPayloadReaderFactory.FLAG_IGNORE_SPLICE_INFO_STREAM'), 'MainActivity must enable DVB TS access unit detection and ignore SCTE-35 splice streams');
    assert.ok(mainJava.includes('TsExtractor.TS_PACKET_SIZE * 1800'), 'MainActivity must use 1800 TS packets timestamp search window');
    assert.ok(mainJava.includes('.setConstrainAudioChannelCountToDeviceCapabilities(false)'), 'MainActivity must not reject multichannel audio tracks on stereo TVs');
    assert.ok(mainJava.includes('trySelectFallbackAudioTrack()'), 'MainActivity must attempt switching to an alternate audio track before reopening/disabling audio');
    assert.ok(mainJava.includes('streamErrorRetryStep == 0'), 'MainActivity must retry with audio enabled before falling back to video-only');

    // 11D: Verify OSD icon-only buttons & seek step buttons
    const indexHtml = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
    assert.ok(indexHtml.includes('id="osd-btn-playpause" type="button" class="osd-btn osd-btn--icon osd-btn--playpause"'), 'OSD play/pause button must be icon-only');
    assert.ok(!indexHtml.includes('id="osd-lbl-playpause"'), 'OSD play/pause button must not have visible text label');
    assert.ok(indexHtml.includes('<span>-30s</span>') && indexHtml.includes('<span>+30s</span>'), 'OSD seek buttons must keep step text (-30s / +30s)');
  }

  console.log('✅ All parser, 3-day EPG, catchup URL, Samsung wgt-private, Android TV ExoPlayer bridge, .xml.gz, anti-blink, TV installer, and EN/DE/PL i18n tests passed!');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
