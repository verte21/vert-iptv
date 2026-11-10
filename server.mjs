import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
let FFMPEG_BIN = '';
try {
  FFMPEG_BIN = require('ffmpeg-static') || '';
} catch {
  FFMPEG_BIN = '';
}
const PORT = Number(process.env.PORT) || 8787;
const DEMO_ONLY = process.env.VERT_DEMO_ONLY === '1';
const LOCAL_CONFIG_PATH = path.join(__dirname, '.local-config.json');

let remoteConfig = {
  m3uUrl: '',
  epgUrl: '',
  catchupMode: 'auto',
  catchupDays: 3,
  epgOffsetMin: 0,
  updatedAt: 0
};

try {
  if (!DEMO_ONLY && fs.existsSync(LOCAL_CONFIG_PATH)) {
    const saved = JSON.parse(fs.readFileSync(LOCAL_CONFIG_PATH, 'utf8'));
    remoteConfig = { ...remoteConfig, ...saved };
  }
} catch {}

function persistRemoteConfig() {
  try {
    fs.writeFileSync(LOCAL_CONFIG_PATH, JSON.stringify(remoteConfig, null, 2), 'utf8');
  } catch {}
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.png': 'image/png',
  '.m3u': 'audio/x-mpegurl; charset=utf-8',
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.wgt': 'application/octet-stream'
};

const IPV4_RE = /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
let activeTvJob = false;

