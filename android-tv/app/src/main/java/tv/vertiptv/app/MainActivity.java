package tv.vertiptv.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.view.KeyEvent;
import android.view.SurfaceView;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.Format;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.TrackGroup;
import androidx.media3.common.TrackSelectionOverride;
import androidx.media3.common.Tracks;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.datasource.HttpDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.audio.AudioSink;
import androidx.media3.exoplayer.audio.DefaultAudioSink;
import androidx.media3.exoplayer.hls.DefaultHlsExtractorFactory;
import androidx.media3.exoplayer.hls.HlsMediaSource;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.exoplayer.source.MediaSource;
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector;
import androidx.media3.exoplayer.upstream.DefaultAllocator;
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy;
import androidx.media3.exoplayer.upstream.LoadErrorHandlingPolicy;
import androidx.media3.extractor.DefaultExtractorsFactory;
import androidx.media3.extractor.ts.DefaultTsPayloadReaderFactory;
import androidx.media3.extractor.ts.TsExtractor;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.PushbackInputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.zip.GZIPInputStream;

public class MainActivity extends Activity {

    private static final String PREFS_NAME = "vertiptv_native_store";
    private static final String USER_AGENT = "VLC/3.0.20 LibVLC/3.0.20";

    private Handler mainHandler;
    private SurfaceView videoSurface;
    private WebView webView;
    private ExoPlayer exoPlayer;
    private DefaultTrackSelector trackSelector;
    private HlsMediaSource.Factory hlsMediaSourceFactory;
    private DefaultMediaSourceFactory defaultMediaSourceFactory;

    private final ExecutorService bgExecutor = Executors.newCachedThreadPool();
    private final ConcurrentHashMap<Integer, String> pendingFetchPayloads = new ConcurrentHashMap<>();

    private volatile long currentPosMs = 0L;
    private volatile boolean isPausedState = false;
    private volatile boolean isMutedState = false;
    private volatile boolean isLiveStreamState = true;
    private volatile boolean isEditingInputState = false;
    private volatile int streamErrorRetryStep = 0;
    private volatile long lastStreamOpenElapsedMs = 0L;
    private volatile boolean audioTrackCurrentlyDisabled = false;
    private volatile boolean audioFallbackTrackTried = false;
    private volatile String activeStreamUrl = "";
    private volatile boolean activeStreamIsLive = true;
    private volatile boolean dpadRepeatInFlight = false;
    private volatile long lastDpadDispatchMs = 0L;

    private final Runnable liveEndedReconnectRunnable = new Runnable() {
        @Override
        public void run() {
            if (exoPlayer != null && activeStreamIsLive && activeStreamUrl != null && !activeStreamUrl.isEmpty()) {
                openStreamInternal(activeStreamUrl, true, false);
            }
        }
    };

    private final Runnable liveBufferingWatchdogRunnable = new Runnable() {
        @Override
        public void run() {
            if (exoPlayer != null
                    && activeStreamIsLive
                    && !isPausedState
                    && exoPlayer.getPlaybackState() == Player.STATE_BUFFERING
                    && activeStreamUrl != null
                    && !activeStreamUrl.isEmpty()) {
                openStreamInternal(activeStreamUrl, true, false);
            }
        }
    };

    private final Runnable positionPoller = new Runnable() {
        @Override
        public void run() {
            if (exoPlayer != null && !isLiveStreamState && !isPausedState) {
                try {
                    long pos = exoPlayer.getCurrentPosition();
                    if (pos >= 0) {
                        currentPosMs = pos;
                    }
                } catch (Exception ignored) {
                }
            }
            if (mainHandler != null) {
                mainHandler.postDelayed(this, 1000);
            }
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        applyImmersiveFullscreen();

        mainHandler = new Handler(Looper.getMainLooper());

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        root.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));

