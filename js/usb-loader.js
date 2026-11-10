(function (global) {
  'use strict';

  var NS = (global.vertIPTV = global.vertIPTV || {});

  function hasTizenFs() {
    return typeof global.tizen !== 'undefined' && global.tizen && global.tizen.filesystem;
  }

  function readTizenFileText(fileObj) {
    return new Promise(function (resolve, reject) {
      try {
        fileObj.openStream(
          'r',
          function (fs) {
            try {
              var content = fs.read(fileObj.fileSize);
              fs.close();
              resolve(content || '');
            } catch (err) {
              try {
                fs.close();
              } catch (_) {}
              reject(err);
            }
          },
          function (err) {
            reject(err);
          },
          'UTF-8'
        );
      } catch (e) {
        reject(e);
      }
    });
  }

  function scanStorageLabel(label) {
    return new Promise(function (resolve) {
      global.tizen.filesystem.resolve(
        label,
        function (dir) {
          dir.listFiles(
            function (files) {
              var found = {
                label: label,
                configFile: null,
                m3uFile: null,
                epgFile: null
              };
              for (var i = 0; i < files.length; i++) {
                var f = files[i];
                if (!f.isFile) continue;
                var lower = f.name.toLowerCase();
                if (lower === 'iptv.json' || lower === 'vertiptv.json' || lower === 'config.json') {
                  found.configFile = f;
                } else if (!found.m3uFile && /\.(m3u8?|txt)$/i.test(lower) && lower.indexOf('readme') === -1) {
                  found.m3uFile = f;
                } else if (!found.epgFile && /epg.*\.xml$|^guide\.xml$|\.xml$/i.test(lower) && lower !== 'config.xml') {
                  found.epgFile = f;
                }
              }
              resolve(found);
            },
            function () {
              resolve(null);
            }
          );
        },
        function () {
          resolve(null);
        },
        'r'
      );
    });
  }

  // Scans mounted USB pendrives on Samsung Tizen OS for iptv.json or *.m3u + *.xml
  function scanUsbPendrive() {
    if (!hasTizenFs()) {
      return Promise.resolve({ available: false, reason: 'Not running on Tizen TV filesystem' });
    }

    return new Promise(function (resolve) {
      global.tizen.filesystem.listStorages(
        function (storages) {
          var usbLabels = [];
          for (var i = 0; i < storages.length; i++) {
            if (storages[i].type === 'EXTERNAL' && storages[i].state === 'MOUNTED') {
              usbLabels.push(storages[i].label);
            }
          }
          if (!usbLabels.length) {
            resolve({ available: true, found: false, reason: 'No USB pendrive detected in TV port' });
            return;
          }

          Promise.all(usbLabels.map(scanStorageLabel)).then(function (results) {
            var match = null;
            for (var r = 0; r < results.length; r++) {
              if (results[r] && (results[r].configFile || results[r].m3uFile)) {
                match = results[r];
                break;
              }
            }
            if (!match) {
              resolve({
                available: true,
                found: false,
                reason: 'USB found (' + usbLabels.join(', ') + '), but no iptv.json or .m3u file in root'
              });
              return;
            }

            var jobs = [
              match.configFile ? readTizenFileText(match.configFile) : Promise.resolve(''),
              match.m3uFile ? readTizenFileText(match.m3uFile) : Promise.resolve(''),
              match.epgFile ? readTizenFileText(match.epgFile) : Promise.resolve('')
            ];

            Promise.all(jobs)
              .then(function (contents) {
                var cfgJson = null;
                if (contents[0]) {
                  try {
                    cfgJson = JSON.parse(contents[0]);
                  } catch (_) {}
                }
                resolve({
                  available: true,
                  found: true,
                  label: match.label,
                  config: cfgJson,
                  m3uText: contents[1] || '',
                  m3uName: match.m3uFile ? match.m3uFile.name : '',
                  epgText: contents[2] || '',
                  epgName: match.epgFile ? match.epgFile.name : ''
                });
              })
              .catch(function (err) {
                resolve({
                  available: true,
                  found: false,
                  reason: 'Failed reading USB file: ' + (err && err.message ? err.message : String(err))
                });
              });
          });
        },
        function (err) {
          resolve({
            available: false,
            reason: 'Storage scan error: ' + (err && err.message ? err.message : String(err))
          });
        }
      );
    });
  }

  NS.UsbLoader = {
    hasTizenFs: hasTizenFs,
    scanUsbPendrive: scanUsbPendrive
  };
})(window);
