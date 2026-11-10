(function (global) {
  'use strict';

  var NS = (global.vertIPTV = global.vertIPTV || {});

  var DEMO_CHANNELS = [
    {
      num: 1,
      name: 'Vert Info 24 HD',
      tvgId: 'demo.info24',
      group: 'News & Info',
      url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
      shows: [
        ['Poranek Informacyjny', 'Live morning headlines, weather radar, and market brief.'],
        ['Raport Dnia', 'Midday news summary and parliamentary live desk.'],
        ['Debata Ekspertów', 'In-depth commentary on technology and European affairs.'],
        ['Wiadomości Wieczorne', 'Main evening news edition with live correspondents.'],
        ['Kronika Świata', 'International stories and late-night press review.']
      ]
    },
    {
      num: 2,
      name: 'Arena Sport 1 FHD',
      tvgId: 'demo.sport1',
      group: 'Sports',
      url: 'https://cph-p2p-msl.akamaized.net/hls/live/2000341/test/master.m3u8',
      shows: [
        ['Magazyn Ligowy', 'Goals, tactical breakdown, and weekend highlights.'],
        ['Studio Live: Piłka Nożna', 'Pre-match studio, lineups, and pitchside interviews.'],
        ['Mecz Dnia: Liga Mistrzów', 'Full 90-minute European football clash in HD.'],
        ['Trzecia Połowa', 'Post-match reactions, refereeing analysis, and stats.'],
        ['Noc Sportów Walki', 'Classic bouts and championship highlights.']
      ]
    },
    {
      num: 3,
      name: 'Cinema Prime 4K',
      tvgId: 'demo.cinema',
      group: 'Movies',
      url: 'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8',
      shows: [
        ['Klasyka Polskiego Kina', 'Restored cinema classic with behind-the-scenes intro.'],
        ['Kino Akcji: Pościg', 'High-octane thriller set across European capitals.'],
        ['Premiera Wieczoru: Horyzont', 'Sci-fi feature film about deep-space exploration.'],
        ['Seans Konesera', 'Award-winning festival drama.'],
        ['Nocny Thriller', 'Late-night mystery suspense feature.']
      ]
    },
    {
      num: 4,
      name: 'Natura & Nauka HD',
      tvgId: 'demo.nature',
      group: 'Documentary',
      url: 'https://test-streams.mux.dev/pts_shift/master.m3u8',
      shows: [
        ['Dzika Planeta', '4K wildlife cinematography from mountain ecosystems.'],
        ['Sekrety Inżynierii', 'How megastructures, bridges, and tunnels are built.'],
        ['Kosmos Bez Tajemnic', 'Orbital telescopes and exoplanet discoveries.'],
        ['Głębiny Oceanu', 'Bioluminescent life in the Mariana Trench.']
      ]
    },
    {
      num: 5,
      name: 'Muzyka Live TV',
      tvgId: 'demo.music',
      group: 'Music',
      url: 'https://moctobpltc-i.akamaihd.net/hls/live/571329/eight/playlist.m3u8',
      shows: [
        ['Poranna Playlista', 'Upbeat hits and fresh releases.'],
        ['Top 20 Tygodnia', 'Countdown of the week’s biggest tracks.'],
        ['Koncert Live Studio', 'Unplugged live studio session.'],
        ['Klubowa Noc', 'Electronic & house DJ mix.']
      ]
    }
  ];

  function buildDemoBundle() {
    var nowSec = Math.floor(Date.now() / 1000);
    // Align schedule slots neatly on 60/90-minute boundaries starting 4 days back
    var startAnchor = Math.floor((nowSec - 4 * 86400) / 3600) * 3600;
    var endAnchor = nowSec + 24 * 3600;

    var channels = [];
    var groupCounts = {};
    var groups = [];
    var epgByBucket = Object.create(null);

    for (var i = 0; i < DEMO_CHANNELS.length; i++) {
      var src = DEMO_CHANNELS[i];
      if (!groupCounts[src.group]) {
        groupCounts[src.group] = 0;
        groups.push(src.group);
      }
      groupCounts[src.group]++;

      var ch = {
        key: src.tvgId + '::' + i,
        num: src.num,
        name: src.name,
        normName: NS.Parser.normalizeKey(src.name),
        group: src.group,
        logo: '',
        url: src.url,
        tvgId: src.tvgId,
        tvgName: src.name,
        catchupType: 'shift',
        catchupSource: '',
        catchupDays: 3,
        isDemo: true
      };
      channels.push(ch);

      var schedule = [];
      var cursor = startAnchor;
      var slotIdx = i;
      var durations = [3600, 5400, 3600, 4500, 2700];
      while (cursor < endAnchor) {
        var dur = durations[slotIdx % durations.length];
        var meta = src.shows[slotIdx % src.shows.length];
        schedule.push({
          s: cursor,
          e: cursor + dur,
          t: meta[0],
          d: meta[1]
        });
        cursor += dur;
        slotIdx++;
      }
      epgByBucket[src.tvgId] = schedule;
    }

    return {
      channels: channels,
      groups: groups.map(function (g) {
        return { name: g, count: groupCounts[g] };
      }),
      epgByBucket: epgByBucket
    };
  }

  NS.DemoData = {
    buildDemoBundle: buildDemoBundle
  };
})(window);