function renderTvInstallerHtml() {
  const hostIp = getLanIp();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>1-Click Samsung TV Installer | vertIPTV</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0; padding: 1.5rem;
      background: #070b14; color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      line-height: 1.5;
    }
    header, main { max-width: 780px; margin: 0 auto; }
    nav ul {
      display: flex; flex-wrap: wrap; gap: 0.75rem;
      list-style: none; padding: 0; margin: 0 0 1.25rem;
    }
    nav a {
      color: #22d3ee; text-decoration: none; font-size: 0.9rem; font-weight: 600;
      padding: 0.35rem 0.7rem; border-radius: 6px; background: rgba(34,211,238,0.1);
    }
    :where(a:any-link, button, input):focus-visible {
      outline: 3px solid #22d3ee;
      outline-offset: 3px;
    }
    .card {
      margin-bottom: 1.25rem; padding: 1.4rem;
      background: #0f172a; border: 1px solid rgba(34,211,238,0.3); border-radius: 14px;
    }
    h1 { margin: 0 0 0.35rem; font-size: 1.5rem; }
    h2 { margin: 0 0 0.6rem; font-size: 1.12rem; color: #e2e8f0; }
    p { margin: 0 0 0.9rem; color: #cbd5e1; font-size: 0.94rem; }
    ol { margin: 0.4rem 0 0.9rem 1.25rem; padding: 0; color: #cbd5e1; font-size: 0.92rem; }
    li { margin-bottom: 0.35rem; }
    code {
      background: #060a12; color: #67e8f9; padding: 0.15rem 0.45rem;
      border-radius: 5px; font-size: 0.9rem; border: 1px solid #1e293b;
    }
    label { display: block; font-weight: 700; font-size: 0.92rem; color: #f1f5f9; margin-bottom: 0.2rem; }
    .hint { display: block; font-size: 0.84rem; color: #94a3b8; margin-bottom: 0.45rem; }
    input {
      width: 100%; padding: 0.7rem 0.85rem; margin-bottom: 0.9rem;
      background: #060a12; color: #f8fafc; border: 1px solid #475569; border-radius: 8px; font-size: 0.96rem;
    }
    .btn-row { display: flex; flex-wrap: wrap; gap: 0.65rem; }
    button, .btn-link {
      min-height: 40px; padding: 0.65rem 1.1rem;
      background: #0891b2; color: #ffffff; font-weight: 700; font-size: 0.95rem;
      border: none; border-radius: 8px; cursor: pointer; text-decoration: none;
      display: inline-flex; align-items: center; justify-content: center;
    }
    button.secondary, .btn-link.secondary { background: #1e293b; border: 1px solid #475569; color: #f8fafc; }
    button:disabled { opacity: 0.55; cursor: not-allowed; }
    progress { width: 100%; height: 10px; margin-top: 0.9rem; accent-color: #22d3ee; }
    .status-banner {
      margin-top: 0.85rem; padding: 0.65rem 0.85rem; border-radius: 8px;
      background: #060a12; border: 1px solid #334155; color: #67e8f9; font-weight: 600; font-size: 0.92rem;
    }
    .status-banner:empty { display: none; }
    pre {
      margin: 0.85rem 0 0; padding: 0.9rem; max-height: 300px; overflow: auto;
      background: #04070d; color: #e2e8f0; border: 1px solid #1e293b; border-radius: 8px;
      font-size: 0.83rem; white-space: pre-wrap; word-break: break-word;
    }
    .tv-pill {
      display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;
      padding: 0.65rem 0.85rem; margin-top: 0.6rem; border-radius: 8px;
      background: #060a12; border: 1px solid rgba(34,211,238,0.4);
    }
  </style>
</head>
<body>
  <header>
    <nav aria-label="Primary">
      <ul role="list">
        <li><a href="/install">1-Click TV Installer</a></li>
        <li><a href="/remote">Remote Playlist Push</a></li>
        <li><a href="/simulator">TV Simulator</a></li>
        <li><a href="/">Launch Browser Player</a></li>
      </ul>
    </nav>
  </header>
  <main id="main-content">
    <div class="card">
      <h1>1-Click Samsung TV Installer</h1>
      <p>No Tizen Studio, Java, or USB package tools needed. Builds, cryptographically signs, pushes, and launches <strong>vertIPTV</strong> directly onto any 2015–2026 Samsung Tizen TV over Wi-Fi.</p>
      <h2>Step 1: One-Time TV Developer Mode Check</h2>
      <ol>
        <li>Open <strong>Apps</strong> on your Samsung TV.</li>
        <li>Press <code>12345</code> on your remote (on 2024–2026 Tizen 8/9/10 TVs: highlight <strong>App Settings</strong> gear at the bottom of Apps first, then press <code>12345</code>).</li>
        <li>Toggle <strong>Developer Mode</strong> to <strong>ON</strong> and set <strong>Host PC IP</strong> to this computer: <code>${hostIp}</code></li>
        <li>Hold the TV remote <strong>Power</strong> button for 3 seconds until the TV reboots.</li>
      </ol>
    </div>

    <div class="card">
      <h2>Step 2: Scan &amp; Install to Samsung TV</h2>
      <label for="tv-ip">Samsung TV IPv4 Address (optional)</label>
      <span id="tv-ip-hint" class="hint">Leave blank to auto-discover your Samsung TV on Wi-Fi (${hostIp}), or click Scan Wi-Fi first.</span>
      <input id="tv-ip" type="text" inputmode="decimal" aria-describedby="tv-ip-hint" placeholder="Auto-detect on Wi-Fi (e.g. 192.168.1.105)">
      <div id="tv-list"></div>
      <div class="btn-row" style="margin-top:0.75rem">
        <button id="btn-install" type="button">Build, Sign &amp; Install to Samsung TV</button>
        <button id="btn-scan" type="button" class="secondary">Scan Wi-Fi for TVs</button>
        <button id="btn-arm" type="button" class="secondary">Arm On-TV Uploader (TV-Store)</button>
      </div>
      <progress id="job-progress" hidden aria-label="Installation in progress"></progress>
      <div id="job-status" class="status-banner" role="status" aria-live="polite"></div>
      <pre id="job-log" hidden></pre>
    </div>

    <div class="card">
      <h2>Direct Build &amp; USB Playlist Downloads</h2>
      <p>Retail Samsung TVs block unsigned USB <code>.wgt</code> installation, so use the 1-Click button above to install the app once. You can still drop <code>iptv.json</code> onto a FAT32 USB stick for 1-click playlist import, or upload <code>vertIPTV.wgt</code> to <code>http://&lt;TV_IP&gt;:8077/upload</code> after arming TV-Store.</p>
      <div class="btn-row">
        <a class="btn-link secondary" href="/download/vertIPTV.wgt" download="vertIPTV.wgt">Download Signed vertIPTV.wgt</a>
        <a class="btn-link secondary" href="/download/iptv.json" download="iptv.json">Download USB iptv.json</a>
      </div>
    </div>
  </main>

  <script>
    const ipInput = document.getElementById('tv-ip');
    const tvListEl = document.getElementById('tv-list');
    const logEl = document.getElementById('job-log');
    const statusEl = document.getElementById('job-status');
    const progressEl = document.getElementById('job-progress');
    const buttons = [
      document.getElementById('btn-install'),
      document.getElementById('btn-scan'),
      document.getElementById('btn-arm')
    ];

    function setBusy(busy) {
      for (const b of buttons) b.disabled = busy;
      progressEl.hidden = !busy;
    }

    async function runStreamJob(endpoint, label) {
      setBusy(true);
      statusEl.textContent = '';
      logEl.hidden = false;
      logEl.textContent = '▶ ' + label + '...\\n';
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tvIp: ipInput.value.trim() })
        });
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let full = '';
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          const chunk = dec.decode(value, { stream: true });
          full += chunk;
          logEl.textContent += chunk;
          logEl.scrollTop = logEl.scrollHeight;
        }
        const ok = full.includes('[EXIT:0]');
        statusEl.textContent = ok
          ? '✓ Completed! vertIPTV is ready on your Samsung TV.'
          : '⚠ Action did not complete — check the log output and Developer Mode checklist above.';
      } catch (err) {
        statusEl.textContent = '⚠ Request failed: ' + err.message;
      } finally {
        setBusy(false);
      }
    }

    document.getElementById('btn-scan').addEventListener('click', async () => {
      setBusy(true);
      statusEl.textContent = '';
      tvListEl.replaceChildren();
      try {
        const res = await fetch('/api/tv/scan');
        const data = await res.json();
        const tvs = data.tvs || [];
        if (!tvs.length) {
          statusEl.textContent = 'No powered-on Samsung TVs responded on ' + (data.localIp || 'LAN') + '. Make sure your TV is ON.';
        } else {
          statusEl.textContent = 'Found ' + tvs.length + ' Samsung TV(s) on Wi-Fi.';
          for (const tv of tvs) {
            const ip = tv.ip || tv.address || '';
            const row = document.createElement('div');
            row.className = 'tv-pill';
            const info = document.createElement('span');
            info.textContent = (tv.name || tv.model || 'Samsung TV') + ' (' + ip + ')';
            const pickBtn = document.createElement('button');
            pickBtn.type = 'button';
            pickBtn.className = 'secondary';
            pickBtn.textContent = 'Select ' + ip;
            pickBtn.addEventListener('click', () => { ipInput.value = ip; });
            row.append(info, pickBtn);
            tvListEl.appendChild(row);
            if (!ipInput.value && ip) ipInput.value = ip;
          }
        }
      } catch (err) {
        statusEl.textContent = 'Scan error: ' + err.message;
      } finally {
        setBusy(false);
      }
    });

    document.getElementById('btn-install').addEventListener('click', () => {
      runStreamJob('/api/tv/install', 'Building, signing & installing vertIPTV to Samsung TV');
    });

    document.getElementById('btn-arm').addEventListener('click', () => {
      runStreamJob('/api/tv/arm-store', 'Installing & arming TV-Store (:8077/upload) on Samsung TV');
    });
  </script>
</body>
</html>`;
}

function streamDeployScript(req, res, extraArgs = []) {
  if (activeTvJob) {
    res.writeHead(409, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Another TV install task is already running.\n[EXIT:1]\n');
    return;
  }
  let body = '';
  req.on('data', (c) => {
    body += c;
    if (body.length > 8192) req.destroy();
  });
  req.on('end', () => {
    let tvIp = '';
    try {
      const parsed = JSON.parse(body || '{}');
      tvIp = String(parsed.tvIp || '').trim();
    } catch {}

    if (tvIp && !IPV4_RE.test(tvIp)) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Invalid IPv4 address format.\n[EXIT:1]\n');
      return;
    }

    activeTvJob = true;
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    });

    const args = [path.join(__dirname, 'scripts', 'deploy-tv.sh'), ...extraArgs];
    if (tvIp) args.push(tvIp);

    const child = spawn('bash', args, { cwd: __dirname, shell: false });
    child.stdout.on('data', (d) => res.write(d));
    child.stderr.on('data', (d) => res.write(d));
    child.on('close', (code) => {
      activeTvJob = false;
      res.end(`\n[EXIT:${code ?? 1}]\n`);
    });
    child.on('error', (err) => {
      activeTvJob = false;
      res.end(`\nProcess error: ${err.message}\n[EXIT:1]\n`);
    });
  });
}

function getLanIp() {
  if (DEMO_ONLY) return '192.168.1.50';
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return '127.0.0.1';
}

function renderRemoteSetupHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>vertIPTV — Remote Playlist Push</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0; padding: 1.5rem;
      background: #070b14; color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .card {
      max-width: 540px; margin: 1rem auto; padding: 1.5rem;
      background: #0f172a; border: 1px solid rgba(34,211,238,0.35); border-radius: 14px;
    }
    h1 { margin: 0 0 0.4rem; font-size: 1.35rem; }
    p { margin: 0 0 1.2rem; color: #94a3b8; font-size: 0.92rem; line-height: 1.45; }
    label { display: block; margin-bottom: 0.9rem; font-size: 0.88rem; font-weight: 600; color: #cbd5e1; }
    input, select {
      width: 100%; margin-top: 0.35rem; padding: 0.7rem 0.85rem;
      background: #060a12; color: #f8fafc; border: 1px solid #334155; border-radius: 8px; font-size: 0.95rem;
    }
    button {
      width: 100%; padding: 0.8rem; margin-top: 0.4rem;
      background: #0891b2; color: #fff; font-weight: 700; font-size: 1rem;
      border: none; border-radius: 8px; cursor: pointer;
    }
    .msg { margin-top: 0.9rem; color: #22d3ee; font-size: 0.9rem; font-weight: 600; }
  </style>
</head>
<body>
  <div class="card">
    <h1>vertIPTV Remote Setup</h1>
    <p>Paste your M3U and XMLTV EPG links below to push them straight to vertIPTV without typing on your Samsung TV remote.</p>
    <form id="f">
      <label>M3U Playlist URL
        <input id="m3u" type="url" required placeholder="http://provider.com/get.php?username=..." value="${remoteConfig.m3uUrl}">
      </label>
      <label>XMLTV EPG URL (optional if embedded in M3U)
        <input id="epg" type="url" placeholder="http://provider.com/xmltv.php?username=..." value="${remoteConfig.epgUrl}">
      </label>
      <label>Archive Days Back
        <select id="days">
          <option value="3" selected>3 Days Back</option>
          <option value="5">5 Days Back</option>
          <option value="7">7 Days Back</option>
        </select>
      </label>
      <button type="submit">Push Playlist to TV</button>
      <div id="msg" class="msg"></div>
    </form>
  </div>
  <script>
    document.getElementById('f').addEventListener('submit', async (e) => {
      e.preventDefault();
      const res = await fetch('/api/remote-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          m3uUrl: document.getElementById('m3u').value.trim(),
          epgUrl: document.getElementById('epg').value.trim(),
          catchupDays: Number(document.getElementById('days').value) || 3
        })
      });
      document.getElementById('msg').textContent = res.ok
        ? '✓ Sent! vertIPTV will sync automatically within a few seconds.'
        : 'Failed to save config.';
    });
  </script>
</body>
</html>`;
}