        videoSurface = new SurfaceView(this);
        videoSurface.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));
        root.addView(videoSurface);

        webView = new WebView(this);
        webView.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));
        webView.setBackgroundColor(Color.TRANSPARENT);
        root.addView(webView);

        setContentView(root);

        initExoPlayer();
        initWebView();
        mainHandler.postDelayed(positionPoller, 500);
    }

    private void applyImmersiveFullscreen() {
        try {
            View decor = getWindow().getDecorView();
            decor.setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_FULLSCREEN
            );
        } catch (Exception ignored) {
        }
    }

    private void initExoPlayer() {
        // Open-source IPTV best practice (IPVIO-Stream, Jellyfin Android TV, StreamVault-IPTV):
        // 1. EXTENSION_RENDERER_MODE_ON uses Android's native MediaCodecAudioRenderer (Fraunhofer FDK-AAC)
        //    first for audio/mp4a-latm (including 24kHz->48kHz implicit HE-AAC SBR on Eska TV HD / Da Vinci / Metro),
        //    while automatically delegating MP2, AC-3, E-AC-3, and DTS to Jellyfin FfmpegAudioRenderer.
        // 2. DefaultAudioSink with setEnableFloatOutput(false) forces 16-bit PCM output across all audio decoders,
        //    preventing silent/muted HDMI AudioTracks on Android TV boxes that choke on 32-bit float PCM.
        DefaultRenderersFactory renderersFactory = new DefaultRenderersFactory(this) {
            @Override
            protected AudioSink buildAudioSink(
                    Context context,
                    boolean enableFloatOutput,
                    boolean enableAudioTrackPlaybackParams) {
                return new DefaultAudioSink.Builder(context)
                        .setEnableFloatOutput(false)
                        .setEnableAudioTrackPlaybackParams(false)
                        .build();
            }
        }
                .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_ON)
                .setEnableDecoderFallback(true);

        DefaultHttpDataSource.Factory httpFactory = new DefaultHttpDataSource.Factory()
                .setUserAgent(USER_AGENT)
                .setAllowCrossProtocolRedirects(true)
                .setConnectTimeoutMs(8000)
                .setReadTimeoutMs(12000)
                .setDefaultRequestProperties(Collections.singletonMap("Connection", "keep-alive"));

        DefaultDataSource.Factory dataSourceFactory = new DefaultDataSource.Factory(this, httpFactory);

        // Open-source IPTV TS Payload Reader flags (StreamVault-IPTV & Jellyfin Android TV):
        // - FLAG_ALLOW_NON_IDR_KEYFRAMES: European DVB-S2 Open-GOP H.264 streams without IDR frames
        // - FLAG_DETECT_ACCESS_UNITS: Broadcast H.264 encoders that omit AUD (nal_unit_type=9) delimiters
        // - FLAG_IGNORE_SPLICE_INFO_STREAM: Ignores SCTE-35 (0x86) ad-splice streams that stall TimestampAdjuster
        // - FLAG_ENABLE_HDMV_DTS_AUDIO_STREAMS: Enables DTS audio PIDs in MPEG-TS
        int tsFlags = DefaultTsPayloadReaderFactory.FLAG_ALLOW_NON_IDR_KEYFRAMES
                | DefaultTsPayloadReaderFactory.FLAG_DETECT_ACCESS_UNITS
                | DefaultTsPayloadReaderFactory.FLAG_IGNORE_SPLICE_INFO_STREAM
                | DefaultTsPayloadReaderFactory.FLAG_ENABLE_HDMV_DTS_AUDIO_STREAMS;

        // 188 * 1800 = 338,400 bytes PCR/PTS timestamp search window (Jellyfin Android TV standard for 1080p50 DVB)
        DefaultExtractorsFactory extractorsFactory = new DefaultExtractorsFactory()
                .setTsExtractorFlags(tsFlags)
                .setTsExtractorTimestampSearchBytes(TsExtractor.TS_PACKET_SIZE * 1800);

        // Resilient IPTV segment/manifest retry policy (IPVIO-Stream PlayerNet):
        // Retries transient segment drops up to 6 times while failing fast on permanent HTTP 4xx errors.
        LoadErrorHandlingPolicy iptvLoadErrorPolicy = new DefaultLoadErrorHandlingPolicy(6) {
            @Override
            public long getRetryDelayMsFor(LoadErrorInfo loadErrorInfo) {
                if (loadErrorInfo.exception instanceof HttpDataSource.InvalidResponseCodeException) {
                    int code = ((HttpDataSource.InvalidResponseCodeException) loadErrorInfo.exception).responseCode;
                    if (code >= 400 && code < 500 && code != 408 && code != 429) {
                        return C.TIME_UNSET;
                    }
                }
                return Math.min(loadErrorInfo.errorCount * 500L, 3000L);
            }
        };

        defaultMediaSourceFactory =
                new DefaultMediaSourceFactory(dataSourceFactory, extractorsFactory)
                        .setLoadErrorHandlingPolicy(iptvLoadErrorPolicy);

        DefaultHlsExtractorFactory hlsExtractorFactory = new DefaultHlsExtractorFactory(tsFlags, true);
        hlsMediaSourceFactory = new HlsMediaSource.Factory(dataSourceFactory)
                .setExtractorFactory(hlsExtractorFactory)
                .setAllowChunklessPreparation(true)
                .setLoadErrorHandlingPolicy(iptvLoadErrorPolicy);

        // Open-source IPTV TrackSelector settings (IPVIO-Stream & Jellyfin Android TV):
        // setConstrainAudioChannelCountToDeviceCapabilities(false) prevents stereo TVs from rejecting
        // 5.1 (6-channel) AC-3/E-AC-3/AAC tracks, letting the decoder/AudioSink downmix 5.1 to stereo cleanly.
        trackSelector = new DefaultTrackSelector(this);
        trackSelector.setParameters(
                trackSelector.buildUponParameters()
                        .setPreferredAudioLanguages("pol", "pl", "eng", "en")
                        .setConstrainAudioChannelCountToDeviceCapabilities(false)
                        .setAllowInvalidateSelectionsOnRendererCapabilitiesChange(true)
                        .setExceedAudioConstraintsIfNecessary(true)
                        .setExceedVideoConstraintsIfNecessary(true)
                        .setExceedRendererCapabilitiesIfNecessary(true)
        );

        // Pre-warmed 4 MB segment pool + 2.5s initial / 4.0s rebuffer cushion for stutter-free DVB 1080i50/1080p50 playback
        DefaultAllocator allocator = new DefaultAllocator(true, C.DEFAULT_BUFFER_SEGMENT_SIZE, 64);
        DefaultLoadControl loadControl = new DefaultLoadControl.Builder()
                .setAllocator(allocator)
                .setBufferDurationsMs(
                        15000,
                        50000,
                        2500,
                        4000
                )
                .setPrioritizeTimeOverSizeThresholds(true)
                .build();

        AudioAttributes audioAttributes = new AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MOVIE)
                .build();

        exoPlayer = new ExoPlayer.Builder(this, renderersFactory)
                .setMediaSourceFactory(defaultMediaSourceFactory)
                .setTrackSelector(trackSelector)
                .setLoadControl(loadControl)
                .setAudioAttributes(audioAttributes, true)
                .build();

        // Keep hardware MediaCodec video/audio decoders warm across channel switches (saves 400-800ms per zap)
        exoPlayer.setForegroundMode(true);
        exoPlayer.setVideoScalingMode(C.VIDEO_SCALING_MODE_SCALE_TO_FIT);
        exoPlayer.setVideoChangeFrameRateStrategy(C.VIDEO_CHANGE_FRAME_RATE_STRATEGY_OFF);
        exoPlayer.setVideoSurfaceView(videoSurface);
        exoPlayer.addListener(new Player.Listener() {
            @Override
            public void onPlaybackStateChanged(int playbackState) {
                if (mainHandler != null) {
                    mainHandler.removeCallbacks(liveEndedReconnectRunnable);
                    mainHandler.removeCallbacks(liveBufferingWatchdogRunnable);
                }
                if (playbackState == Player.STATE_BUFFERING) {
                    notifyJsPlayerEvent("buffering", "");
                    if (activeStreamIsLive && !isPausedState && mainHandler != null) {
                        mainHandler.postDelayed(liveBufferingWatchdogRunnable, 15000L);
                    }
                } else if (playbackState == Player.STATE_READY) {
                    if (exoPlayer.getPlayWhenReady()) {
                        isPausedState = false;
                        notifyJsPlayerEvent("playing", "");
                    } else {
                        isPausedState = true;
                        notifyJsPlayerEvent("paused", "");
                    }
                } else if (playbackState == Player.STATE_ENDED) {
                    if (activeStreamIsLive && activeStreamUrl != null && !activeStreamUrl.isEmpty() && mainHandler != null) {
                        // Live MPEG-TS/HLS stream hit EOF/discontinuity: auto-reconnect after 600ms (IPVIO-Stream / StreamVault)
                        notifyJsPlayerEvent("buffering", "");
                        mainHandler.postDelayed(liveEndedReconnectRunnable, 600L);
                    } else {
                        notifyJsPlayerEvent("ended", "");
                    }
                }
            }

            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                if (isPlaying) {
                    isPausedState = false;
                    notifyJsPlayerEvent("playing", "");
                }
            }

            @Override
            public void onPlayerError(PlaybackException error) {
                if (activeStreamUrl != null && !activeStreamUrl.isEmpty() && error != null) {
                    int code = error.errorCode;
                    if (code == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW) {
                        streamErrorRetryStep = 0;
                        openStreamInternal(activeStreamUrl, activeStreamIsLive, false);
                        return;
                    }
                    if (code == PlaybackException.ERROR_CODE_DECODER_INIT_FAILED
                            || code == PlaybackException.ERROR_CODE_DECODING_FAILED
                            || code == PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED
                            || code == PlaybackException.ERROR_CODE_AUDIO_TRACK_INIT_FAILED
                            || code == PlaybackException.ERROR_CODE_AUDIO_TRACK_WRITE_FAILED) {
                        // First, if the DVB stream offers an alternate audio PID/track, switch to it (IPVIO-Stream audioFallback)
                        if (!audioFallbackTrackTried && trySelectFallbackAudioTrack()) {
                            audioFallbackTrackTried = true;
                            return;
                        }
                        long elapsedSinceOpen = android.os.SystemClock.elapsedRealtime() - lastStreamOpenElapsedMs;
                        if (elapsedSinceOpen > 3000L) {
                            // Mid-stream #EXT-X-DISCONTINUITY codec/PMT splice (e.g. AC-3 <-> AAC on Eska TV HD):
                            // Always reopen with audio ENABLED rather than muting the audio track!
                            streamErrorRetryStep = 0;
                        }
                        if (streamErrorRetryStep == 0) {
                            streamErrorRetryStep = 1;
                            openStreamInternal(activeStreamUrl, activeStreamIsLive, false);
                            return;
                        } else if (streamErrorRetryStep == 1) {
                            streamErrorRetryStep = 2;
                            openStreamInternal(activeStreamUrl, activeStreamIsLive, true);
                            return;
                        }
                    }
                }
                String msg = error != null && error.getMessage() != null
                        ? error.getMessage()
                        : "ExoPlayer stream error";
                notifyJsPlayerEvent("error", msg);
            }
        });
    }

    private boolean trySelectFallbackAudioTrack() {
        if (exoPlayer == null) return false;
        try {
            Tracks tracks = exoPlayer.getCurrentTracks();
            List<Tracks.Group> audioGroups = new ArrayList<>();
            int selectedGroupIdx = -1;
            for (Tracks.Group g : tracks.getGroups()) {
                if (g.getType() == C.TRACK_TYPE_AUDIO && g.length > 0) {
                    if (g.isSelected()) {
                        selectedGroupIdx = audioGroups.size();
                    }
                    audioGroups.add(g);
                }
            }
            if (audioGroups.size() > 1) {
                int nextIdx = (selectedGroupIdx + 1) % audioGroups.size();
                TrackGroup nextMediaGroup = audioGroups.get(nextIdx).getMediaTrackGroup();
                exoPlayer.setTrackSelectionParameters(
                        exoPlayer.getTrackSelectionParameters()
                                .buildUpon()
                                .setOverrideForType(new TrackSelectionOverride(nextMediaGroup, 0))
                                .build()
                );
                exoPlayer.prepare();
                exoPlayer.setPlayWhenReady(true);
                return true;
            }
        } catch (Exception ignored) {
        }
        return false;
    }

    private void openStreamInternal(final String url, final boolean isLive, final boolean disableAudio) {
        if (exoPlayer == null || url == null || url.isEmpty()) return;
        try {
            if (mainHandler != null) {
                mainHandler.removeCallbacks(liveEndedReconnectRunnable);
                mainHandler.removeCallbacks(liveBufferingWatchdogRunnable);
            }
            currentPosMs = 0L;
            isPausedState = false;
            isLiveStreamState = isLive;
            activeStreamUrl = url;
            activeStreamIsLive = isLive;
            lastStreamOpenElapsedMs = android.os.SystemClock.elapsedRealtime();
            if (trackSelector != null && audioTrackCurrentlyDisabled != disableAudio) {
                audioTrackCurrentlyDisabled = disableAudio;
                trackSelector.setParameters(
                        trackSelector.buildUponParameters()
                                .clearOverridesOfType(C.TRACK_TYPE_AUDIO)
                                .setTrackTypeDisabled(C.TRACK_TYPE_AUDIO, disableAudio)
                );
            }

            MediaItem.Builder itemBuilder = new MediaItem.Builder().setUri(Uri.parse(url));
            if (isLive) {
                itemBuilder.setLiveConfiguration(
                        new MediaItem.LiveConfiguration.Builder()
                                .setTargetOffsetMs(12000)
                                .setMinOffsetMs(6000)
                                .setMaxOffsetMs(30000)
                                .setMaxPlaybackSpeed(1.0f)
                                .build()
                );
            }
            MediaItem item = itemBuilder.build();

            String lowerUrl = url.toLowerCase(Locale.ROOT);
            boolean isHls = lowerUrl.contains(".m3u8") || lowerUrl.contains("m3u8") || lowerUrl.contains("hls=1");
            MediaSource mediaSource = (isHls && hlsMediaSourceFactory != null)
                    ? hlsMediaSourceFactory.createMediaSource(item)
                    : defaultMediaSourceFactory.createMediaSource(item);

            // Seamless item switch: do NOT call exoPlayer.stop() first, so ForegroundMode keeps MediaCodec warm!
            exoPlayer.setMediaSource(mediaSource, true);
            exoPlayer.setVolume(isMutedState ? 0f : 1f);
            exoPlayer.setPlayWhenReady(true);
            if (exoPlayer.getPlaybackState() == Player.STATE_IDLE) {
                exoPlayer.prepare();
            }
        } catch (Exception e) {
            notifyJsPlayerEvent("error", e.getMessage() != null ? e.getMessage() : "Failed to open stream");
        }
    }

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    private void initWebView() {
        WebSettings ws = webView.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setDatabaseEnabled(true);
        ws.setMediaPlaybackRequiresUserGesture(false);
        ws.setAllowFileAccess(true);
        ws.setAllowContentAccess(true);
        ws.setAllowFileAccessFromFileURLs(true);
        ws.setAllowUniversalAccessFromFileURLs(true);
        ws.setCacheMode(WebSettings.LOAD_DEFAULT);
        ws.setTextZoom(100);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            ws.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }

        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            webView.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
        }
        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient());
        webView.addJavascriptInterface(new AndroidTvBridge(), "AndroidTvBridge");
        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);
        webView.requestFocus();

        webView.loadUrl("file:///android_asset/www/index.html");
    }

    private void notifyJsPlayerEvent(final String state, final String detail) {
        mainHandler.post(() -> {
            if (webView == null) return;
            String safeState = JSONObject.quote(state != null ? state : "");
            String safeDetail = JSONObject.quote(detail != null ? detail : "");
            String js = "if (window.__onAndroidPlayerEvent) { window.__onAndroidPlayerEvent("
                    + safeState + ", " + safeDetail + "); }";
            webView.evaluateJavascript(js, null);
        });
    }

    private void dispatchTvKeyToWebView(final int keyCode, final String keyName) {
        mainHandler.post(() -> {
            if (webView == null) {
                dpadRepeatInFlight = false;
                return;
            }
            String safeKey = JSONObject.quote(keyName);
            String js = "(function(){"
                    + "if (window.__handleTvKey && window.__handleTvKey(" + keyCode + ", " + safeKey + ")) return;"
                    + "var target = document.activeElement || document.body || document;"
                    + "var ev = new KeyboardEvent('keydown', { key: " + safeKey + ", keyCode: " + keyCode + ", which: " + keyCode + ", bubbles: true, cancelable: true });"
                    + "Object.defineProperty(ev, 'keyCode', { get: function(){ return " + keyCode + "; } });"
                    + "Object.defineProperty(ev, 'which', { get: function(){ return " + keyCode + "; } });"
                    + "var notCancelled = target.dispatchEvent(ev);"
                    + "if (notCancelled && " + keyCode + " === 13 && target && (target.tagName === 'BUTTON' || target.tagName === 'A')) { target.click(); }"
                    + "})();";
            webView.evaluateJavascript(js, value -> dpadRepeatInFlight = false);
        });
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int keyCode = event.getKeyCode();
        int action = event.getAction();

        if (keyCode == KeyEvent.KEYCODE_BACK || keyCode == KeyEvent.KEYCODE_ESCAPE) {
            if (action == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) {
                isEditingInputState = false;
                dispatchTvKeyToWebView(10009, "Escape");
            }
            return true;
        }

        // Fast-path D-pad navigation directly into JS when not typing in an input (bypasses slow WebView C++ spatial focus search!)
        if (!isEditingInputState) {
            int dpadCode = 0;
            String dpadName = "";
            switch (keyCode) {
                case KeyEvent.KEYCODE_DPAD_UP:
                    dpadCode = 38;
                    dpadName = "ArrowUp";
                    break;
                case KeyEvent.KEYCODE_DPAD_DOWN:
                    dpadCode = 40;
                    dpadName = "ArrowDown";
                    break;
                case KeyEvent.KEYCODE_DPAD_LEFT:
                    dpadCode = 37;
                    dpadName = "ArrowLeft";
                    break;
                case KeyEvent.KEYCODE_DPAD_RIGHT:
                    dpadCode = 39;
                    dpadName = "ArrowRight";
                    break;
                case KeyEvent.KEYCODE_DPAD_CENTER:
                case KeyEvent.KEYCODE_ENTER:
                case KeyEvent.KEYCODE_NUMPAD_ENTER:
                    dpadCode = 13;
                    dpadName = "Enter";
                    break;
                default:
                    break;
            }
            if (dpadCode != 0) {
                if (action == KeyEvent.ACTION_UP) {
                    dpadRepeatInFlight = false;
                } else if (action == KeyEvent.ACTION_DOWN) {
                    int repeat = event.getRepeatCount();
                    if (repeat == 0) {
                        lastDpadDispatchMs = System.currentTimeMillis();
                        dpadRepeatInFlight = true;
                        dispatchTvKeyToWebView(dpadCode, dpadName);
                    } else if (dpadCode != 13 && !dpadRepeatInFlight) {
                        long now = System.currentTimeMillis();
                        if (now - lastDpadDispatchMs >= 32) {
                            lastDpadDispatchMs = now;
                            dpadRepeatInFlight = true;
                            dispatchTvKeyToWebView(dpadCode, dpadName);
                        }
                    }
                }
                return true;
            }
        }

        // Map Android TV / Fire TV remote media & channel keys to Tizen/Standard keyCodes
        int mappedCode = 0;
        String mappedName = "";
        switch (keyCode) {
            case KeyEvent.KEYCODE_CHANNEL_UP:
            case KeyEvent.KEYCODE_PAGE_UP:
                mappedCode = 427;
                mappedName = "ChannelUp";
                break;
            case KeyEvent.KEYCODE_CHANNEL_DOWN:
            case KeyEvent.KEYCODE_PAGE_DOWN:
                mappedCode = 428;
                mappedName = "ChannelDown";
                break;
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
                mappedCode = 10252;
                mappedName = "MediaPlayPause";
                break;
            case KeyEvent.KEYCODE_MEDIA_PLAY:
                mappedCode = 415;
                mappedName = "MediaPlay";
                break;
            case KeyEvent.KEYCODE_MEDIA_PAUSE:
                mappedCode = 19;
                mappedName = "MediaPause";
                break;
            case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD:
            case KeyEvent.KEYCODE_MEDIA_SKIP_FORWARD:
                mappedCode = 417;
                mappedName = "MediaFastForward";
                break;
            case KeyEvent.KEYCODE_MEDIA_REWIND:
            case KeyEvent.KEYCODE_MEDIA_SKIP_BACKWARD:
                mappedCode = 412;
                mappedName = "MediaRewind";
                break;
            case KeyEvent.KEYCODE_INFO:
                mappedCode = 457;
                mappedName = "Info";
                break;
            case KeyEvent.KEYCODE_GUIDE:
            case KeyEvent.KEYCODE_TV_CONTENTS_MENU:
            case KeyEvent.KEYCODE_MENU:
                mappedCode = 458;
                mappedName = "Guide";
                break;
            case KeyEvent.KEYCODE_CAPTIONS:
            case KeyEvent.KEYCODE_MEDIA_AUDIO_TRACK:
                mappedCode = 10253;
                mappedName = "AudioTrack";
                break;
            case KeyEvent.KEYCODE_PROG_RED:
                mappedCode = 403;
                mappedName = "ColorF0Red";
                break;
            case KeyEvent.KEYCODE_PROG_GREEN:
                mappedCode = 404;
                mappedName = "ColorF1Green";
                break;
            case KeyEvent.KEYCODE_PROG_YELLOW:
                mappedCode = 405;
                mappedName = "ColorF2Yellow";
                break;
            case KeyEvent.KEYCODE_PROG_BLUE:
                mappedCode = 406;
                mappedName = "ColorF3Blue";
                break;
            default:
                break;
        }

        if (mappedCode != 0) {
            if (action == KeyEvent.ACTION_DOWN) {
                dispatchTvKeyToWebView(mappedCode, mappedName);
            }
            return true;
        }

        return super.dispatchKeyEvent(event);
    }

    @Override
    protected void onResume() {
        super.onResume();
        applyImmersiveFullscreen();
        if (webView != null) {
            webView.onResume();
        }
        if (exoPlayer != null && !isPausedState && exoPlayer.getMediaItemCount() > 0) {
            exoPlayer.setPlayWhenReady(true);
        }
    }

    @Override
    protected void onPause() {
        if (exoPlayer != null) {
            exoPlayer.setPlayWhenReady(false);
        }
        if (webView != null) {
            webView.onPause();
        }
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (mainHandler != null) {
            mainHandler.removeCallbacksAndMessages(null);
        }
        try {
            bgExecutor.shutdownNow();
        } catch (Exception ignored) {
        }
        pendingFetchPayloads.clear();
        if (exoPlayer != null) {
            exoPlayer.release();
            exoPlayer = null;
        }
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private static String normalizeChannelKeyJava(String s) {
        if (s == null || s.isEmpty()) return "";
        String lower = s.toLowerCase(Locale.ROOT)
                .replaceAll("\\b(hd|fhd|uhd|4k|sd|pl|tv|hevc|h265|raw)\\b", "");
        StringBuilder sb = new StringBuilder(lower.length());
        for (int i = 0; i < lower.length(); i++) {
            char c = lower.charAt(i);
            if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || (c >= '\u00c0' && c <= '\u024f')) {
                sb.append(c);
            }
        }
        return sb.toString();
    }

    private static String extractXmlAttr(String line, String attrPrefix) {
        int idx = line.indexOf(attrPrefix);
        if (idx == -1) return "";
        int start = idx + attrPrefix.length();
        int end = line.indexOf('"', start);
        if (end == -1) return "";
        return line.substring(start, end);
    }

    private static int parseDigits(String s, int offset, int len) {
        if (offset < 0 || offset + len > s.length()) return -1;
        int val = 0;
        for (int i = 0; i < len; i++) {
            char c = s.charAt(offset + i);
            if (c < '0' || c > '9') return -1;
            val = val * 10 + (c - '0');
        }
        return val;
    }

    private static long parseXmltvAttrEpochSec(String line, String attrPrefix) {
        int idx = line.indexOf(attrPrefix);
        if (idx == -1) return 0L;
        int s = idx + attrPrefix.length();
        int end = line.indexOf('"', s);
        if (end == -1 || end - s < 14) return 0L;
        int yr = parseDigits(line, s, 4);
        int mo = parseDigits(line, s + 4, 2);
        int dy = parseDigits(line, s + 6, 2);
        int hr = parseDigits(line, s + 8, 2);
        int mn = parseDigits(line, s + 10, 2);
        int sc = parseDigits(line, s + 12, 2);
        if (yr < 2000 || mo < 1 || mo > 12 || dy < 1 || dy > 31 || hr < 0 || mn < 0 || sc < 0) return 0L;
        int y = yr - (mo <= 2 ? 1 : 0);
        int era = (y >= 0 ? y : y - 399) / 400;
        int yoe = y - era * 400;
        int doy = (153 * (mo + (mo > 2 ? -3 : 9)) + 2) / 5 + dy - 1;
        int doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        long days = (long) era * 146097L + (long) doe - 719468L;
        long utcSec = days * 86400L + hr * 3600L + mn * 60L + sc;
        for (int i = s + 14; i < end; i++) {
            char c = line.charAt(i);
            if ((c == '+' || c == '-') && i + 4 < end) {
                int zh = parseDigits(line, i + 1, 2);
                int zm = parseDigits(line, i + 3, 2);
                if (zh >= 0 && zm >= 0) {
                    long off = zh * 3600L + zm * 60L;
                    utcSec += (c == '+' ? -off : off);
                }
                break;
            }
        }
        return utcSec;
    }

    private static boolean isUnusedProgrammeChildTag(String trimmed) {
        return trimmed.startsWith("<category")
                || trimmed.startsWith("<icon")
                || trimmed.startsWith("<credits")
                || trimmed.startsWith("</credits")
                || trimmed.startsWith("<actor")
                || trimmed.startsWith("<director")
                || trimmed.startsWith("<writer")
                || trimmed.startsWith("<producer")
                || trimmed.startsWith("<presenter")
                || trimmed.startsWith("<guest")
                || trimmed.startsWith("<date")
                || trimmed.startsWith("<country")
                || trimmed.startsWith("<episode-num")
                || trimmed.startsWith("<rating")
                || trimmed.startsWith("</rating")
                || trimmed.startsWith("<star-rating")
                || trimmed.startsWith("</star-rating")
                || trimmed.startsWith("<video")
                || trimmed.startsWith("</video")
                || trimmed.startsWith("<audio")
                || trimmed.startsWith("</audio")
                || trimmed.startsWith("<sub-title")
                || trimmed.startsWith("<previously-shown")
                || trimmed.startsWith("<premiere")
                || trimmed.startsWith("<url");
    }

    private String downloadStreamToFilteredUtf8(String urlStr, String filterSpec) throws Exception {
        HttpURLConnection conn = null;
        try {
            URL currentUrl = new URL(urlStr);
            int redirects = 0;
            while (redirects < 5) {
                conn = (HttpURLConnection) currentUrl.openConnection();
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(45000);
                conn.setInstanceFollowRedirects(true);
                conn.setRequestProperty("User-Agent", USER_AGENT);
                conn.setRequestProperty("Accept", "*/*");
                int status = conn.getResponseCode();
                if (status == HttpURLConnection.HTTP_MOVED_TEMP
                        || status == HttpURLConnection.HTTP_MOVED_PERM
                        || status == HttpURLConnection.HTTP_SEE_OTHER
                        || status == 307 || status == 308) {
                    String loc = conn.getHeaderField("Location");
                    conn.disconnect();
                    if (loc == null) break;
                    currentUrl = new URL(currentUrl, loc);
                    redirects++;
                    continue;
                }
                if (status < 200 || status >= 300) {
                    throw new Exception("HTTP " + status);
                }
                break;
            }

            Set<String> allowedIds = new HashSet<>();
            Set<String> allowedNorms = new HashSet<>();
            boolean hasFilter = false;
            if (filterSpec != null && !filterSpec.isEmpty()) {
                int nl = filterSpec.indexOf('\n');
                String idLine = nl == -1 ? filterSpec : filterSpec.substring(0, nl);
                String normLine = nl == -1 ? "" : filterSpec.substring(nl + 1);
                if (!idLine.isEmpty()) {
                    for (String part : idLine.split("\t")) {
                        if (!part.isEmpty()) allowedIds.add(part);
                    }
                }
                if (!normLine.isEmpty()) {
                    for (String part : normLine.split("\t")) {
                        if (!part.isEmpty()) allowedNorms.add(part);
                    }
                }
                hasFilter = !allowedIds.isEmpty() || !allowedNorms.isEmpty();
            }

            try (InputStream rawIn = conn.getInputStream();
                 PushbackInputStream pbIn = new PushbackInputStream(new BufferedInputStream(rawIn, 65536), 2)) {
                byte[] magic = new byte[2];
                int readMagic = pbIn.read(magic);
                if (readMagic > 0) {
                    pbIn.unread(magic, 0, readMagic);
                }
                boolean isGzip = readMagic == 2 && (magic[0] & 0xFF) == 0x1F && (magic[1] & 0xFF) == 0x8B;
                InputStream decodedStream = isGzip ? new GZIPInputStream(pbIn, 65536) : pbIn;

                try (BufferedReader reader = new BufferedReader(new InputStreamReader(decodedStream, StandardCharsets.UTF_8), 65536)) {
                    if (!hasFilter) {
                        StringBuilder out = new StringBuilder(262144);
                        char[] cbuf = new char[16384];
                        int n;
                        int maxChars = 28 * 1024 * 1024;
                        while ((n = reader.read(cbuf)) != -1) {
                            if (out.length() + n > maxChars) {
                                out.append(cbuf, 0, Math.max(0, maxChars - out.length()));
                                break;
                            }
                            out.append(cbuf, 0, n);
                        }
                        return out.toString();
                    }

                    // Streaming XMLTV filter: keeps only <channel> and <programme> blocks matching the user's playlist!
                    StringBuilder out = new StringBuilder(524288);
                    out.append("<tv>\n");
                    int maxChars = 28 * 1024 * 1024;
                    String line;
                    boolean inChannel = false;
                    String curChId = "";
                    boolean keepChannel = false;
                    StringBuilder chBuf = new StringBuilder(512);

                    boolean inProg = false;
                    boolean keepProg = false;
                    long nowSec = System.currentTimeMillis() / 1000L;
                    long minStopSec = nowSec - (3L * 86400L + 10800L);
                    long maxStartSec = nowSec + (2L * 86400L + 10800L);

                    while ((line = reader.readLine()) != null) {
                        String trimmed = line.trim();
                        if (trimmed.isEmpty()) continue;

                        if (!inChannel && !inProg) {
                            if (trimmed.startsWith("<channel ")) {
                                curChId = extractXmlAttr(trimmed, "id=\"");
                                String curChIdLow = curChId.toLowerCase(Locale.ROOT);
                                keepChannel = !curChId.isEmpty() && (allowedIds.contains(curChId) || allowedIds.contains(curChIdLow));
                                chBuf.setLength(0);
                                chBuf.append(trimmed).append('\n');
                                if (trimmed.contains("</channel>")) {
                                    if (keepChannel && out.length() < maxChars) {
                                        out.append(chBuf);
                                    }
                                } else {
                                    inChannel = true;
                                }
                            } else if (trimmed.startsWith("<programme ")) {
                                String pCh = extractXmlAttr(trimmed, "channel=\"");
                                keepProg = !pCh.isEmpty() && (allowedIds.contains(pCh) || allowedIds.contains(pCh.toLowerCase(Locale.ROOT)));
                                if (keepProg) {
                                    long stopSec = parseXmltvAttrEpochSec(trimmed, "stop=\"");
                                    long startSec = parseXmltvAttrEpochSec(trimmed, "start=\"");
                                    if ((stopSec > 0L && stopSec < minStopSec) || (startSec > 0L && startSec > maxStartSec)) {
                                        keepProg = false;
                                    }
                                }
                                if (keepProg && out.length() < maxChars) {
                                    out.append(trimmed).append('\n');
                                }
                                if (!trimmed.contains("</programme>")) {
                                    inProg = true;
                                }
                            }
                        } else if (inChannel) {
                            chBuf.append(trimmed).append('\n');
                            if (!keepChannel && trimmed.startsWith("<display-name")) {
                                int gt = trimmed.indexOf('>');
                                int lt = trimmed.indexOf("</display-name>");
                                if (gt != -1 && lt > gt) {
                                    String dn = trimmed.substring(gt + 1, lt);
                                    String norm = normalizeChannelKeyJava(dn);
                                    if (!norm.isEmpty() && allowedNorms.contains(norm)) {
                                        keepChannel = true;
                                        if (!curChId.isEmpty()) {
                                            allowedIds.add(curChId);
                                            allowedIds.add(curChId.toLowerCase(Locale.ROOT));
                                        }
                                    }
                                }
                            }
                            if (trimmed.contains("</channel>")) {
                                inChannel = false;
                                if (keepChannel && out.length() < maxChars) {
                                    out.append(chBuf);
                                }
                            }
                        } else if (inProg) {
                            if (keepProg && out.length() < maxChars) {
                                if (!isUnusedProgrammeChildTag(trimmed)) {
                                    out.append(trimmed).append('\n');
                                }
                            }
                            if (trimmed.contains("</programme>")) {
                                inProg = false;
                                keepProg = false;
                            }
                        }
                    }
                    out.append("</tv>");
                    return out.toString();
                }
            }
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }

    private byte[] downloadBytesFollowRedirects(String urlStr) throws Exception {
        HttpURLConnection conn = null;
        try {
            URL currentUrl = new URL(urlStr);
            int redirects = 0;
            while (redirects < 5) {
                conn = (HttpURLConnection) currentUrl.openConnection();
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(40000);
                conn.setInstanceFollowRedirects(true);
                conn.setRequestProperty("User-Agent", USER_AGENT);
                conn.setRequestProperty("Accept", "*/*");
                int status = conn.getResponseCode();
                if (status == HttpURLConnection.HTTP_MOVED_TEMP
                        || status == HttpURLConnection.HTTP_MOVED_PERM
                        || status == HttpURLConnection.HTTP_SEE_OTHER
                        || status == 307 || status == 308) {
                    String loc = conn.getHeaderField("Location");
                    conn.disconnect();
                    if (loc == null) break;
                    currentUrl = new URL(currentUrl, loc);
                    redirects++;
                    continue;
                }
                if (status < 200 || status >= 300) {
                    throw new Exception("HTTP " + status);
                }
                break;
            }
            try (InputStream in = conn.getInputStream();
                 ByteArrayOutputStream out = new ByteArrayOutputStream(65536)) {
                byte[] buf = new byte[32768];
                int n;
                while ((n = in.read(buf)) != -1) {
                    out.write(buf, 0, n);
                }
                return out.toByteArray();
            }
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }

    private String decodeFetchedBytesToUtf8(byte[] raw) throws Exception {
        if (raw == null || raw.length == 0) return "";
        if (raw.length >= 2 && (raw[0] & 0xFF) == 0x1F && (raw[1] & 0xFF) == 0x8B) {
            try (GZIPInputStream gzis = new GZIPInputStream(new ByteArrayInputStream(raw), 32768);
                 ByteArrayOutputStream out = new ByteArrayOutputStream(raw.length * 3)) {
                byte[] buf = new byte[32768];
                int n;
                while ((n = gzis.read(buf)) != -1) {
                    out.write(buf, 0, n);
                }
                return new String(out.toByteArray(), StandardCharsets.UTF_8);
            }
        }
        return new String(raw, StandardCharsets.UTF_8);
    }

    public class AndroidTvBridge {

        @JavascriptInterface
        public void playStream(final String url, final boolean isLive) {
            mainHandler.post(() -> {
                if (audioFallbackTrackTried && trackSelector != null) {
                    trackSelector.setParameters(
                            trackSelector.buildUponParameters()
                                    .clearOverridesOfType(C.TRACK_TYPE_AUDIO)
                    );
                }
                audioFallbackTrackTried = false;
                streamErrorRetryStep = 0;
                openStreamInternal(url, isLive, false);
            });
        }

        @JavascriptInterface
        public void stopStream() {
            mainHandler.post(() -> {
                if (mainHandler != null) {
                    mainHandler.removeCallbacks(liveEndedReconnectRunnable);
                    mainHandler.removeCallbacks(liveBufferingWatchdogRunnable);
                }
                if (exoPlayer == null) return;
                try {
                    activeStreamUrl = "";
                    exoPlayer.stop();
                    exoPlayer.clearMediaItems();
                    currentPosMs = 0L;
                } catch (Exception ignored) {
                }
            });
        }

        @JavascriptInterface
        public boolean togglePause() {
            final boolean[] pausedResult = new boolean[]{isPausedState};
            final CountDownLatch latch = new CountDownLatch(1);
            mainHandler.post(() -> {
                try {
                    if (exoPlayer != null) {
                        boolean currentlyPlaying = exoPlayer.getPlayWhenReady();
                        exoPlayer.setPlayWhenReady(!currentlyPlaying);
                        isPausedState = currentlyPlaying;
                        pausedResult[0] = isPausedState;
                    }
                } catch (Exception ignored) {
                } finally {
                    latch.countDown();
                }
            });
            try {
                latch.await(400, TimeUnit.MILLISECONDS);
            } catch (InterruptedException ignored) {
            }
            return pausedResult[0];
        }

        @JavascriptInterface
        public void seekToMs(final long positionMs) {
            mainHandler.post(() -> {
                if (exoPlayer != null) {
                    try {
                        exoPlayer.seekTo(Math.max(0L, positionMs));
                        currentPosMs = Math.max(0L, positionMs);
                    } catch (Exception ignored) {
                    }
                }
            });
        }

        @JavascriptInterface
        public long getCurrentPositionMs() {
            return currentPosMs;
        }

        @JavascriptInterface
        public void setMuted(final boolean muted) {
            isMutedState = muted;
            mainHandler.post(() -> {
                if (exoPlayer != null) {
                    try {
                        exoPlayer.setVolume(muted ? 0f : 1f);
                    } catch (Exception ignored) {
                    }
                }
            });
        }

        @JavascriptInterface
        public int adjustVolume(final int deltaStep) {
            try {
                AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
                if (am == null) return 100;
                int direction = deltaStep > 0 ? AudioManager.ADJUST_RAISE : AudioManager.ADJUST_LOWER;
                am.adjustStreamVolume(AudioManager.STREAM_MUSIC, direction, AudioManager.FLAG_SHOW_UI);
                int cur = am.getStreamVolume(AudioManager.STREAM_MUSIC);
                int max = Math.max(1, am.getStreamMaxVolume(AudioManager.STREAM_MUSIC));
                int pct = Math.round((cur * 100f) / max);
                if (pct > 0 && isMutedState) {
                    setMuted(false);
                }
                return pct;
            } catch (Exception e) {
                return 100;
            }
        }

        @JavascriptInterface
        public String cycleAudioTrack() {
            final String[] resultLabel = new String[]{""};
            final CountDownLatch latch = new CountDownLatch(1);
            mainHandler.post(() -> {
                try {
                    if (exoPlayer != null) {
                        Tracks tracks = exoPlayer.getCurrentTracks();
                        List<Tracks.Group> audioGroups = new ArrayList<>();
                        int selectedIdx = 0;
                        for (Tracks.Group g : tracks.getGroups()) {
                            if (g.getType() == C.TRACK_TYPE_AUDIO && g.length > 0) {
                                if (g.isSelected()) {
                                    selectedIdx = audioGroups.size();
                                }
                                audioGroups.add(g);
                            }
                        }
                        if (audioGroups.size() > 1) {
                            int nextIdx = (selectedIdx + 1) % audioGroups.size();
                            Tracks.Group nextGroup = audioGroups.get(nextIdx);
                            TrackGroup mediaGroup = nextGroup.getMediaTrackGroup();
                            exoPlayer.setTrackSelectionParameters(
                                    exoPlayer.getTrackSelectionParameters()
                                            .buildUpon()
                                            .setOverrideForType(new TrackSelectionOverride(mediaGroup, 0))
                                            .build()
                            );
                            Format fmt = nextGroup.getTrackFormat(0);
                            String label = fmt.label != null ? fmt.label
                                    : (fmt.language != null ? fmt.language.toUpperCase(Locale.ROOT) : ("Audio " + (nextIdx + 1)));
                            resultLabel[0] = label;
                        }
                    }
                } catch (Exception ignored) {
                } finally {
                    latch.countDown();
                }
            });
            try {
                latch.await(500, TimeUnit.MILLISECONDS);
            } catch (InterruptedException ignored) {
            }
            return resultLabel[0];
        }

        @JavascriptInterface
        public void saveNativeState(String key, String value) {
            if (key == null) return;
            try {
                SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
                prefs.edit().putString(key, value != null ? value : "").apply();
            } catch (Exception ignored) {
            }
        }

        @JavascriptInterface
        public String loadNativeState(String key) {
            if (key == null) return "";
            try {
                SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
                return prefs.getString(key, "");
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public String scanUsbDrives() {
            try {
                List<File> candidateDirs = new ArrayList<>();
                addCandidateDir(candidateDirs, new File("/storage"));
                addCandidateDir(candidateDirs, new File("/mnt/media_rw"));
                addCandidateDir(candidateDirs, new File("/mnt/usb"));
                addCandidateDir(candidateDirs, new File("/mnt/usb_storage"));

                File[] extDirs = getExternalFilesDirs(null);
                if (extDirs != null) {
                    for (File d : extDirs) {
                        if (d == null) continue;
                        File cur = d;
                        while (cur.getParentFile() != null && !cur.getParentFile().getName().equals("storage")) {
                            cur = cur.getParentFile();
                        }
                        if (!candidateDirs.contains(cur)) {
                            candidateDirs.add(cur);
                        }
                    }
                }

                for (File root : candidateDirs) {
                    if (root == null || !root.exists() || !root.canRead()) continue;
                    File[] files = root.listFiles();
                    if (files == null) continue;

                    File configFile = null;
                    File m3uFile = null;
                    File epgFile = null;

                    for (File f : files) {
                        if (!f.isFile() || !f.canRead()) continue;
                        String lower = f.getName().toLowerCase(Locale.ROOT);
                        if (lower.equals("iptv.json") || lower.equals("vertiptv.json") || lower.equals("config.json")) {
                            configFile = f;
                        } else if (m3uFile == null && (lower.endsWith(".m3u") || lower.endsWith(".m3u8") || lower.endsWith(".txt")) && !lower.contains("readme")) {
                            m3uFile = f;
                        } else if (epgFile == null && lower.endsWith(".xml") && !lower.equals("config.xml")) {
                            epgFile = f;
                        }
                    }

                    if (configFile != null || m3uFile != null) {
                        JSONObject res = new JSONObject();
                        res.put("available", true);
                        res.put("found", true);
                        res.put("label", root.getName());
                        if (configFile != null) {
                            String rawCfg = readFileUtf8(configFile, 2 * 1024 * 1024);
                            try {
                                res.put("config", new JSONObject(rawCfg));
                            } catch (Exception ignored) {
                            }
                        }
                        res.put("m3uText", m3uFile != null ? readFileUtf8(m3uFile, 25 * 1024 * 1024) : "");
                        res.put("m3uName", m3uFile != null ? m3uFile.getName() : "");
                        res.put("epgText", epgFile != null ? readFileUtf8(epgFile, 45 * 1024 * 1024) : "");
                        res.put("epgName", epgFile != null ? epgFile.getName() : "");
                        return res.toString();
                    }
                }

                JSONObject none = new JSONObject();
                none.put("available", true);
                none.put("found", false);
                none.put("reason", "No USB pendrive with iptv.json or .m3u found in TV USB port");
                return none.toString();
            } catch (Exception e) {
                try {
                    JSONObject err = new JSONObject();
                    err.put("available", true);
                    err.put("found", false);
                    err.put("reason", "USB scan error: " + e.getMessage());
                    return err.toString();
                } catch (Exception ignored) {
                    return "{\"available\":false,\"found\":false}";
                }
            }
        }

        @JavascriptInterface
        public void fetchUrlAsync(final int reqId, final String urlStr) {
            fetchUrlFilteredAsync(reqId, urlStr, "");
        }

        @JavascriptInterface
        public void fetchUrlFilteredAsync(final int reqId, final String urlStr, final String filterSpec) {
            bgExecutor.execute(() -> {
                try {
                    String decoded = downloadStreamToFilteredUtf8(urlStr, filterSpec);
                    pendingFetchPayloads.put(reqId, decoded);
                    mainHandler.post(() -> {
                        if (webView == null) return;
                        webView.evaluateJavascript(
                                "if (window.__onAndroidFetchReady) { window.__onAndroidFetchReady(" + reqId + ", true, ''); }",
                                null
                        );
                    });
                } catch (Throwable e) {
                    final String errMsg = JSONObject.quote(e.getMessage() != null ? e.getMessage() : e.toString());
                    mainHandler.post(() -> {
                        if (webView == null) return;
                        webView.evaluateJavascript(
                                "if (window.__onAndroidFetchReady) { window.__onAndroidFetchReady(" + reqId + ", false, " + errMsg + "); }",
                                null
                        );
                    });
                }
            });
        }

        @JavascriptInterface
        public String takeFetchedText(final int reqId) {
            String val = pendingFetchPayloads.remove(reqId);
            return val != null ? val : "";
        }

        @JavascriptInterface
        public String fetchUrlBase64(String urlStr) {
            try {
                byte[] raw = downloadBytesFollowRedirects(urlStr);
                return Base64.encodeToString(raw, Base64.NO_WRAP);
            } catch (Exception e) {
                return "ERROR:" + (e.getMessage() != null ? e.getMessage() : e.toString());
            }
        }

        @JavascriptInterface
        public void setVideoSurfaceVisible(final boolean visible) {
            mainHandler.post(() -> {
                if (webView != null) {
                    webView.setBackgroundColor(Color.TRANSPARENT);
                }
            });
        }

        @JavascriptInterface
        public void setEditingInput(boolean editing) {
            isEditingInputState = editing;
        }

        @JavascriptInterface
        public void exitApp() {
            runOnUiThread(() -> finishAffinity());
        }

        private void addCandidateDir(List<File> list, File parent) {
            if (parent == null || !parent.exists() || !parent.canRead()) return;
            File[] children = parent.listFiles();
            if (children == null) return;
            for (File child : children) {
                if (child.isDirectory() && !child.getName().equalsIgnoreCase("self") && !list.contains(child)) {
                    list.add(child);
                }
            }
        }

        private String readFileUtf8(File f, int maxBytes) throws Exception {
            long len = Math.min(f.length(), maxBytes);
            byte[] buf = new byte[(int) len];
            try (FileInputStream fis = new FileInputStream(f)) {
                int read = 0;
                while (read < buf.length) {
                    int r = fis.read(buf, read, buf.length - read);
                    if (r == -1) break;
                    read += r;
                }
                return new String(buf, 0, read, StandardCharsets.UTF_8);
            }
        }
    }
}
