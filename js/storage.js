(function (global) {
  'use strict';

  var NS = (global.vertIPTV = global.vertIPTV || {});

  var SETTINGS_KEY = 'vertiptv_settings_v1';
  var FAVORITES_KEY = 'vertiptv_favorites_v1';
  var RECENTS_KEY = 'vertiptv_recents_v1';
  var LAST_CH_KEY = 'vertiptv_last_channel_v1';

  var DB_NAME = 'vertiptv_cache_v1';
  var DB_VERSION = 1;
  var STORE_NAME = 'snapshots';
  var TIZEN_STATE_FILE = 'vertiptv-state-v1.json';

  var DEFAULT_SETTINGS = {
    m3uUrl: '',
    epgUrl: '',
    catchupMode: 'auto', // 'auto' | 'shift' | 'xc' | 'flussonic' | 'append'
    catchupDays: 3,
    epgOffsetMin: 0,
    preferEngine: 'auto', // 'auto' | 'avplay' | 'hls'
    useCorsProxy: false,
    showSearch: false,
    lang: 'en' // 'en' | 'de' | 'pl'
  };

  function safeJsonParse(raw, fallback) {
    if (!raw) return fallback;
    try {
      return JSON.parse(raw);
    } catch (_) {
      return fallback;
    }
  }

  function normalizeSettingsObj(src) {
    var parsed = src || {};
    var merged = {};
    for (var k in DEFAULT_SETTINGS) {
      if (Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, k)) {
        merged[k] = parsed[k] !== undefined ? parsed[k] : DEFAULT_SETTINGS[k];
      }
    }
    merged.catchupDays = Math.max(1, Math.min(3, Number(merged.catchupDays) || 3));
    merged.epgOffsetMin = Number(merged.epgOffsetMin) || 0;
    merged.showSearch = !!merged.showSearch;
    if (merged.lang !== 'en' && merged.lang !== 'de' && merged.lang !== 'pl') {
      merged.lang = 'en';
    }
    return merged;
  }

  // Native Samsung Tizen `wgt-private` file storage — survives Smart Hub WebView cache wipes & TV power cuts!
  function hasTizenPrivateFs() {
    return !!(global.tizen && global.tizen.filesystem && typeof global.tizen.filesystem.resolve === 'function');
  }

  // Native Android TV `SharedPreferences` bridge — survives Android TV WebView cache clears!
  function hasAndroidBridgeStorage() {
    return !!(
      global.AndroidTvBridge &&
      typeof global.AndroidTvBridge.saveNativeState === 'function' &&
      typeof global.AndroidTvBridge.loadNativeState === 'function'
    );
  }

  var ANDROID_STATE_KEY = 'vertiptv_state_v1';

  function writeAndroidNativeState(stateObj) {
    if (!hasAndroidBridgeStorage()) return;
    try {
      global.AndroidTvBridge.saveNativeState(ANDROID_STATE_KEY, JSON.stringify(stateObj));
    } catch (_) {}
  }

  function readAndroidNativeState() {
    if (!hasAndroidBridgeStorage()) return null;
    try {
      var raw = global.AndroidTvBridge.loadNativeState(ANDROID_STATE_KEY);
      return safeJsonParse(raw, null);
    } catch (_) {
      return null;
    }
  }

  function writeTizenPrivateState(stateObj) {
    if (!hasTizenPrivateFs()) return;
    try {
      global.tizen.filesystem.resolve(
        'wgt-private',
        function (dir) {
          var file;
          try {
            file = dir.resolve(TIZEN_STATE_FILE);
          } catch (_) {
            try {
              file = dir.createFile(TIZEN_STATE_FILE);
            } catch (_2) {
              return;
            }
          }
          file.openStream(
            'w',
            function (fs) {
              try {
                fs.write(JSON.stringify(stateObj));
                fs.close();
              } catch (_) {
                try { fs.close(); } catch (_3) {}
              }
            },
            function () {},
            'UTF-8'
          );
        },
        function () {},
        'rw'
      );
    } catch (_) {}
  }

  function readTizenPrivateState() {
    if (!hasTizenPrivateFs()) return Promise.resolve(null);
    return new Promise(function (resolve) {
      try {
        global.tizen.filesystem.resolve(
          'wgt-private',
          function (dir) {
            var file;
            try {
              file = dir.resolve(TIZEN_STATE_FILE);
            } catch (_) {
              resolve(null);
              return;
            }
            file.openStream(
              'r',
              function (fs) {
                try {
                  var txt = fs.read(file.fileSize);
                  fs.close();
                  resolve(safeJsonParse(txt, null));
                } catch (_) {
                  try { fs.close(); } catch (_2) {}
                  resolve(null);
                }
              },
              function () {
                resolve(null);
              },
              'UTF-8'
            );
          },
          function () {
            resolve(null);
          },
          'r'
        );
      } catch (_) {
        resolve(null);
      }
    });
  }

  function loadSettings() {
    var current = safeJsonParse(localStorage.getItem(SETTINGS_KEY), {});
    if (!current.m3uUrl && !current.epgUrl) {
      var legacyKeys = ['samsiptv_settings_v1', 'pulsetv_settings_v1'];
      for (var i = 0; i < legacyKeys.length; i++) {
        var leg = safeJsonParse(localStorage.getItem(legacyKeys[i]), null);
        if (leg && (leg.m3uUrl || leg.epgUrl)) {
          current = leg;
          try {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(leg));
          } catch (_) {}
          break;
        }
      }
    }
    return normalizeSettingsObj(current);
  }

  function persistEverywhere(mergedSettings) {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(mergedSettings));
    } catch (_) {}
    putDbKey('settings_backup', mergedSettings).catch(function () {});
    var fullState = {
      settings: mergedSettings,
      favorites: safeJsonParse(localStorage.getItem(FAVORITES_KEY), []),
      recents: safeJsonParse(localStorage.getItem(RECENTS_KEY), []),
      lastChannel: getLastChannel()
    };
    writeTizenPrivateState(fullState);
    writeAndroidNativeState(fullState);
  }

  function saveSettings(next) {
    var merged = loadSettings();
    for (var k in next) {
      if (Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, k)) {
        merged[k] = next[k];
      }
    }
    merged = normalizeSettingsObj(merged);
    persistEverywhere(merged);
    return merged;
  }

  // Quad-redundant recovery on cold TV boot: localStorage -> Android SharedPreferences -> Tizen wgt-private -> IndexedDB
  function loadSettingsGuaranteed() {
    var sync = loadSettings();
    if (sync.m3uUrl) {
      return Promise.resolve(sync);
    }
    var androidData = readAndroidNativeState();
    if (androidData && androidData.settings && (androidData.settings.m3uUrl || androidData.settings.epgUrl)) {
      if (Array.isArray(androidData.favorites) && !localStorage.getItem(FAVORITES_KEY)) {
        try { localStorage.setItem(FAVORITES_KEY, JSON.stringify(androidData.favorites)); } catch (_) {}
      }
      if (androidData.lastChannel && !getLastChannel()) {
        setLastChannel(androidData.lastChannel);
      }
      var recoveredAndroid = normalizeSettingsObj(androidData.settings);
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(recoveredAndroid)); } catch (_) {}
      return Promise.resolve(recoveredAndroid);
    }
    return readTizenPrivateState()
      .then(function (tizenData) {
        if (tizenData && tizenData.settings && (tizenData.settings.m3uUrl || tizenData.settings.epgUrl)) {
          if (Array.isArray(tizenData.favorites) && !localStorage.getItem(FAVORITES_KEY)) {
            try { localStorage.setItem(FAVORITES_KEY, JSON.stringify(tizenData.favorites)); } catch (_) {}
          }
          if (tizenData.lastChannel && !getLastChannel()) {
            setLastChannel(tizenData.lastChannel);
          }
          var recovered = normalizeSettingsObj(tizenData.settings);
          try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(recovered)); } catch (_) {}
          return recovered;
        }
        return loadSnapshot('settings_backup').then(function (idbSettings) {
          if (idbSettings && (idbSettings.m3uUrl || idbSettings.epgUrl)) {
            var recoveredIdb = normalizeSettingsObj(idbSettings);
            try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(recoveredIdb)); } catch (_) {}
            return recoveredIdb;
          }
          return sync;
        });
      })
      .catch(function () {
        return sync;
      });
  }

  function loadFavorites() {
    var arr = safeJsonParse(localStorage.getItem(FAVORITES_KEY), []);
    return new Set(Array.isArray(arr) ? arr : []);
  }

  function saveFavorites(favSet) {
    var arr = Array.from(favSet);
    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(arr));
    } catch (_) {}
    var fullState = {
      settings: loadSettings(),
      favorites: arr,
      recents: loadRecents(),
      lastChannel: getLastChannel()
    };
    writeTizenPrivateState(fullState);
    writeAndroidNativeState(fullState);
  }

  function loadRecents() {
    var arr = safeJsonParse(localStorage.getItem(RECENTS_KEY), []);
    return Array.isArray(arr) ? arr : [];
  }

  function pushRecent(channelKey) {
    if (!channelKey) return [];
    var list = loadRecents().filter(function (k) {
      return k !== channelKey;
    });
    list.unshift(channelKey);
    if (list.length > 25) list.length = 25;
    try {
      localStorage.setItem(RECENTS_KEY, JSON.stringify(list));
    } catch (_) {}
    return list;
  }

  function getLastChannel() {
    try {
      return localStorage.getItem(LAST_CH_KEY) || '';
    } catch (_) {
      return '';
    }
  }

  function setLastChannel(channelKey) {
    try {
      localStorage.setItem(LAST_CH_KEY, channelKey || '');
    } catch (_) {}
  }

  var sharedDbPromise = null;

  function openDb() {
    if (sharedDbPromise) return sharedDbPromise;
    sharedDbPromise = new Promise(function (resolve, reject) {
      if (typeof indexedDB === 'undefined') {
        sharedDbPromise = null;
        reject(new Error('IndexedDB unavailable'));
        return;
      }
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = function () {
        var db = req.result;
        db.onversionchange = function () {
          try { db.close(); } catch (_) {}
          sharedDbPromise = null;
        };
        db.onclose = function () {
          sharedDbPromise = null;
        };
        resolve(db);
      };
      req.onerror = function () {
        sharedDbPromise = null;
        reject(req.error || new Error('IndexedDB open failed'));
      };
    });
    return sharedDbPromise;
  }

  function putDbKey(key, payload) {
    return openDb()
      .then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx;
          try {
            tx = db.transaction(STORE_NAME, 'readwrite');
          } catch (e) {
            sharedDbPromise = null;
            reject(e);
            return;
          }
          var store = tx.objectStore(STORE_NAME);
          store.put(payload, key);
          tx.oncomplete = function () {
            resolve(true);
          };
          tx.onerror = function () {
            reject(tx.error);
          };
        });
      });
  }

  function saveSnapshot(key, payload) {
    return putDbKey(key, payload).catch(function () {
      // Low-storage 2017 TV fallback: if full EPG exceeds WebView IndexedDB quota, save channels-only snapshot!
      if (payload && payload.epgByBucket) {
        var slim = {
          m3uUrl: payload.m3uUrl,
          epgUrl: payload.epgUrl,
          sourceLabel: payload.sourceLabel,
          channels: payload.channels,
          groups: payload.groups,
          epgByBucket: {},
          savedAt: payload.savedAt
        };
        return putDbKey(key, slim).catch(function () {
          return false;
        });
      }
      return false;
    });
  }

  function loadSnapshot(key) {
    return openDb()
      .then(function (db) {
        return new Promise(function (resolve) {
          var tx;
          try {
            tx = db.transaction(STORE_NAME, 'readonly');
          } catch (_) {
            sharedDbPromise = null;
            resolve(null);
            return;
          }
          var store = tx.objectStore(STORE_NAME);
          var req = store.get(key);
          req.onsuccess = function () {
            resolve(req.result || null);
          };
          req.onerror = function () {
            resolve(null);
          };
        });
      })
      .catch(function () {
        return null;
      });
  }

  function clearSnapshots() {
    return openDb()
      .then(function (db) {
        return new Promise(function (resolve) {
          var tx;
          try {
            tx = db.transaction(STORE_NAME, 'readwrite');
          } catch (_) {
            sharedDbPromise = null;
            resolve(false);
            return;
          }
          var store = tx.objectStore(STORE_NAME);
          store.delete('active_playlist');
          store.delete('active_epg');
          tx.oncomplete = function () {
            resolve(true);
          };
          tx.onerror = function () {
            resolve(false);
          };
        });
      })
      .catch(function () {
        return false;
      });
  }

  NS.Storage = {
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    loadSettings: loadSettings,
    loadSettingsGuaranteed: loadSettingsGuaranteed,
    saveSettings: saveSettings,
    loadFavorites: loadFavorites,
    saveFavorites: saveFavorites,
    loadRecents: loadRecents,
    pushRecent: pushRecent,
    getLastChannel: getLastChannel,
    setLastChannel: setLastChannel,
    saveSnapshot: saveSnapshot,
    loadSnapshot: loadSnapshot,
    clearSnapshots: clearSnapshots
  };
})(window);