function rewriteHlsManifest(text, baseUrl) {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith('#')) {
        return line.replace(/URI="([^"]+)"/g, (_, uri) => {
          const abs = new URL(uri, baseUrl).toString();
          return `URI="/proxy?hls=1&url=${encodeURIComponent(abs)}"`;
        });
      }
      const abs = new URL(trimmed, baseUrl).toString();
      return `/proxy?hls=1&url=${encodeURIComponent(abs)}`;
    })
    .join('\n');
}

function proxyRequest(targetUrl, res, rewriteHls = false, redirectsLeft = 4) {
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Invalid URL');
    return;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Unsupported protocol');
    return;
  }

  const client = parsed.protocol === 'https:' ? https : http;
  const upstreamReq = client.get(
    parsed,
    {
      headers: {
        'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20',
        Accept: '*/*'
      }
    },
    (upstreamRes) => {
      if (
        upstreamRes.statusCode &&
        upstreamRes.statusCode >= 300 &&
        upstreamRes.statusCode < 400 &&
        upstreamRes.headers.location &&
        redirectsLeft > 0
      ) {
        const nextUrl = new URL(upstreamRes.headers.location, parsed).toString();
        upstreamRes.resume();
        proxyRequest(nextUrl, res, rewriteHls, redirectsLeft - 1);
        return;
      }

      const ct = String(upstreamRes.headers['content-type'] || '').toLowerCase();
      const looksLikeM3u8 =
        rewriteHls &&
        (parsed.pathname.toLowerCase().endsWith('.m3u8') || ct.includes('mpegurl'));

      if (looksLikeM3u8 && (upstreamRes.statusCode || 200) < 400) {
        const chunks = [];
        upstreamRes.on('data', (c) => chunks.push(c));
        upstreamRes.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          const body = raw.includes('#EXTM3U') ? rewriteHlsManifest(raw, parsed.toString()) : raw;
          res.writeHead(200, {
            'Content-Type': 'application/vnd.apple.mpegurl',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-cache'
          });
          res.end(body);
        });
        return;
      }

      res.writeHead(upstreamRes.statusCode || 200, {
        'Content-Type': upstreamRes.headers['content-type'] || 'application/octet-stream',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache'
      });
      upstreamRes.pipe(res);
    }
  );

  upstreamReq.on('error', (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
    }
    res.end('Upstream error: ' + err.message);
  });
}

let activeStreamProc = null;

function killActiveStreamProc() {
  if (activeStreamProc) {
    const p = activeStreamProc;
    activeStreamProc = null;
    try {
      p.kill('SIGKILL');
    } catch {}
  }
}

// Hardware-accelerated macOS Apple Silicon (VideoToolbox) + Broadcast `bwdif` Deinterlace pipeline:
// - Eliminates 1080i50 interlaced field-blinking & DVB B-frame PTS jitter (`bwdif=deint=1` + `-bf 0`)
// - Decodes Dolby AC-3 / E-AC-3 / MP2 / HEVC / MPEG-2 into progressive H.264 + stereo AAC
// - Enforces single upstream connection (`killActiveStreamProc`) so 1-line IPTV accounts never get kicked!
function streamDeinterlacedRequest(targetUrl, req, res) {
  if (!FFMPEG_BIN || !fs.existsSync(FFMPEG_BIN)) {
    proxyRequest(targetUrl, res, false);
    return;
  }

  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
    res.end('Invalid URL');
    return;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    res.writeHead(400, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
    res.end('Unsupported protocol');
    return;
  }

  // Strictly close previous channel's IPTV connection BEFORE opening the new one
  killActiveStreamProc();

  const useHwToolbox = process.platform === 'darwin';
  const videoCodecArgs = useHwToolbox
    ? ['-c:v', 'h264_videotoolbox', '-realtime', '1', '-bf', '0', '-profile:v', 'high', '-b:v', '6M', '-maxrate', '8M', '-bufsize', '12M', '-g', '50']
    : ['-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-bf', '0', '-b:v', '5M', '-g', '50'];

  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-fflags', '+genpts+discardcorrupt',
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '2',
    '-rw_timeout', '12000000',
    '-user_agent', 'TiviMate/4.7.0 (Linux; Android 12)',
    '-i', parsed.toString(),
    '-map', '0:v:0',
    '-map', '0:a:0?',
    '-vf', 'bwdif=mode=1:parity=-1:deint=1,scale=min(1920\\,iw):-2,format=yuv420p',
    ...videoCodecArgs,
    '-c:a', 'aac',
    '-ac', '2',
    '-b:a', '192k',
    '-avoid_negative_ts', 'make_zero',
    '-mpegts_flags', '+resend_headers',
    '-f', 'mpegts',
    'pipe:1'
  ];

  const proc = spawn(FFMPEG_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  activeStreamProc = proc;

  let headersSent = false;
  let closedByClient = false;

  const cleanup = () => {
    closedByClient = true;
    if (activeStreamProc === proc) activeStreamProc = null;
    try {
      proc.kill('SIGKILL');
    } catch {}
  };

  req.on('close', cleanup);
  res.on('close', cleanup);

  proc.stdout.on('data', (chunk) => {
    if (closedByClient) return;
    if (!headersSent) {
      headersSent = true;
      res.writeHead(200, {
        'Content-Type': 'video/mp2t',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache, no-store'
      });
    }
    res.write(chunk);
  });

  proc.on('error', () => {
    if (!headersSent && !res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
      res.end('Stream transcoder launch failed');
    } else {
      res.end();
    }
  });

  proc.on('close', (code) => {
    if (activeStreamProc === proc) activeStreamProc = null;
    if (!headersSent && !res.headersSent && !closedByClient) {
      res.writeHead(502, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
      res.end('Upstream stream unavailable (exit ' + code + ')');
    } else if (!closedByClient) {
      res.end();
    }
  });
}

const server = http.createServer((req, res) => {
  const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (reqUrl.pathname === '/stream') {
    const target = reqUrl.searchParams.get('url') || '';
    streamDeinterlacedRequest(target, req, res);
    return;
  }

  if (reqUrl.pathname === '/proxy') {
    const target = reqUrl.searchParams.get('url') || '';
    const rewriteHls = reqUrl.searchParams.get('hls') === '1';
    proxyRequest(target, res, rewriteHls);
    return;
  }

  if (reqUrl.pathname === '/install') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderTvInstallerHtml());
    return;
  }

  if (reqUrl.pathname === '/api/tv/scan' && req.method === 'GET') {
    execFile('bash', [path.join(__dirname, 'scripts', 'ensure-installer.sh')], { cwd: __dirname }, (err, stdout) => {
      const bin = String(stdout || '').trim();
      if (err || !bin) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err ? err.message : 'Installer binary unavailable', tvs: [] }));
        return;
      }
      execFile(bin, ['scan', '--json'], { cwd: __dirname, timeout: 25000 }, (scanErr, scanOut) => {
        if (scanErr && !scanOut) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: scanErr.message, tvs: [] }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
        res.end(scanOut || JSON.stringify({ ok: true, tvs: [] }));
      });
    });
    return;
  }

  if (reqUrl.pathname === '/api/tv/install' && req.method === 'POST') {
    streamDeployScript(req, res, []);
    return;
  }

  if (reqUrl.pathname === '/api/tv/arm-store' && req.method === 'POST') {
    streamDeployScript(req, res, ['--arm-tvstore']);
    return;
  }

  if (reqUrl.pathname === '/download/iptv.json') {
    const payload = JSON.stringify({
      m3uUrl: remoteConfig.m3uUrl || 'http://YOUR-PROVIDER-URL/get.php?username=USER&password=PASS&type=m3u_plus&output=ts',
      epgUrl: remoteConfig.epgUrl || 'http://YOUR-PROVIDER-URL/xmltv.php?username=USER&password=PASS',
      catchupMode: remoteConfig.catchupMode || 'auto',
      catchupDays: remoteConfig.catchupDays || 3
    }, null, 2) + '\n';
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="iptv.json"',
      'Cache-Control': 'no-cache'
    });
    res.end(payload);
    return;
  }

  if (
    reqUrl.pathname === '/download/vertIPTV.wgt' ||
    reqUrl.pathname === '/sssp/vertIPTV.wgt' ||
    reqUrl.pathname === '/sssp/sssp_config.xml'
  ) {
    const wgtPath = path.join(__dirname, 'dist', 'vertIPTV.wgt');
    const serveArtifact = () => {
      if (!fs.existsSync(wgtPath)) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Failed to build vertIPTV.wgt');
        return;
      }
      const stat = fs.statSync(wgtPath);
      if (reqUrl.pathname === '/sssp/sssp_config.xml') {
        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<widget>\n    <ver>1.0.0</ver>\n    <size>${stat.size}</size>\n    <widgetname>vertIPTV</widgetname>\n    <webtype>tizen</webtype>\n</widget>\n`;
        res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'no-cache' });
        res.end(xml);
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': stat.size,
        'Content-Disposition': 'attachment; filename="vertIPTV.wgt"',
        'Cache-Control': 'no-cache'
      });
      fs.createReadStream(wgtPath).pipe(res);
    };

    if (fs.existsSync(wgtPath)) {
      serveArtifact();
    } else {
      execFile('bash', [path.join(__dirname, 'scripts', 'build-wgt.sh')], { cwd: __dirname }, () => serveArtifact());
    }
    return;
  }

  if (reqUrl.pathname === '/remote') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderRemoteSetupHtml());
    return;
  }

  if (reqUrl.pathname === '/api/remote-config') {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 65536) req.destroy();
      });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          remoteConfig = {
            m3uUrl: String(data.m3uUrl || '').trim(),
            epgUrl: String(data.epgUrl || '').trim(),
            catchupMode: String(data.catchupMode || 'auto'),
            catchupDays: Number(data.catchupDays) || 3,
            epgOffsetMin: Number(data.epgOffsetMin) || 0,
            updatedAt: Date.now()
          };
          persistRemoteConfig();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false }));
        }
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify(remoteConfig));
    return;
  }

  // Ignore Tizen-specific runtime script path cleanly when previewing in desktop browser
  if (reqUrl.pathname.includes('$WEBAPIS')) {
    res.writeHead(200, { 'Content-Type': 'application/javascript' });
    res.end('/* Tizen webapis stub in browser mode */');
    return;
  }

  let relPath = 'index.html';
  if (reqUrl.pathname === '/simulator' || reqUrl.pathname === '/sim') {
    relPath = 'simulator.html';
  } else if (reqUrl.pathname !== '/') {
    relPath = reqUrl.pathname.replace(/^\/+/, '');
  }
  const safePath = path.normalize(path.join(__dirname, relPath));
  if (!safePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(safePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }
    const ext = path.extname(safePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(safePath).pipe(res);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const lan = getLanIp();
  console.log(`\n📺 vertIPTV Dev & Samsung LAN Server running!`);
  console.log(`   • 1-Click TV Installer: http://localhost:${PORT}/install`);
  console.log(`   • Samsung TV Simulator: http://localhost:${PORT}/simulator`);
  console.log(`   • Raw App Fullscreen:   http://localhost:${PORT}`);
  console.log(`   • Samsung TV Browser:   http://${lan}:${PORT}`);
  console.log(`   • Phone Remote Push:    http://${lan}:${PORT}/remote\n`);
});
