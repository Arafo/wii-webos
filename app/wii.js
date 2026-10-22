/*
 * wiiOS for webOS: the console's channel menu as the home screen of an LG TV. Twelve channels to a
 * page with the next page's first column at the edge, a segment clock and the date, the round
 * buttons, a pointing hand that follows the focus, and the sounds.
 *
 * A port of WiiMenuView.java from wii-tv (https://github.com/MauroProto/wii-tv, MIT). Geometry is in
 * pixels of a 1920 x 1080 capture of the original ("ref px"), which is also this app's resolution.
 * The backdrop, the button body and the empty slot are images in img/, rendered from wii-tv's
 * WiiBase and WiiPalette: the TV's CPU is too slow to compute them per pixel at start-up.
 *
 * Nothing is painted per frame: the TV's CPU is slow. Channels and buttons are painted once; focus
 * is a pre-painted glow that fades in and out, and the hand, the page scroll and the button zoom
 * are CSS transitions, all of which the compositor runs on the GPU. Written in ES5 for webOS 4's
 * Chromium 53.
 */
(function () {
  'use strict';

  var CFG = window.CONFIG || {};
  var DATA = window.TV_APPS || { apps: [], inputs: [] };

  // ---- geometry (ref px) ------------------------------------------------------------------------

  var SLOTS = 12, MIN_PAGES = 4;
  var TILE_X0 = 163, TILE_Y0 = 93.5, TILE_W = 381, TILE_H = 204.5;
  var COL_PITCH = 404, ROW_PITCH = 228, PAGE_W = COL_PITCH * 4;
  var TILE_R = 25, TILE_BULGE = 3, TILE_BORDER = 4.5;
  var TILE_M = 6;    // tile canvas margin: bulge and border
  var RING_M = 16;   // focus glow canvas margin
  var ART_W = 381, ART_H = 205;

  var ARROW_L = 1797.5, ARROW_TIP = 1850, ARROW_T = 365, ARROW_B = 462.5, ARROW_Y = 414;

  var CX = 959.5;
  var BTN_CX = 172.1, BTN_CY = 908.9, BTN_RING = 88.6, BTN_RIGHT_CX = 2 * CX - BTN_CX;
  var BTN_SIZE = 187, BTN_M = 20;
  var SD_L = 356, SD_T = 897, SD_R = 424, SD_B = 994, SD_M = 24;

  var DIGIT_W = 50, DIGIT_H = 79, DIGIT_T = 12, DIGIT_GAP = 2.5, CLOCK_TOP = 789;
  var DIGIT_X = [825, 886, 983, 1044];
  var COLON_X = 959.5, COLON_DOT = 11, COLON_Y1 = 811.5, COLON_Y2 = 844.5;
  var AMPM_X = 1142, AMPM_P_W = 24, AMPM_M_X = 1172, AMPM_M_W = 28, AMPM_BASE = 869, AMPM_CAP = 34;
  var DATE_TRACKING = 2, DATE_EXTRA_SPACE = 3, DATE_BASE = 981, DATE_CAP = 55;
  var CLOCK_BOX = { x: 600, y: 770, w: 720, h: 240 };

  var HAND_REF_X = 1072, HAND_REF_Y = 894, HAND_UNIT = 1920 / 1024;

  var BLUE = [63, 192, 236], BORDER = '#b5b5b5', BLUE_CSS = '#3fc0ec';
  var CLOCK_COLOR = '#9a9a9a', DATE_COLOR = '#7c7c7c';
  var SANS = '"Roboto", "Droid Sans", "Helvetica Neue", Arial, sans-serif';

  // Segment bits a-g per digit; the original's 7 keeps the upper-left bar.
  var SEGMENTS = [0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x27, 0x7F, 0x6F];
  // The segment bits in the order the segment outlines are listed: a, d, f, b, e, c, g.
  var SEGMENT_ORDER = [0x01, 0x08, 0x20, 0x02, 0x10, 0x04, 0x40];

  var BTN_SETTINGS = -1, BTN_SD = -2, BTN_INPUTS = -3;
  var KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, OK: 13, BACK: 461, ESC: 27, BACKSPACE: 8, PLAY: 415 };
  var INTRO_AUTO_MS = 12000;

  // ---- strings ------------------------------------------------------------------------------------

  var STRINGS = {
    en: {
      introTitle: 'Before you start',
      introBody: 'Sit at a comfortable distance from the screen and rest your eyes now and then. ' +
        'Your apps, the HDMI inputs and live TV are where they always were.',
      introContinue: 'Press OK to continue.',
      inputs: 'Inputs', liveTv: 'Live TV',
      days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], monthFirst: true,
      games: 'Games', wiiMenu: 'Wii Menu', play: 'Play',
      gamesEmptyTitle: 'No games yet', gamesEmptyBody: 'Add them from your computer with tools/games.py.',
      gamesMissing: 'Set RetroArch up with tools/games.py --setup to play.',
      keyA: 'OK: A', keyB: 'Back: B', keyMenu: 'Hold red: RetroArch menu'
    },
    es: {
      introTitle: 'Antes de empezar',
      introBody: 'Ponte a una distancia cómoda de la pantalla y descansa la vista de vez en cuando. ' +
        'Tus aplicaciones, las entradas HDMI y la TV en directo están donde siempre.',
      introContinue: 'Pulsa OK para continuar.',
      inputs: 'Entradas', liveTv: 'TV en directo',
      days: ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'], monthFirst: false,
      games: 'Juegos', wiiMenu: 'Menú Wii', play: 'Jugar',
      gamesEmptyTitle: 'Todavía no hay juegos', gamesEmptyBody: 'Añádelos desde el ordenador con tools/games.py.',
      gamesMissing: 'Prepara RetroArch con tools/games.py --setup para jugar.',
      keyA: 'OK: A', keyB: 'Atrás: B', keyMenu: 'Mantén el rojo: menú de RetroArch'
    }
  };
  var LANG = String(CFG.language || navigator.language || 'en').slice(0, 2).toLowerCase();
  var T = STRINGS[LANG] || STRINGS.en;

  // ---- helpers ------------------------------------------------------------------------------------

  function $(id) { return document.getElementById(id); }

  function rgba(c, a) {
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + Math.max(0, Math.min(1, a)).toFixed(3) + ')';
  }

  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.ceil(w);
    c.height = Math.ceil(h);
    return c;
  }

  function place(el, x, y, w, h) {
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    if (w !== undefined) {
      el.width = Math.ceil(w);
      el.height = Math.ceil(h);
      el.style.width = Math.ceil(w) + 'px';
      el.style.height = Math.ceil(h) + 'px';
    }
  }

  // Sets a transform with no transition, for an element's first position.
  function jump(el, transform) {
    el.style.transition = 'none';
    el.style.transform = transform;
    el.offsetWidth;   // eslint-disable-line no-unused-expressions -- forces the style to apply now
    el.style.transition = '';
  }

  function loadImage(src, cb) {
    if (!src) return null;
    var img = new Image();
    img.onload = function () { img.ready = true; if (cb) cb(img); };
    img.onerror = function () { img.failed = true; if (cb) cb(img); };
    img.src = src;
    return img;
  }

  function traceRoundRect(c, l, t, r, b, rad) {
    rad = Math.min(rad, (r - l) / 2, (b - t) / 2);
    c.beginPath();
    c.moveTo(l + rad, t);
    c.arcTo(r, t, r, b, rad);
    c.arcTo(r, b, l, b, rad);
    c.arcTo(l, b, l, t, rad);
    c.arcTo(l, t, r, t, rad);
    c.closePath();
  }

  // A closed polygon with its corners rounded, as Android's CornerPathEffect draws it.
  function tracePoly(c, pts, rad) {
    var n = pts.length / 2;
    c.beginPath();
    c.moveTo((pts[2 * n - 2] + pts[0]) / 2, (pts[2 * n - 1] + pts[1]) / 2);
    for (var i = 0; i < n; i++) {
      var p = (i + n - 1) % n, q = (i + 1) % n;
      var x0 = pts[2 * p], y0 = pts[2 * p + 1], x1 = pts[2 * i], y1 = pts[2 * i + 1];
      var x2 = pts[2 * q], y2 = pts[2 * q + 1];
      var d1 = Math.hypot(x0 - x1, y0 - y1), d2 = Math.hypot(x2 - x1, y2 - y1);
      // The arc meets each edge rad / tan(angle / 2) from the corner; a sharp corner beside a short
      // edge must take a smaller radius, or the arc overshoots the edge and the outline folds over.
      var cos = d1 && d2 ? ((x0 - x1) * (x2 - x1) + (y0 - y1) * (y2 - y1)) / (d1 * d2) : 1;
      var half = Math.acos(Math.max(-1, Math.min(1, cos))) / 2;
      var r = Math.min(rad, Math.min(d1, d2) / 2 * Math.tan(half));
      c.arcTo(x1, y1, (x1 + x2) / 2, (y1 + y2) / 2, r);
    }
    c.closePath();
  }

  // A channel frame: rounded corners joined by sides that bow out by b in the middle.
  function traceTile(c, tw, th, r, b) {
    var k = r * 0.4477;
    c.beginPath();
    c.moveTo(r, 0);
    c.quadraticCurveTo(tw / 2, -2 * b, tw - r, 0);
    c.bezierCurveTo(tw - k, 0, tw, k, tw, r);
    c.quadraticCurveTo(tw + 2 * b, th / 2, tw, th - r);
    c.bezierCurveTo(tw, th - k, tw - k, th, tw - r, th);
    c.quadraticCurveTo(tw / 2, th + 2 * b, r, th);
    c.bezierCurveTo(k, th, 0, th - k, 0, th - r);
    c.quadraticCurveTo(-2 * b, th / 2, 0, r);
    c.bezierCurveTo(0, k, k, 0, r, 0);
    c.closePath();
  }

  function ellipsize(c, text, maxW) {
    if (c.measureText(text).width <= maxW) return text;
    var s = text;
    while (s.length > 1 && c.measureText(s + '…').width > maxW) s = s.slice(0, -1);
    return s + '…';
  }

  // ---- luna bus -----------------------------------------------------------------------------------

  var bridges = [];   // keep a reference: a collected bridge drops its callback

  function luna(uri, params, cb) {
    try {
      var b = new PalmServiceBridge();
      b.onservicecallback = function (msg) {
        var res;
        try { res = JSON.parse(msg); } catch (e) { res = { returnValue: false }; }
        if (cb) cb(res);
        bridges.splice(bridges.indexOf(b), 1);
      };
      bridges.push(b);
      b.call(uri, JSON.stringify(params || {}));
    } catch (e) {
      if (cb) cb({ returnValue: false, errorText: String(e) });
    }
  }

  function launch(id) {
    if (!id) return;
    luna('luna://com.webos.applicationManager/launch', { id: id }, function (res) {
      if (res.returnValue === false) console.log('launch ' + id + ' failed: ' + (res.errorText || ''));
    });
  }

  // ---- sounds -------------------------------------------------------------------------------------

  // Web Audio, not <audio>: on webOS every <audio> element opens a media pipeline and claims one of
  // the TV's few hardware audio decoders, which the apps the menu opens need.
  var SOUND_FILES = { move: 'wii_move', page: 'wii_page', select: 'wii_select', menu: 'wii_menu',
    back: 'wii_back', start: 'wii_start' };
  var actx = null, buffers = {};

  // Each sound is the file config.js names for it under sounds/, or wii-tv's synthesised one when
  // there is none or it won't load.
  function initSounds() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (CFG.sounds === false || !AC) return;
    try { actx = new AC(); } catch (e) { return; }
    var chosen = CFG.soundFiles || {};
    Object.keys(SOUND_FILES).forEach(function (k) {
      var builtIn = 'sounds/' + SOUND_FILES[k] + '.wav';
      load(chosen[k] ? 'sounds/' + chosen[k] : builtIn);
      function load(url) {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url);
        xhr.responseType = 'arraybuffer';
        xhr.onload = function () {
          if (!xhr.response) return fallback();
          actx.decodeAudioData(xhr.response, function (b) { buffers[k] = b; }, fallback);
        };
        xhr.onerror = fallback;
        xhr.send();
        function fallback() { if (url !== builtIn) load(builtIn); }
      }
    });
  }

  function sound(k) {
    if (!actx || !buffers[k]) return;
    if (actx.state === 'suspended' && actx.resume) actx.resume();
    var src = actx.createBufferSource();
    src.buffer = buffers[k];
    src.connect(actx.destination);
    src.start(0);
  }

  // ---- channels -----------------------------------------------------------------------------------

  var channels = [];
  var GAMES = window.TV_GAMES || null;

  // The Games channel comes first once RetroArch is set up (tools/games.py); RetroArch then has no
  // channel of its own, as in wii-tv.
  function hasGamesChannel() {
    return !!GAMES && CFG.gamesChannel !== false && (GAMES.ready || GAMES.games.length > 0);
  }

  function buildChannels() {
    var hidden = (CFG.hiddenApps || []).slice();
    var byId = {};
    DATA.apps.forEach(function (a) { byId[a.id] = a; });
    var order = [];
    if (hasGamesChannel()) {
      order.push({ id: '@games', title: T.games, special: 'games' });
      hidden.push(GAMES.app);
    }
    (CFG.firstApps || []).forEach(function (id) {
      if (byId[id] && hidden.indexOf(id) < 0 && order.indexOf(byId[id]) < 0) order.push(byId[id]);
    });
    DATA.apps.forEach(function (a) {
      if (hidden.indexOf(a.id) < 0 && order.indexOf(a) < 0) order.push(a);
    });
    channels = order.map(function (app, i) {
      var ch = { app: app, slot: i };
      ch.icon = loadImage(app.icon, function () { drawTile(ch.slot); });
      return ch;
    });
  }

  // The colour round an icon's edge, or null when its edge is see-through or not one colour.
  function edgeColour(img) {
    var n = img.naturalWidth, m = img.naturalHeight, c = makeCanvas(n, m).getContext('2d');
    var px;
    try {
      c.drawImage(img, 0, 0);
      px = c.getImageData(0, 0, n, m).data;
    } catch (e) {
      return null;   // canvas tainted
    }
    // Two pixels in from each edge, skipping the corners, which icons often round off.
    var r = 0, g = 0, b = 0, count = 0, seen = 0, samples = [];
    var step = Math.max(1, Math.floor(Math.min(n, m) / 24));
    for (var i = Math.floor(Math.min(n, m) * 0.15); i < Math.min(n, m) * 0.85; i += step) {
      [[i, 2], [i, m - 3], [2, i], [n - 3, i]].forEach(function (p) {
        var o = (p[1] * n + p[0]) * 4;
        seen++;
        if (px[o + 3] < 220) return;
        r += px[o]; g += px[o + 1]; b += px[o + 2];
        count++;
        samples.push([px[o], px[o + 1], px[o + 2]]);
      });
    }
    if (count < seen * 0.75) return null;
    var avg = [Math.round(r / count), Math.round(g / count), Math.round(b / count)];
    var off = 0;
    samples.forEach(function (s) {
      if (Math.abs(s[0] - avg[0]) + Math.abs(s[1] - avg[1]) + Math.abs(s[2] - avg[2]) > 60) off++;
    });
    return off > samples.length * 0.25 ? null : 'rgb(' + avg.join(',') + ')';
  }

  // A channel's banner. wii-tv uses each Android app's own TV banner; webOS apps have none, so the
  // banner is the app's colour across the whole frame with its logo large in the middle. Without
  // an icon, the app's name on white.
  function drawArt(c, ch) {
    var icon = ch.icon && ch.icon.ready ? ch.icon : null;
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, ART_W, ART_H);
    if (ch.app.special === 'games') {
      drawScene(c, ART_W, ART_H, 0.2, 1.5, T.games);
      return;
    }

    if (icon) {
      if (ch.fill === undefined) ch.fill = edgeColour(icon) || ch.app.iconColor || '';
      if (ch.fill) {
        c.fillStyle = ch.fill;
        c.fillRect(0, 0, ART_W, ART_H);
      }
      var size = Math.min(ART_H * 0.8, icon.naturalHeight * 1.3);
      c.drawImage(icon, (ART_W - size) / 2, (ART_H - size) / 2, size, size);
      // A soft shine over the top half, as the console's channels have; over the logo too, so the
      // icon's square doesn't show.
      var shine = c.createLinearGradient(0, 0, 0, ART_H);
      shine.addColorStop(0, 'rgba(255,255,255,0.16)');
      shine.addColorStop(0.5, 'rgba(255,255,255,0)');
      c.fillStyle = shine;
      c.fillRect(0, 0, ART_W, ART_H);
      return;
    }

    var g = c.createLinearGradient(0, 0, 0, ART_H);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, '#e9e9e9');
    c.fillStyle = g;
    c.fillRect(0, 0, ART_W, ART_H);
    c.font = 'bold ' + Math.round(ART_H * 0.15) + 'px ' + SANS;
    c.fillStyle = '#7a7a7a';
    c.textAlign = 'center';
    c.fillText(ellipsize(c, ch.app.title, ART_W * 0.86), ART_W / 2, ART_H * 0.55);
  }

  // ---- pixel art (Games channel) ------------------------------------------------------------------

  // Ported from wii-tv's PixelArt and PixelScene: sprites from rows of characters, a 5 x 7 font, game
  // cartridges, and the channel's meadow with the little runner. wii-tv animates the meadow; here it is
  // drawn once, at the moment the runner jumps for a gem.

  // Rows of A-Z, 5 bits each, leftmost pixel in bit 4.
  var FONT = [
    [0x0E, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11], [0x1E, 0x11, 0x11, 0x1E, 0x11, 0x11, 0x1E],
    [0x0E, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0E], [0x1E, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1E],
    [0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x1F], [0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x10],
    [0x0E, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0F], [0x11, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11],
    [0x0E, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0E], [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0C],
    [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11], [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1F],
    [0x11, 0x1B, 0x15, 0x15, 0x11, 0x11, 0x11], [0x11, 0x11, 0x19, 0x15, 0x13, 0x11, 0x11],
    [0x0E, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E], [0x1E, 0x11, 0x11, 0x1E, 0x10, 0x10, 0x10],
    [0x0E, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0D], [0x1E, 0x11, 0x11, 0x1E, 0x14, 0x12, 0x11],
    [0x0F, 0x10, 0x10, 0x0E, 0x01, 0x01, 0x1E], [0x1F, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
    [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E], [0x11, 0x11, 0x11, 0x11, 0x11, 0x0A, 0x04],
    [0x11, 0x11, 0x11, 0x15, 0x15, 0x15, 0x0A], [0x11, 0x11, 0x0A, 0x04, 0x0A, 0x11, 0x11],
    [0x11, 0x11, 0x0A, 0x04, 0x04, 0x04, 0x04], [0x1F, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1F]
  ];
  var GAME_PALETTE = ['#e8432e', '#2f7de1', '#3fa34d', '#f29d16', '#8e5bd8', '#16a9a4', '#e5508c'];

  // '#rrggbb' or '#aarrggbb' as [r, g, b, a].
  function rgbOf(hex) {
    var s = hex.slice(1), a = 255;
    if (s.length === 8) { a = parseInt(s.slice(0, 2), 16); s = s.slice(2); }
    return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16), a];
  }

  function mix(a, b, t) {
    var x = rgbOf(a), y = rgbOf(b), out = '#';
    for (var i = 0; i < 3; i++) out += ('0' + Math.round(x[i] * (1 - t) + y[i] * t).toString(16)).slice(-2);
    return out;
  }

  // A canvas of w x h pixels, each coloured by colorAt(x, y): a '#rrggbb' or '#aarrggbb', or nothing.
  function pixelCanvas(w, h, colorAt) {
    var cv = makeCanvas(w, h), c = cv.getContext('2d'), img = c.createImageData(w, h), d = img.data;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var col = colorAt(x, y);
        if (!col) continue;
        var v = rgbOf(col), o = (y * w + x) * 4;
        d[o] = v[0]; d[o + 1] = v[1]; d[o + 2] = v[2]; d[o + 3] = v[3];
      }
    }
    c.putImageData(img, 0, 0);
    return cv;
  }

  // A sprite from rows of characters, one pixel each; colors maps a character to its colour.
  function sprite(rows, colors) {
    var w = 0;
    rows.forEach(function (r) { w = Math.max(w, r.length); });
    return pixelCanvas(w, rows.length, function (x, y) { return colors[rows[y].charAt(x)]; });
  }

  // The word in capitals without accents, or null when the font has no glyph for one of its letters.
  function fontText(word) {
    var plain = String(word).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
    return plain && /^[A-Z ]+$/.test(plain) ? plain : null;
  }

  function glyphOn(g, x, y) { return x >= 0 && y >= 0 && x < 5 && y < 7 && (g[y] & (0x10 >> x)) !== 0; }

  // The word in the 5 x 7 font: a fill with a lighter top row, a one-pixel outline and a drop shadow.
  function pixelWord(text, fill, top, outline, shadow) {
    var w = -1, i;
    for (i = 0; i < text.length; i++) w += text.charAt(i) === ' ' ? 4 : 6;
    var bw = w + 2, bh = 10, on = [], row = [], x0 = 1;
    for (i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (ch === ' ') { x0 += 4; continue; }
      var g = FONT[ch.charCodeAt(0) - 65];
      for (var y = 0; y < 7; y++) {
        for (var x = 0; x < 5; x++) {
          if (glyphOn(g, x, y)) { on[(y + 1) * bw + x0 + x] = true; row[(y + 1) * bw + x0 + x] = y; }
        }
      }
      x0 += 6;
    }
    function near(x, y) {
      for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          var xx = x + dx, yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < bw && yy < bh && on[yy * bw + xx]) return true;
        }
      }
      return false;
    }
    return pixelCanvas(bw, bh, function (x, y) {
      if (on[y * bw + x]) return row[y * bw + x] === 0 ? top : fill;
      if (near(x, y)) return outline;
      if (y > 0 && near(x, y - 1)) return shadow;
      return null;
    });
  }

  // The first letter of the title the font can draw, accents dropped.
  function initial(title) {
    var plain = String(title).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
    for (var i = 0; i < plain.length; i++) if (/[A-Z]/.test(plain.charAt(i))) return plain.charAt(i);
    return '';
  }

  var CART_W = 24, CART_H = 28;

  // A game cartridge: a grey shell with grip grooves, a label in the game's colour with the title's
  // initial, and the gold contacts under it.
  function cartridge(color, title) {
    var w = CART_W, h = CART_H, end = h - 4;
    var OUT = '#3e444e', BODY = '#b8bec7', LIGHT = '#dde1e6', DARK = '#8d949f';
    function inside(x, y) {
      if (x < 0 || y < 0 || x >= w || y >= h) return false;
      var corner = (x === 0 || x === w - 1) && (y === 0 || y === end);
      return (y <= end && !corner) || (y > end && x >= 4 && x <= w - 5);
    }
    var letter = initial(title), g = letter ? FONT[letter.charCodeAt(0) - 65] : null;
    var ink = mix(color, '#000000', 0.45);
    function glyphAt(x, y) {
      if (!g) return null;
      var gx = x - 9, gy = y - 9;
      if (glyphOn(g, gx, gy)) return '#ffffff';
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) if (glyphOn(g, gx + dx, gy + dy)) return ink;
      return null;
    }
    return pixelCanvas(w, h, function (x, y) {
      if (!inside(x, y)) return null;
      if (y >= 6 && y <= 19 && x >= 3 && x <= w - 4) {
        var lbl = glyphAt(x, y);
        if (lbl && y > 6 && y < 19 && x > 3 && x < w - 4) return lbl;
        if (y === 6 || x === 3) return DARK;
        if (y === 19 || x === w - 4) return LIGHT;
        if (y === 7) return mix(color, '#ffffff', 0.35);
        if (y === 17) return mix(color, '#ffffff', 0.5);
        if (y === 18) return mix(color, '#000000', 0.25);
        return color;
      }
      if (x >= 3 && x <= w - 4 && y >= 2 && y <= 4) return y === 3 ? LIGHT : DARK;
      var edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
      if (edge) return OUT;
      if (y > end) return x % 2 === 1 ? (y === h - 2 ? '#c9952a' : '#f2c14e') : '#6b5320';
      if (y === end) return OUT;
      if (x === 1 || y === 1) return LIGHT;
      if (x === w - 2 || y === end - 1) return DARK;
      return BODY;
    });
  }

  // ---- the meadow (PixelScene) --------------------------------------------------------------------

  var SCENE = null;
  var ROWS = 60, GROUND = 52, SPACING = 64, FIRST_ROCK = 40, JUMP_H = 10, JUMP_HALF = 16;
  var SKY = ['#6ec3ee', '#84cdf1', '#9ad6f4', '#b0dff6', '#c6e8f9', '#daf1fb'];

  function hills(w, h, base, a1, a2, f2, phase, fill, top, dot) {
    var heights = [];
    for (var x = 0; x < w; x++) {
      var v = base + a1 * Math.sin(2 * Math.PI * x / w) + a2 * Math.sin(2 * Math.PI * f2 * x / w + phase);
      heights.push(Math.max(0, h - Math.round(v)));
    }
    return pixelCanvas(w, h, function (x, y) {
      var y0 = heights[x];
      if (y < y0) return null;
      if (y === y0) return top;
      return y > y0 + 1 && (x * 7 + y * 13) % 11 === 0 ? dot : fill;
    });
  }

  function sceneSprites() {
    if (SCENE) return SCENE;
    var blob = { k: '#1d5a80', b: '#3fc0ec', l: '#b5ecfc', w: '#ffffff', p: '#ff9db8' };
    var body = ['...kkkkkk...', '.kkbbbbbbkk.', '.kbllbbbbbk.', 'kblbbbbbbbbk', 'kbbbbbbwwbwk',
      'kbbbbbbwkbkk', 'kbbbbbbbbbbk', 'kbbbbbpbbbpk', 'kbbbbbbbbbbk', '.kbbbbbbbbk.'];
    var gold = { k: '#9a5b00', w: '#fffbd6', y: '#ffd02e', o: '#f29d16' };
    var sky = { w: '#ffffff', s: '#d3ecf8' };
    SCENE = {
      jump: sprite(body.concat(['.kkkkkkkkkk.', 'kk........kk']), blob),
      runA: sprite(body.concat(['..kkkkkkkk..', '..kk....kk..']), blob),
      gem: sprite(['..kkk..', '.kwyyk.', 'kwyyyok', 'kyyyyok', '.kyyok.', '..kok..', '...k...'], gold),
      rock: sprite(['...kkk...', '..kllgk..', '.klggggk.', 'kgggggddk', 'kgggdgddk', 'kkkkkkkkk'],
        { k: '#56606b', l: '#e0e5ea', g: '#afb8c2', d: '#8a94a0' }),
      cloud: sprite(['......wwww..........', '....wwwwwwww..www...', '..wwwwwwwwwwwwwwwww.',
        '.wwwwwwwwwwwwwwwwwww', 'wwwwwwwwwwwwwwwwwwww', 'wwwwwwwwwwwwwwwwwwww', '.ssssssssssssssssss.'], sky),
      cloudSmall: sprite(['...wwww.....', '.wwwwwwwww..', 'wwwwwwwwwwww', 'wwwwwwwwwwww', '.ssssssssss.'], sky),
      flowers: ['#ff6b6b', '#ffffff', '#ff9edb'].map(function (petal) {
        return sprite(['.r.', 'rcr', '.r.', '.g.'], { r: petal, c: '#ffd43b', g: '#3e9a3a' });
      }),
      hillsFar: hills(96, 20, 10, 4, 2.5, 3, 1.3, '#a9ddb8', '#c9edd2', '#9bd3ab'),
      hillsNear: hills(64, 13, 6, 3, 1.5, 2, 0.4, '#71c68b', '#95d9a6', '#63b97e'),
      ground: pixelCanvas(32, 9, function (x, y) {
        if (y === 0) return x % 4 === 1 || x % 16 === 10 ? '#6cc653' : null;
        if (y === 1) return '#8bdb6a';
        if (y === 2) return '#63c04e';
        if (y === 3) return x % 4 < 2 ? '#4fa63f' : '#63c04e';
        var hsh = (x * 31 + y * 17) % 23;
        return hsh === 0 ? '#b57e45' : hsh === 7 ? '#e4b27c' : '#d29a5f';
      })
    };
    return SCENE;
  }

  // The scene in (0, 0, w, h) with the runner at heroAt of the width, mid-jump under a gem, and the
  // label in bouncing letters titleTop art pixels down.
  function drawScene(c, w, h, heroAt, titleTop, label) {
    var S = sceneSprites(), p = h / ROWS, wa = w / p;
    var heroX = Math.round(wa * heroAt), heroMid = heroX + 6;
    var k0 = Math.ceil((heroMid - FIRST_ROCK - 4.5) / SPACING);
    var scroll = FIRST_ROCK + 4.5 + k0 * SPACING - heroMid - 1;   // just before the top of the jump
    var t = scroll / 16;
    c.save();
    c.beginPath();
    c.rect(0, 0, w, h);
    c.clip();
    c.scale(p, p);
    c.imageSmoothingEnabled = false;
    for (var i = 0; i < SKY.length; i++) {
      c.fillStyle = SKY[i];
      c.fillRect(0, i * 9, wa, (i === SKY.length - 1 ? GROUND : (i + 1) * 9) - i * 9);
    }
    for (var bx = -((t * 2) % 120); bx < wa; bx += 120) {
      c.drawImage(S.cloud, bx + 8, 5);
      c.drawImage(S.cloudSmall, bx + 62, 15);
      c.drawImage(S.cloudSmall, bx + 95, 3);
    }
    [[S.hillsFar, t * 4], [S.hillsNear, t * 8], [S.ground, scroll]].forEach(function (s, n) {
      var img = s[0], y = n === 2 ? GROUND - 1 : GROUND - img.height;
      for (var x = -(s[1] % img.width); x < wa; x += img.width) c.drawImage(img, x, y);
    });
    for (var k = Math.floor((scroll - 60 - FIRST_ROCK) / SPACING); k <= Math.ceil((scroll + wa - FIRST_ROCK) / SPACING); k++) {
      var x = FIRST_ROCK + k * SPACING - scroll, f = ((k % 3) + 3) % 3;
      c.drawImage(S.flowers[f], x + 28, GROUND - 4);
      c.drawImage(S.flowers[(f + 1) % 3], x + 43, GROUND - 4);
      c.drawImage(S.rock, x, GROUND - 6);
      if (heroMid - (x + 4.5) < 0) c.drawImage(S.gem, x + 1, 23);
    }
    var world = heroMid + scroll, near = Math.round((world - FIRST_ROCK - 4.5) / SPACING);
    var u = (world - (FIRST_ROCK + 4.5 + near * SPACING)) / JUMP_HALF;
    var lift = Math.abs(u) < 1 ? JUMP_H * (1 - u * u) : 0;
    c.fillStyle = 'rgba(0,0,0,0.19)';
    var sw = 8 - lift * 0.4;
    c.fillRect(heroMid - sw / 2, GROUND, sw, 1);
    c.drawImage(lift > 0.5 ? S.jump : S.runA, heroX, Math.round(GROUND - 12 - lift));

    var word = fontText(label);
    if (word) {
      var x0 = 0, xs = [], letters = [], n = 0;
      for (i = 0; i < word.length; i++) {
        if (word.charAt(i) === ' ') { x0 += 4; continue; }
        var col = GAME_PALETTE[n++ % GAME_PALETTE.length];
        letters.push(pixelWord(word.charAt(i), col, mix(col, '#ffffff', 0.45), '#ffffff', '#8022324a'));
        xs.push(x0);
        x0 += 6;
      }
      var left = Math.round((wa - (x0 + 1) * 2) / 2);
      letters.forEach(function (img, j) {
        var bob = Math.round(Math.sin(t * 3.4 - j * 0.7) * 1.2);
        c.drawImage(img, left + xs[j] * 2, titleTop + bob, img.width * 2, img.height * 2);
      });
    }
    c.restore();
    if (!word) {
      c.font = 'bold ' + Math.round(h * 0.17) + 'px ' + SANS;
      c.textAlign = 'center';
      c.lineWidth = h * 0.03;
      c.strokeStyle = '#22324a';
      c.strokeText(label, w / 2, h * 0.27);
      c.fillStyle = '#ffffff';
      c.fillText(label, w / 2, h * 0.27);
    }
  }

  // ---- state --------------------------------------------------------------------------------------

  var pages = MIN_PAGES;
  var focus = 0, page = 0;
  var menuOpen = false, menuFocus = 0, menuItems = [];
  var introUp = false, introTimer = null;

  function slotPos(slot) {
    var pg = Math.floor(slot / SLOTS), i = slot % SLOTS, row = Math.floor(i / 4), col = i % 4;
    return { x: TILE_X0 + (pg * 4 + col) * COL_PITCH, y: TILE_Y0 + row * ROW_PITCH };
  }

  // Where the hand's fingertip goes for this focus.
  function handTarget(f) {
    if (f >= 0) {
      var p = slotPos(f);
      return [p.x - page * PAGE_W + TILE_W * 0.70, p.y + TILE_H * 0.80];
    }
    if (f === BTN_SD) return [(SD_L + SD_R) / 2 + 10, (SD_T + SD_B) / 2 + 14];
    var cx = f === BTN_SETTINGS ? BTN_CX : BTN_RIGHT_CX;
    return [cx + 26, BTN_CY + 22];
  }

  // ---- static images ------------------------------------------------------------------------------

  var IMG = {};
  var emptyArt = null;

  function loadStatic(done) {
    var names = ['backdrop', 'button', 'empty'], left = names.length;
    names.forEach(function (n) {
      IMG[n] = loadImage('img/' + n + '.png', function () {
        if (--left > 0) return;
        emptyArt = makeCanvas(ART_W, ART_H);
        if (IMG.empty.ready) emptyArt.getContext('2d').drawImage(IMG.empty, -4, -4);
        done();
      });
    });
  }

  // ---- tiles --------------------------------------------------------------------------------------

  // One canvas per page holds its twelve channels. Every canvas is a layer the TV composites on each
  // animated frame, and with a canvas per channel that alone cost 30-50 ms a frame.
  var strip, pageCanvases = [];
  var PAGE_X0 = TILE_X0 - TILE_M, PAGE_Y0 = Math.floor(TILE_Y0) - TILE_M;
  var PAGE_CW = 3 * COL_PITCH + TILE_W + 2 * TILE_M, PAGE_CH = Math.ceil(2 * ROW_PITCH + TILE_H) + 2 * TILE_M + 1;

  // Every page, painted once: the first right away, the rest a few channels at a time.
  function createTiles() {
    for (var p = 0; p < pages; p++) {
      var c = makeCanvas(PAGE_CW, PAGE_CH);
      c.className = 'page';
      c.page = p;
      place(c, PAGE_X0 + p * PAGE_W, PAGE_Y0);
      c.addEventListener('mousemove', onPageHover);
      c.addEventListener('click', onPageClick);
      strip.appendChild(c);
      pageCanvases.push(c);
    }
    var next = 0, total = pages * SLOTS;
    (function paint() {
      for (var n = 0; n < 4 && next < total; n++) drawTile(next++);
      if (next < total) setTimeout(paint, 16);
    })();
  }

  // The channel under a point of a page canvas, or -1 between channels.
  function slotAt(cv, x, y) {
    for (var i = 0; i < SLOTS; i++) {
      var slot = cv.page * SLOTS + i, pos = slotPos(slot);
      var lx = pos.x - cv.page * PAGE_W - PAGE_X0, ly = pos.y - PAGE_Y0;
      if (x >= lx && x <= lx + TILE_W && y >= ly && y <= ly + TILE_H) return slot;
    }
    return -1;
  }

  function drawTile(slot) {
    var cv = pageCanvases[Math.floor(slot / SLOTS)];
    if (!cv) return;
    var c = cv.getContext('2d');
    var pos = slotPos(slot);
    var lx = pos.x - Math.floor(slot / SLOTS) * PAGE_W - PAGE_X0, ly = pos.y - PAGE_Y0;
    c.clearRect(lx - TILE_M, ly - TILE_M, TILE_W + 2 * TILE_M, TILE_H + 2 * TILE_M);
    c.save();
    c.translate(lx, ly);
    traceTile(c, TILE_W, TILE_H, TILE_R, TILE_BULGE);
    c.save();
    c.clip();
    var ch = channels[slot];
    if (ch) drawArt(c, ch);
    else if (emptyArt) c.drawImage(emptyArt, 0, 0);
    else { c.fillStyle = '#d6d6d6'; c.fillRect(0, 0, ART_W, ART_H); }
    c.restore();
    traceTile(c, TILE_W, TILE_H, TILE_R, TILE_BULGE);   // drawArt may have replaced the path
    c.strokeStyle = BORDER;
    c.lineWidth = TILE_BORDER;
    c.lineJoin = 'round';
    c.stroke();
    c.restore();
  }

  // ---- focus glow ---------------------------------------------------------------------------------

  // Two copies of the focused frame's blue border and glow, painted once. The one on the new
  // channel fades in while the other fades out on the old one.
  var rings = [], ringNow = 0;

  function drawRing(cv) {
    var c = cv.getContext('2d');
    c.translate(RING_M, RING_M + 0.5);
    traceTile(c, TILE_W, TILE_H, TILE_R, TILE_BULGE);
    c.lineJoin = 'round';
    for (var k = 3; k >= 1; k--) {
      c.strokeStyle = rgba(BLUE, 64 / k / 255);
      c.lineWidth = TILE_BORDER + k * 5;
      c.stroke();
    }
    c.strokeStyle = BLUE_CSS;
    c.lineWidth = TILE_BORDER + 1.5;
    c.stroke();
  }

  function createRings() {
    for (var i = 0; i < 2; i++) {
      var r = makeCanvas(TILE_W + 2 * RING_M, Math.ceil(TILE_H) + 2 * RING_M);
      r.className = 'ring';
      drawRing(r);
      strip.appendChild(r);
      rings.push(r);
    }
  }

  function showRing(slot) {
    rings[ringNow].style.opacity = 0;
    if (slot < 0) return;
    ringNow = 1 - ringNow;
    var r = rings[ringNow], pos = slotPos(slot);
    r.style.transition = 'none';
    r.style.opacity = 0;
    place(r, pos.x - RING_M, Math.floor(pos.y) - RING_M);
    r.offsetWidth;   // eslint-disable-line no-unused-expressions -- forces the style to apply now
    r.style.transition = '';
    r.style.opacity = 1;
  }

  // ---- arrows -------------------------------------------------------------------------------------

  var ARROW_BOX = { w: 72, h: 112, ox: 64, oy: 56 };

  function drawArrow(cv) {
    var c = cv.getContext('2d');
    var l = ARROW_L - ARROW_TIP, t = ARROW_T - ARROW_Y, b = ARROW_B - ARROW_Y;
    var pts = [0, 0, l, t];
    for (var i = 1; i < 10; i++) {   // the back edge curves in toward the tip
      var u = i / 10, v = 1 - u;
      pts.push(v * v * l + 2 * v * u * (l + 12) + u * u * l, v * v * t + u * u * b);
    }
    pts.push(l, b);
    c.translate(ARROW_BOX.ox, ARROW_BOX.oy);
    tracePoly(c, pts, 7);
    var body = c.createLinearGradient(0, t, 0, b);
    body.addColorStop(0, '#6fcdf3');
    body.addColorStop(0.35, '#a9e6fb');
    body.addColorStop(0.5, '#ddf8ff');
    body.addColorStop(0.62, '#9fe0f8');
    body.addColorStop(1, '#62c5f0');
    c.fillStyle = body;
    c.fill();
    var shine = c.createLinearGradient(l, 0, 0, 0);
    shine.addColorStop(0, 'rgba(255,255,255,0.4)');
    shine.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = shine;
    c.fill();
    c.strokeStyle = '#2e66c2';
    c.lineWidth = 3.2;
    c.lineJoin = 'round';
    c.stroke();
  }

  // ---- buttons ------------------------------------------------------------------------------------

  // Each button is a body painted once plus its glow, which fades in on focus while the wrapper
  // zooms; both are CSS transitions.
  function drawButton(wrap, id) {
    var size = BTN_SIZE + 2 * BTN_M, cc = size / 2;
    var body = wrap.querySelector('.body'), glow = wrap.querySelector('.glow');
    place(body, 0, 0, size, size);
    place(glow, 0, 0, size, size);
    var c = body.getContext('2d');
    if (IMG.button.ready) c.drawImage(IMG.button, BTN_M, BTN_M);
    if (id === BTN_SETTINGS) {
      var label = CFG.settingsLabel || 'wiiOS', fs = 52;
      c.font = 'bold ' + fs + 'px ' + SANS;
      var tw = c.measureText(label).width;
      if (tw > 128) c.font = 'bold ' + (fs * 128 / tw) + 'px ' + SANS;
      c.textAlign = 'center';
      c.fillStyle = 'rgba(255,255,255,0.6)';
      c.fillText(label, cc, cc + 19);
      c.fillStyle = '#a4a4a4';
      c.fillText(label, cc, cc + 17);
    } else {
      var ew = 97, eh = 65, l = cc - ew / 2, t = cc - eh / 2;
      c.fillStyle = '#939393';
      traceRoundRect(c, l, t, l + ew, t + eh, 5);
      c.fill();
      c.strokeStyle = '#e2e2e2';
      c.lineWidth = 4.5;
      c.lineJoin = 'round';
      c.beginPath();
      c.moveTo(l + 2, t + 14);
      c.lineTo(cc, t + 38);
      c.lineTo(l + ew - 2, t + 14);
      c.stroke();
    }
    var g = glow.getContext('2d');
    for (var k = 3; k >= 1; k--) {
      g.strokeStyle = rgba(BLUE, 70 / k / 255);
      g.lineWidth = 3 + k * 5;
      g.beginPath();
      g.arc(cc, cc, BTN_RING, 0, Math.PI * 2);
      g.stroke();
    }
  }

  function drawSd(wrap) {
    var w = SD_R - SD_L + 2 * SD_M, h = SD_B - SD_T + 2 * SD_M;
    var body = wrap.querySelector('.body'), glow = wrap.querySelector('.glow');
    place(body, 0, 0, w, h);
    place(glow, 0, 0, w, h);
    var pts = [SD_L, SD_T, SD_R - 9, SD_T, SD_R, SD_T + 9, SD_R, SD_B, SD_L, SD_B];
    var c = body.getContext('2d');
    c.translate(SD_M - SD_L, SD_M - SD_T);
    c.save();
    c.translate(4, 4);
    tracePoly(c, pts, 4);
    c.fillStyle = 'rgba(0,0,0,0.18)';
    c.fill();
    c.restore();
    tracePoly(c, pts, 4);
    c.fillStyle = '#5cc8ee';
    c.fill();
    c.fillStyle = '#a9ddf3';
    c.fillRect(SD_L + 4, SD_T + 4, SD_R - 10 - SD_L - 4, 915 - SD_T - 4);
    c.fillStyle = '#ffffff';
    c.fillRect(366, 915, 56, 60);
    c.fillStyle = '#4fc1ea';
    c.fillRect(366, 975, 56, 12);
    c.font = 'italic bold 24px ' + SANS;
    c.textAlign = 'center';
    c.fillStyle = '#59bde8';
    c.fillText('SD', 393, 953);
    var g = glow.getContext('2d');
    g.translate(SD_M - SD_L, SD_M - SD_T);
    for (var k = 3; k >= 1; k--) {
      tracePoly(g, pts, 4);
      g.strokeStyle = rgba(BLUE, 80 / k / 255);
      g.lineWidth = 2 + k * 4;
      g.stroke();
    }
  }

  // ---- clock --------------------------------------------------------------------------------------

  var clockKey = '';

  function digitSegments(i) {
    var t = DIGIT_T, g = DIGIT_GAP, k = t / 2;
    var ya = CLOCK_TOP, yb = CLOCK_TOP + DIGIT_H, ym = CLOCK_TOP + DIGIT_H / 2;
    var xa = DIGIT_X[i], xb = DIGIT_X[i] + DIGIT_W;
    return [
      [xa + g, ya, xb - g, ya, xb - t - g, ya + t, xa + t + g, ya + t],
      [xa + t + g, yb - t, xb - t - g, yb - t, xb - g, yb, xa + g, yb],
      [xa, ya + g, xa + t, ya + t + g, xa + t, ym - k - g, xa + k, ym - g, xa, ym - k - g],
      [xb, ya + g, xb, ym - k - g, xb - k, ym - g, xb - t, ym - k - g, xb - t, ya + t + g],
      [xa, ym + k + g, xa + k, ym + g, xa + t, ym + k + g, xa + t, yb - t - g, xa, yb - g],
      [xb, ym + k + g, xb, yb - g, xb - t, yb - t - g, xb - t, ym + k + g, xb - k, ym + g],
      [xa + k + g, ym, xa + t + g, ym - k, xb - t - g, ym - k, xb - k - g, ym, xb - t - g, ym + k,
        xa + t + g, ym + k]
    ];
  }
  var DIGIT_SEGS = [0, 1, 2, 3].map(digitSegments);

  function drawDigit(c, pos, digit) {
    var bits = SEGMENTS[digit];
    for (var k = 0; k < SEGMENT_ORDER.length; k++) {
      if (bits & SEGMENT_ORDER[k]) {
        tracePoly(c, DIGIT_SEGS[pos][k], 2.5);
        c.fill();
      }
    }
  }

  // One letter squeezed so its ink spans inkWidth, starting at inkLeft, on the AM/PM baseline.
  function drawInkLetter(c, letter, inkLeft, inkWidth) {
    var w = c.measureText(letter).width;
    var sx = w > 0 ? inkWidth / (w * 0.86) : 1;
    c.save();
    c.translate(inkLeft - w * 0.07 * sx, AMPM_BASE);
    c.scale(sx, 1);
    c.fillText(letter, 0, 0);
    c.restore();
  }

  function drawClock(force) {
    var now = new Date();
    var h24 = now.getHours(), hour = h24 % 12 || 12, min = now.getMinutes();
    var day = T.days[now.getDay()];
    var date = day + ' ' + (T.monthFirst ? (now.getMonth() + 1) + '/' + now.getDate()
      : now.getDate() + '/' + (now.getMonth() + 1));
    var key = hour + ':' + min + (h24 >= 12) + date;
    if (key === clockKey && !force) return;
    clockKey = key;

    var cv = $('clock'), c = cv.getContext('2d');
    c.clearRect(0, 0, cv.width, cv.height);
    c.save();
    c.translate(-CLOCK_BOX.x, -CLOCK_BOX.y);
    c.fillStyle = CLOCK_COLOR;
    if (hour >= 10) drawDigit(c, 0, Math.floor(hour / 10));
    drawDigit(c, 1, hour % 10);
    drawDigit(c, 2, Math.floor(min / 10));
    drawDigit(c, 3, min % 10);

    c.font = 'bold ' + (AMPM_CAP / 0.711).toFixed(1) + 'px ' + SANS;
    c.textAlign = 'left';
    drawInkLetter(c, h24 >= 12 ? 'P' : 'A', AMPM_X, AMPM_P_W);
    drawInkLetter(c, 'M', AMPM_M_X, AMPM_M_W);

    // The date, set looser than the font: about 2 px between letters and 3 more at the space.
    c.font = 'bold ' + (DATE_CAP / 0.711).toFixed(1) + 'px ' + SANS;
    c.fillStyle = DATE_COLOR;
    var chars = date.split(''), widths = [], total = 0;
    chars.forEach(function (ch, i) {
      var w = c.measureText(ch).width + (i < chars.length - 1 ? DATE_TRACKING : 0)
        + (ch === ' ' ? DATE_EXTRA_SPACE : 0);
      widths.push(w);
      total += w;
    });
    var x = CX - total / 2;
    chars.forEach(function (ch, i) {
      c.fillText(ch, x, DATE_BASE);
      x += widths[i];
    });
    c.restore();
  }

  function drawColon() {
    var cv = $('colon'), c = cv.getContext('2d'), d = COLON_DOT / 2;
    c.fillStyle = CLOCK_COLOR;
    traceRoundRect(c, 2, 2, 2 + COLON_DOT, 2 + COLON_DOT, 2);
    c.fill();
    traceRoundRect(c, 2, 2 + COLON_Y2 - COLON_Y1, 2 + COLON_DOT, 2 + COLON_Y2 - COLON_Y1 + COLON_DOT, 2);
    c.fill();
    place(cv, COLON_X - d - 2, COLON_Y1 - d - 2);
  }

  // ---- hand ---------------------------------------------------------------------------------------

  var HAND_BOX;

  // The pointing hand, fingertip at (0, 0): index finger up, three curled fingers, palm and thumb. The
  // menu and the Games channel each have one.
  function drawHand(cv) {
    var u = HAND_UNIT;
    HAND_BOX = { ox: Math.ceil(17 * u + 6), oy: 6, w: Math.ceil(46 * u + 12), h: Math.ceil(62 * u + 12) };
    cv.width = HAND_BOX.w;
    cv.height = HAND_BOX.h;
    cv.style.transformOrigin = HAND_BOX.ox + 'px ' + HAND_BOX.oy + 'px';
    var c = cv.getContext('2d');
    var shapes = [[0, 0, 11, 34, 5.5], [10, 16, 19, 34, 4.5], [18, 19, 26, 36, 4], [25, 22, 32, 38, 3.5],
      [-3, 26, 32, 50, 9], [-11, 25, 4, 37, 6]];
    // All in one path, same winding: a fill covers the union once.
    function traceHand() {
      c.beginPath();
      shapes.forEach(function (s) {
        var l = (s[0] - 5.5) * u, t = s[1] * u, r = (s[2] - 5.5) * u, b = s[3] * u, rad = s[4] * u;
        c.moveTo(l + rad, t);
        c.arcTo(r, t, r, b, rad);
        c.arcTo(r, b, l, b, rad);
        c.arcTo(l, b, l, t, rad);
        c.arcTo(l, t, r, t, rad);
        c.closePath();
      });
    }
    c.translate(HAND_BOX.ox, HAND_BOX.oy);
    c.save();
    c.translate(2.5 * u, 3.5 * u);
    traceHand();
    c.fillStyle = 'rgba(0,0,0,0.22)';
    c.fill();
    c.restore();
    // The outline of the union: stroke every part twice as wide, then fill over the inner half.
    traceHand();
    c.strokeStyle = '#3a3a3a';
    c.lineWidth = 2.2 * u * 2;
    c.lineJoin = 'round';
    c.stroke();
    c.fillStyle = '#ffffff';
    c.fill();
    c.lineWidth = 1.5 * u;
    c.lineCap = 'round';
    c.beginPath();
    [[10.6, 23, 10.6, 31], [18.4, 25, 18.4, 33], [25.6, 28, 25.6, 35], [3, 32, 9, 34]].forEach(function (l) {
      c.moveTo((l[0] - 5.5) * u, l[1] * u);
      c.lineTo((l[2] - 5.5) * u, l[3] * u);
    });
    c.stroke();
    traceRoundRect(c, -4.5 * u, 47 * u, 23.5 * u, 60 * u, 4 * u);
    c.fillStyle = '#47b6ea';
    c.fill();
    c.strokeStyle = '#2c86ba';
    c.lineWidth = 1.6 * u;
    c.stroke();
    c.font = 'bold ' + (10.5 * u).toFixed(1) + 'px ' + SANS;
    c.textAlign = 'center';
    c.fillStyle = '#ffffff';
    c.fillText('1', 9.5 * u, 53.5 * u + 3.8 * u);
  }

  function handTransform() {
    var p = handTarget(focus);
    return 'translate3d(' + (p[0] - HAND_BOX.ox).toFixed(1) + 'px,' + (p[1] - HAND_BOX.oy).toFixed(1)
      + 'px,0) rotate(-8deg)';
  }

  // ---- focus --------------------------------------------------------------------------------------

  // Shows the current focus and page: the glow, the button zoom, the hand and the scroll. The
  // compositor animates every change from here.
  function showFocus() {
    showRing(focus);
    [['btnL', BTN_SETTINGS], ['sd', BTN_SD], ['btnR', BTN_INPUTS]].forEach(function (b) {
      $(b[0]).className = 'button' + (focus === b[1] ? ' focused' : '');
    });
    $('hand').style.transform = handTransform();
    strip.style.transform = 'translate3d(' + (-page * PAGE_W) + 'px,0,0)';
    $('arrowR').style.visibility = page < pages - 1 ? 'visible' : 'hidden';
    $('arrowL').style.visibility = page > 0 ? 'visible' : 'hidden';
  }

  // ---- inputs menu --------------------------------------------------------------------------------

  var MENU = { w: 1000, itemH: 92, gap: 22, head: 150, pad: 56, rad: 40, m: 30 };

  function openInputs() {
    var items = [];
    (DATA.inputs || []).forEach(function (d) { items.push({ label: d.label, appId: d.appId }); });
    if (CFG.liveTvApp) items.push({ label: T.liveTv, appId: CFG.liveTvApp });
    if (!items.length) return;
    menuItems = items;
    menuFocus = 0;
    menuOpen = true;
    var n = items.length;
    MENU.h = MENU.head + n * MENU.itemH + (n - 1) * MENU.gap + MENU.pad;
    MENU.x = (1920 - MENU.w) / 2;
    MENU.y = (1080 - MENU.h) / 2;
    place($('menuPanel'), MENU.x - MENU.m, MENU.y - MENU.m, MENU.w + 2 * MENU.m, MENU.h + 2 * MENU.m);
    drawMenu();
    $('menu').className = 'open';
  }

  function closeMenu() {
    menuOpen = false;
    $('menu').className = '';
  }

  function menuItemBox(i) {
    var iy = MENU.y + MENU.head + i * (MENU.itemH + MENU.gap);
    return { l: MENU.x + 90, t: iy, r: MENU.x + MENU.w - 90, b: iy + MENU.itemH };
  }

  // Repainted only when the focus moves, a handful of times per second at most.
  function drawMenu() {
    var cv = $('menuPanel'), c = cv.getContext('2d');
    c.clearRect(0, 0, cv.width, cv.height);
    c.save();
    c.translate(MENU.m - MENU.x, MENU.m - MENU.y);
    traceRoundRect(c, MENU.x, MENU.y, MENU.x + MENU.w, MENU.y + MENU.h, MENU.rad);
    c.save();
    c.clip();
    if (IMG.backdrop && IMG.backdrop.ready) c.drawImage(IMG.backdrop, 0, 0);
    else { c.fillStyle = '#ededed'; c.fill(); }
    c.restore();
    c.strokeStyle = BORDER;
    c.lineWidth = TILE_BORDER;
    c.stroke();

    c.font = 'bold 48px ' + SANS;
    c.textAlign = 'center';
    c.fillStyle = DATE_COLOR;
    c.fillText(T.inputs, 960, MENU.y + 92);

    c.font = 'bold 40px ' + SANS;
    menuItems.forEach(function (it, i) {
      var b = menuItemBox(i), ir = MENU.itemH / 2, on = i === menuFocus;
      var g = c.createLinearGradient(0, b.t, 0, b.b);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(1, '#e2e2e2');
      traceRoundRect(c, b.l, b.t, b.r, b.b, ir);
      c.fillStyle = g;
      c.fill();
      if (on) {
        for (var k = 3; k >= 1; k--) {
          c.strokeStyle = rgba(BLUE, 70 / k / 255);
          c.lineWidth = 4 + k * 6;
          c.stroke();
        }
      }
      c.strokeStyle = on ? BLUE_CSS : BORDER;
      c.lineWidth = TILE_BORDER + (on ? 2 : 0);
      c.stroke();
      c.fillStyle = '#666666';
      c.fillText(ellipsize(c, it.label, b.r - b.l - 70), (b.l + b.r) / 2, (b.t + b.b) / 2 + 14);
    });
    c.restore();
  }

  function setMenuFocus(i) {
    if (i < 0 || i >= menuItems.length || i === menuFocus) return;
    menuFocus = i;
    sound('move');
    drawMenu();
  }

  function menuKey(k) {
    if (k === KEY.UP) setMenuFocus(menuFocus - 1);
    else if (k === KEY.DOWN) setMenuFocus(menuFocus + 1);
    else if (k === KEY.OK) menuActivate();
    else if (k === KEY.BACK || k === KEY.ESC || k === KEY.BACKSPACE) {
      sound('back');
      closeMenu();
    }
  }

  function menuActivate() {
    var it = menuItems[menuFocus];
    sound('select');
    closeMenu();
    setTimeout(function () { launch(it.appId); }, 150);
  }

  // ---- intro --------------------------------------------------------------------------------------

  function drawWarning() {
    var cv = $('warn'), c = cv.getContext('2d'), cx = 50, cy = 50, r = 38;
    tracePoly(c, [cx, cy - r, cx + r * 1.1, cy + r * 0.85, cx - r * 1.1, cy + r * 0.85], 6);
    c.fillStyle = '#ffc61e';
    c.fill();
    c.strokeStyle = '#1e1e1e';
    c.lineWidth = 4.5;
    c.stroke();
    c.font = 'bold ' + (r * 1.25) + 'px ' + SANS;
    c.textAlign = 'center';
    c.fillStyle = '#1e1e1e';
    c.fillText('!', cx, cy + r * 0.65);
  }

  function showIntro() {
    $('introTitle').textContent = T.introTitle;
    $('introBody').textContent = T.introBody;
    $('introText').textContent = T.introContinue;
    drawWarning();
    $('intro').className = 'shown';
    introUp = true;
    introTimer = setTimeout(dismissIntro, INTRO_AUTO_MS);
  }

  function dismissIntro() {
    if (!introUp) return;
    introUp = false;
    clearTimeout(introTimer);
    $('intro').className = 'leaving';
    // Out of the page once faded, so the full-screen layer stops costing anything.
    setTimeout(function () { if (!introUp) $('intro').className = ''; }, 700);
  }

  // ---- Games channel ------------------------------------------------------------------------------

  // The channel's start screen, after wii-tv's GamesView: the meadow as a header, the games as
  // cartridges on a shelf, the focused one's name, and the buttons Wii Menu, RetroArch and Play. Like
  // the menu, it is painted once and moves by CSS transitions.

  var GS = { HEADER_H: 300, SHELF_Y: 632, CART_PX: 8, PITCH: 250, BAND_Y: 892, BTN_Y: 986, BTN_H: 116,
    BTN_X: [500, 960, 1420], BTN_W: [460, 380, 460] };
  var PILL_MENU = 0, PILL_RETRO = 1, PILL_PLAY = 2, PILL_M = 30;
  // The remote's colour buttons as tools/games.py --setup maps them.
  var REMOTE = [['#e53935', 'Start'], ['#43a047', 'Select'], ['#fdd835', 'L'], ['#1e88e5', 'R']];
  var LAST_PLAYED = 'wiiwebos.lastPlayed';
  var shelf = { open: false, built: false, focus: 0, onShelf: false, button: PILL_PLAY, launching: false,
    slots: [], pills: [] };

  function shelfGames() { return GAMES ? GAMES.games : []; }
  function shelfReady() { return !!GAMES && GAMES.ready; }

  function pillEnabled(b) {
    return b === PILL_MENU || shelfReady() && (b === PILL_RETRO || shelfGames().length > 0);
  }

  // The stripes, the shelf, the band with its blue arc and the meadow header: all that holds still.
  function drawShelfBackdrop(cv) {
    var c = cv.getContext('2d'), w = 1920, h = 1080, g, y;
    c.fillStyle = '#f4f4f4';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#ececec';
    for (y = GS.HEADER_H; y < h; y += 10) c.fillRect(0, y, w, 4);
    g = c.createLinearGradient(0, GS.SHELF_Y, 0, GS.SHELF_Y + 22);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, '#d3d3d3');
    c.fillStyle = g;
    traceRoundRect(c, 60, GS.SHELF_Y, w - 60, GS.SHELF_Y + 22, 11);
    c.fill();
    g = c.createLinearGradient(0, GS.SHELF_Y + 22, 0, GS.SHELF_Y + 42);
    g.addColorStop(0, 'rgba(0,0,0,0.14)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(80, GS.SHELF_Y + 22, w - 160, 20);
    g = c.createLinearGradient(0, GS.HEADER_H, 0, GS.HEADER_H + 26);
    g.addColorStop(0, 'rgba(0,0,0,0.19)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(0, GS.HEADER_H, w, 26);

    function arc(dy) {
      c.beginPath();
      c.moveTo(0, GS.BAND_Y + 26 + dy);
      c.quadraticCurveTo(w / 2, GS.BAND_Y - 26 + dy, w, GS.BAND_Y + 26 + dy);
    }
    arc(-8);
    c.strokeStyle = 'rgba(0,0,0,0.06)';
    c.lineWidth = 22;
    c.stroke();
    arc(0);
    c.lineTo(w, h);
    c.lineTo(0, h);
    c.closePath();
    g = c.createLinearGradient(0, GS.BAND_Y - 26, 0, h);
    g.addColorStop(0, '#f3f3f3');
    g.addColorStop(1, '#d6d6d6');
    c.fillStyle = g;
    c.fill();
    arc(0);
    c.strokeStyle = BLUE_CSS;
    c.lineWidth = 4;
    c.stroke();
    arc(4);
    c.strokeStyle = '#ffffff';
    c.lineWidth = 2;
    c.stroke();

    drawScene(c, w, GS.HEADER_H, 0.16, 4, T.games);
    c.fillStyle = BLUE_CSS;
    c.fillRect(0, GS.HEADER_H - 5, w, 5);
  }

  // A gear of radius r: eight teeth round a ring.
  function gearCanvas(r, color) {
    var cv = makeCanvas(2 * r + 2, 2 * r + 2), c = cv.getContext('2d');
    c.translate(r + 1, r + 1);
    c.scale(r, r);
    c.fillStyle = color;
    c.beginPath();
    c.arc(0, 0, 0.72, 0, Math.PI * 2);
    c.fill();
    for (var i = 0; i < 8; i++) {
      c.save();
      c.rotate(i * Math.PI / 4);
      traceRoundRect(c, -0.17, -1, 0.17, -0.55, 0.06);
      c.fill();
      c.restore();
    }
    c.globalCompositeOperation = 'destination-out';
    c.beginPath();
    c.arc(0, 0, 0.32, 0, Math.PI * 2);
    c.fill();
    return cv;
  }

  // One of the start screen's buttons: its body, or (focused) the blue border, glow and lettering
  // that fade in over it.
  function paintPill(cv, b, focused) {
    var bw = GS.BTN_W[b], bh = GS.BTN_H, rad = bh / 2, on = pillEnabled(b), k;
    var label = [T.wiiMenu, 'RetroArch', T.play][b];
    var c = cv.getContext('2d');
    c.clearRect(0, 0, cv.width, cv.height);
    c.save();
    c.translate(PILL_M, PILL_M);
    traceRoundRect(c, 0, 0, bw, bh, rad);
    if (focused) {
      for (k = 3; k >= 1; k--) {
        c.strokeStyle = rgba(BLUE, 64 / k / 255);
        c.lineWidth = 4.5 + k * 5;
        c.stroke();
      }
      c.strokeStyle = BLUE_CSS;
      c.lineWidth = 6;
      c.stroke();
    } else {
      var g = c.createLinearGradient(0, 0, 0, bh);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(1, '#e9e9e9');
      c.fillStyle = g;
      c.fill();
      c.strokeStyle = BORDER;
      c.lineWidth = 4.5;
      c.stroke();
    }
    var ink = focused ? '#2c9ed6' : on ? '#6a6a6a' : '#c6c6c6';
    c.font = 'bold ' + (b === PILL_RETRO ? 40 : 46) + 'px ' + SANS;
    c.fillStyle = ink;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    var tw = c.measureText(label).width, x = bw / 2;
    if (b === PILL_RETRO) {
      var gr = 23, gap = 14, left = bw / 2 - (2 * gr + gap + tw) / 2;
      c.drawImage(gearCanvas(gr, ink), left - 1, bh / 2 - gr - 1);
      x = left + 2 * gr + gap + tw / 2;
    }
    c.fillText(label, x, bh / 2 + 2);
    c.restore();
  }

  // A shelf item: the game's box art when it has a cover, standing on the shelf like the box itself,
  // otherwise the pixel cartridge with its coloured label. The item, its shadow and its focus glow take
  // the size of what it shows.
  var BOX_MAX_W = 220, BOX_MAX_H = 250;

  function fillSlot(it, g, i, cover) {
    var w, h, rad, c;
    if (cover) {
      var sc = Math.min(BOX_MAX_W / cover.naturalWidth, BOX_MAX_H / cover.naturalHeight);
      w = Math.round(cover.naturalWidth * sc);
      h = Math.round(cover.naturalHeight * sc);
      rad = 8;
    } else {
      w = CART_W * GS.CART_PX;
      h = CART_H * GS.CART_PX;
      rad = 18;
    }
    it.slot.style.left = (960 + i * GS.PITCH - w / 2) + 'px';
    it.slot.style.top = (GS.SHELF_Y - h) + 'px';
    it.slot.style.width = w + 'px';
    it.slot.style.height = h + 'px';

    it.shadow.width = w;
    it.shadow.height = 16;
    it.shadow.style.top = (h - 8) + 'px';
    c = it.shadow.getContext('2d');
    c.fillStyle = 'rgba(0,0,0,0.15)';
    c.beginPath();
    c.ellipse(w / 2, 8, w * 0.42, 6, 0, 0, Math.PI * 2);
    c.fill();

    it.art.width = w;
    it.art.height = h;
    c = it.art.getContext('2d');
    if (cover) {
      traceRoundRect(c, 0, 0, w, h, rad);
      c.save();
      c.clip();
      c.drawImage(cover, 0, 0, w, h);
      c.restore();
      c.strokeStyle = 'rgba(0,0,0,0.35)';
      c.lineWidth = 2;
      c.stroke();
    } else {
      c.imageSmoothingEnabled = false;
      c.drawImage(cartridge(g.color || GAME_PALETTE[i % GAME_PALETTE.length], g.title), 0, 0, w, h);
    }

    it.glow.width = w + 40;
    it.glow.height = h + 40;
    c = it.glow.getContext('2d');
    traceRoundRect(c, 12, 12, w + 28, h + 28, rad + 4);
    for (var k = 3; k >= 1; k--) {
      c.strokeStyle = rgba(BLUE, 64 / k / 255);
      c.lineWidth = 4.5 + k * 5;
      c.stroke();
    }
    c.strokeStyle = BLUE_CSS;
    c.lineWidth = 5;
    c.stroke();
  }

  function buildShelf() {
    drawShelfBackdrop($('gBg'));
    drawHand($('gHand'));

    var strip = $('cartStrip'), cw = CART_W * GS.CART_PX, ch = CART_H * GS.CART_PX;
    shelfGames().forEach(function (g, i) {
      var it = { slot: document.createElement('div'), shadow: makeCanvas(1, 1), art: makeCanvas(1, 1),
        glow: makeCanvas(1, 1) };
      var slot = it.slot, cart = document.createElement('div');
      slot.className = 'slot';
      cart.className = 'cart';
      it.shadow.className = 'shadow';
      it.shadow.style.left = it.art.style.left = it.art.style.top = '0px';
      it.glow.className = 'glow';
      it.glow.style.left = it.glow.style.top = '-20px';
      cart.appendChild(it.art);
      cart.appendChild(it.glow);
      slot.appendChild(it.shadow);
      slot.appendChild(cart);
      // A game with a cover waits for it, so the cartridge doesn't flash first; without one, or if it
      // won't load, the cartridge.
      if (!g.cover) fillSlot(it, g, i, null);
      loadImage(g.cover, function (img) { fillSlot(it, g, i, img.ready ? img : null); });
      slot.addEventListener('mouseover', function () {
        if (shelf.launching || (shelf.onShelf && shelf.focus === i)) return;
        shelf.onShelf = true;
        shelf.focus = i;
        sound('move');
        showShelf();
      });
      slot.addEventListener('click', function () {
        shelf.onShelf = true;
        shelf.focus = i;
        showShelf();
        startGame();
      });
      strip.appendChild(slot);
      shelf.slots.push(slot);
    });

    if (!shelfGames().length) {
      // An empty slot with a plus where the first cartridge will stand.
      var empty = makeCanvas(cw + 20, ch + 20), ec = empty.getContext('2d');
      empty.style.left = (960 - cw / 2 - 10) + 'px';
      empty.style.top = (GS.SHELF_Y - ch - 10) + 'px';
      ec.strokeStyle = '#c6c6c6';
      ec.lineWidth = 5;
      if (ec.setLineDash) ec.setLineDash([18, 12]);
      traceRoundRect(ec, 10, 10, cw + 10, ch + 10, 14);
      ec.stroke();
      if (ec.setLineDash) ec.setLineDash([]);
      ec.lineWidth = 10;
      ec.lineCap = 'round';
      ec.beginPath();
      ec.moveTo((cw + 20) / 2 - 34, (ch + 20) / 2);
      ec.lineTo((cw + 20) / 2 + 34, (ch + 20) / 2);
      ec.moveTo((cw + 20) / 2, (ch + 20) / 2 - 34);
      ec.lineTo((cw + 20) / 2, (ch + 20) / 2 + 34);
      ec.stroke();
      strip.appendChild(empty);
    }

    var legend = $('gLegend');
    REMOTE.forEach(function (r) {
      var item = document.createElement('span');
      item.className = 'item';
      item.innerHTML = '<i class="dot" style="background:' + r[0] + '"></i>' + r[1];
      legend.appendChild(item);
    });
    [T.keyA, T.keyB, T.keyMenu].forEach(function (s) {
      var item = document.createElement('span');
      item.className = 'item key';
      item.textContent = s;
      legend.appendChild(item);
    });

    var pills = $('gPills');
    [PILL_MENU, PILL_RETRO, PILL_PLAY].forEach(function (b) {
      var w = GS.BTN_W[b] + 2 * PILL_M, h = GS.BTN_H + 2 * PILL_M;
      var pill = document.createElement('div');
      pill.className = 'pill';
      pill.style.left = (GS.BTN_X[b] - w / 2) + 'px';
      pill.style.top = (GS.BTN_Y - h / 2) + 'px';
      pill.style.width = w + 'px';
      pill.style.height = h + 'px';
      var body = makeCanvas(w, h), glow = makeCanvas(w, h);
      body.style.left = body.style.top = glow.style.left = glow.style.top = '0px';
      glow.className = 'glow';
      paintPill(body, b, false);
      paintPill(glow, b, true);
      pill.appendChild(body);
      pill.appendChild(glow);
      pill.addEventListener('mouseover', function () {
        if (shelf.launching || !pillEnabled(b) || (!shelf.onShelf && shelf.button === b)) return;
        shelf.onShelf = false;
        shelf.button = b;
        sound('move');
        showShelf();
      });
      pill.addEventListener('click', function () {
        if (!pillEnabled(b)) return;
        shelf.onShelf = false;
        shelf.button = b;
        chooseShelf();
      });
      pills.appendChild(pill);
      shelf.pills.push(pill);
    });
    shelf.built = true;
  }

  function shelfHandTransform() {
    var tx, ty;
    if (shelf.onShelf) {
      tx = 960 + 72;
      ty = GS.SHELF_Y - 86;
    } else {
      tx = GS.BTN_X[shelf.button] + GS.BTN_W[shelf.button] * 0.28;
      ty = GS.BTN_Y + 26;
    }
    return 'translate3d(' + (tx - HAND_BOX.ox) + 'px,' + (ty - HAND_BOX.oy) + 'px,0) rotate(-8deg)';
  }

  // Shows the focus: the lifted cartridge, the scroll, the button, the hand and the game's name.
  function showShelf() {
    var games = shelfGames(), n = games.length, g = games[shelf.focus];
    shelf.slots.forEach(function (s, i) {
      s.className = 'slot' + (shelf.onShelf && i === shelf.focus ? ' focused' : '');
    });
    shelf.pills.forEach(function (p, b) {
      p.className = 'pill' + (!shelf.onShelf && b === shelf.button ? ' focused' : '');
    });
    $('cartStrip').style.transform = 'translate3d(' + (-shelf.focus * GS.PITCH) + 'px,0,0)';
    $('gTitle').textContent = n ? g.title : T.gamesEmptyTitle;
    $('gSub').textContent = !n ? T.gamesEmptyBody : !shelfReady() ? T.gamesMissing : g.system;
    $('gSub').className = n && !shelfReady() ? 'warn' : '';
    $('gLegend').style.visibility = n && shelfReady() ? 'visible' : 'hidden';
    $('gHand').style.transform = shelfHandTransform();
  }

  function openShelf() {
    if (!shelf.built) buildShelf();
    var games = shelfGames(), last = null;
    try { last = localStorage.getItem(LAST_PLAYED); } catch (e) { /* no storage */ }
    shelf.focus = 0;
    games.forEach(function (g, i) { if (g.rom === last) shelf.focus = i; });
    shelf.onShelf = games.length > 0;
    shelf.button = shelf.onShelf && shelfReady() ? PILL_PLAY : shelfReady() ? PILL_RETRO : PILL_MENU;
    shelf.launching = false;
    shelf.open = true;
    jump($('cartStrip'), 'translate3d(' + (-shelf.focus * GS.PITCH) + 'px,0,0)');
    showShelf();
    jump($('gHand'), shelfHandTransform());
    $('gVeil').className = '';
    var el = $('games');
    el.className = 'shown';
    el.offsetWidth;   // eslint-disable-line no-unused-expressions -- start the fade from transparent
    el.className = 'shown open';
    // Once covered, the menu below stops being composited.
    setTimeout(function () { if (shelf.open) $('stage').className = 'shelf-open'; }, 320);
  }

  function closeShelf() {
    shelf.open = false;
    shelf.launching = false;
    $('stage').className = '';
    $('games').className = 'shown';
    setTimeout(function () { if (!shelf.open) $('games').className = ''; }, 320);
  }

  function shelfMove(d) {
    if (shelf.onShelf) {
      var n = Math.max(0, Math.min(shelfGames().length - 1, shelf.focus + d));
      if (n === shelf.focus) return;
      shelf.focus = n;
    } else {
      var b = shelf.button + d;
      while (b >= PILL_MENU && b <= PILL_PLAY && !pillEnabled(b)) b += d;
      if (b < PILL_MENU || b > PILL_PLAY) return;
      shelf.button = b;
    }
    sound('move');
    showShelf();
  }

  function shelfKey(k) {
    if (shelf.launching) return;
    if (k === KEY.LEFT) shelfMove(-1);
    else if (k === KEY.RIGHT) shelfMove(1);
    else if (k === KEY.UP) {
      if (shelf.onShelf || !shelfGames().length) return;
      shelf.onShelf = true;
      sound('move');
      showShelf();
    } else if (k === KEY.DOWN) {
      if (!shelf.onShelf) return;
      shelf.onShelf = false;
      shelf.button = shelfReady() ? PILL_PLAY : PILL_MENU;
      sound('move');
      showShelf();
    } else if (k === KEY.OK) chooseShelf();
    else if (k === KEY.PLAY) startGame();
    else if (k === KEY.BACK || k === KEY.ESC || k === KEY.BACKSPACE) {
      sound('back');
      closeShelf();
    }
  }

  function chooseShelf() {
    if (shelf.onShelf || shelf.button === PILL_PLAY) startGame();
    else if (shelf.button === PILL_MENU) {
      sound('back');
      closeShelf();
    } else openRetroArch();
  }

  function startGame() {
    var games = shelfGames();
    if (!games.length || !shelfReady() || shelf.launching) {
      sound('back');
      return;
    }
    var g = games[shelf.focus];
    sound('start');
    shelf.launching = true;
    shelf.slots[shelf.focus].className += ' hop';
    $('gVeil').className = 'on';
    try { localStorage.setItem(LAST_PLAYED, g.rom); } catch (e) { /* no storage */ }
    setTimeout(function () { playGame(g); }, 600);
  }

  // RetroArch already open would only come forward with its old game, so it is closed first.
  function playGame(g) {
    luna('luna://com.webos.applicationManager/closeByAppId', { id: GAMES.app }, function (res) {
      setTimeout(function () {
        luna('luna://com.webos.applicationManager/launch', { id: GAMES.app, params: { core: g.core, rom: g.rom } },
          function (r) { if (r.returnValue === false) returnFromGame(); });
      }, res.returnValue === false ? 0 : 1200);
    });
  }

  function openRetroArch() {
    sound('select');
    shelf.launching = true;
    $('gVeil').className = 'on';
    setTimeout(function () {
      luna('luna://com.webos.applicationManager/launch', { id: GAMES.app }, function (r) {
        if (r.returnValue === false) returnFromGame();
      });
    }, 400);
  }

  // Back from RetroArch, or it couldn't start: the shelf fades in again.
  function returnFromGame() {
    if (!shelf.launching) return;
    shelf.launching = false;
    shelf.slots.forEach(function (s) { s.className = s.className.replace(' hop', ''); });
    $('gVeil').className = '';
  }

  // ---- input --------------------------------------------------------------------------------------

  function move(dx, dy) {
    var before = focus, pageBefore = page;
    if (focus >= 0) {
      var pg = Math.floor(focus / SLOTS), i = focus % SLOTS, row = Math.floor(i / 4), col = i % 4;
      if (dx < 0) {
        if (col > 0) focus--;
        else if (pg > 0) { focus = (pg - 1) * SLOTS + row * 4 + 3; page = pg - 1; }
      } else if (dx > 0) {
        if (col < 3) focus++;
        else if (pg < pages - 1) { focus = (pg + 1) * SLOTS + row * 4; page = pg + 1; }
      } else if (dy < 0) {
        if (row > 0) focus -= 4;
      } else if (row < 2) {
        focus += 4;
      } else {
        focus = col === 0 ? BTN_SETTINGS : col === 1 ? BTN_SD : BTN_INPUTS;
      }
    } else if (dy < 0) {
      var c = focus === BTN_SETTINGS ? 0 : focus === BTN_SD ? 1 : 3;
      focus = page * SLOTS + 8 + c;
    } else if (dx < 0) {
      if (focus === BTN_SD) focus = BTN_SETTINGS;
      else if (focus === BTN_INPUTS) focus = BTN_SD;
    } else if (dx > 0) {
      if (focus === BTN_SETTINGS) focus = BTN_SD;
      else if (focus === BTN_SD) focus = BTN_INPUTS;
    }
    if (focus !== before) {
      sound(page !== pageBefore ? 'page' : 'move');
      showFocus();
    }
  }

  function setFocus(f) {
    if (f === focus || menuOpen || introUp) return;
    focus = f;
    sound('move');
    showFocus();
  }

  function turnPage(d) {
    var n = page + d;
    if (n < 0 || n >= pages) return;
    var i = focus >= 0 ? focus % SLOTS : 0;
    page = n;
    focus = n * SLOTS + Math.floor(i / 4) * 4 + (d > 0 ? 0 : 3);
    sound('page');
    showFocus();
  }

  function activate() {
    if (focus === BTN_INPUTS) {
      sound('menu');
      openInputs();
      return;
    }
    var ch = focus >= 0 ? channels[focus] : null;
    if (ch && ch.app.special === 'games') {
      sound('select');
      openShelf();
      return;
    }
    var id = focus === BTN_SETTINGS ? CFG.settingsApp : focus === BTN_SD ? CFG.mediaApp : ch && ch.app.id;
    if (!id) return;
    sound('select');
    setTimeout(function () { launch(id); }, 150);
  }

  function onKey(e) {
    var k = e.keyCode;
    var known = [KEY.LEFT, KEY.UP, KEY.RIGHT, KEY.DOWN, KEY.OK, KEY.BACK, KEY.ESC, KEY.BACKSPACE, KEY.PLAY];
    if (known.indexOf(k) < 0) return;
    e.preventDefault();
    if (introUp) {
      // Only OK and the arrows continue: the key that woke the TV must not skip the screen.
      if (k === KEY.OK || (k >= 37 && k <= 40)) {
        sound('start');
        dismissIntro();
      }
      return;
    }
    if (shelf.open) { shelfKey(k); return; }
    if (menuOpen) { menuKey(k); return; }
    if (k === KEY.LEFT) move(-1, 0);
    else if (k === KEY.RIGHT) move(1, 0);
    else if (k === KEY.UP) move(0, -1);
    else if (k === KEY.DOWN) move(0, 1);
    else if (k === KEY.OK) activate();
  }

  function onPageHover(e) {
    var cv = e.currentTarget, slot = slotAt(cv, e.offsetX, e.offsetY);
    if (slot >= 0 && cv.page === page) setFocus(slot);
  }

  function onPageClick(e) {
    var cv = e.currentTarget, slot = slotAt(cv, e.offsetX, e.offsetY);
    if (slot < 0 || cv.page !== page || menuOpen || introUp) return;
    if (focus !== slot) { focus = slot; showFocus(); }
    activate();
  }

  function hookPointer() {
    [['btnL', BTN_SETTINGS], ['sd', BTN_SD], ['btnR', BTN_INPUTS]].forEach(function (b) {
      $(b[0]).addEventListener('mouseover', function () { setFocus(b[1]); });
      $(b[0]).addEventListener('click', function () {
        if (menuOpen || introUp) return;
        if (focus !== b[1]) { focus = b[1]; showFocus(); }
        activate();
      });
    });
    $('arrowR').addEventListener('click', function () { if (!menuOpen && !introUp) turnPage(1); });
    $('arrowL').addEventListener('click', function () { if (!menuOpen && !introUp) turnPage(-1); });
    $('menu').addEventListener('mousemove', function (e) {
      var p = stagePoint(e);
      for (var i = 0; i < menuItems.length; i++) {
        var b = menuItemBox(i);
        if (p[0] >= b.l && p[0] <= b.r && p[1] >= b.t && p[1] <= b.b) setMenuFocus(i);
      }
    });
    $('menu').addEventListener('click', function (e) {
      var p = stagePoint(e), b = menuItemBox(menuFocus);
      if (p[0] >= b.l && p[0] <= b.r && p[1] >= b.t && p[1] <= b.b) menuActivate();
      else if (p[0] < MENU.x || p[0] > MENU.x + MENU.w || p[1] < MENU.y || p[1] > MENU.y + MENU.h) {
        sound('back');
        closeMenu();
      }
    });
    $('intro').addEventListener('click', function () {
      if (!introUp) return;
      sound('start');
      dismissIntro();
    });
  }

  // ---- start --------------------------------------------------------------------------------------

  function fitStage() {
    var sc = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    var st = $('stage');
    st.style.transform = sc === 1 ? '' : 'scale(' + sc + ')';
    st.style.left = Math.max(0, (window.innerWidth - 1920 * sc) / 2) + 'px';
    st.style.top = Math.max(0, (window.innerHeight - 1080 * sc) / 2) + 'px';
  }

  function stagePoint(e) {
    var r = $('stage').getBoundingClientRect();
    return [(e.clientX - r.left) * 1920 / r.width, (e.clientY - r.top) * 1080 / r.height];
  }

  function placeButtons() {
    var size = BTN_SIZE + 2 * BTN_M;
    [['btnL', BTN_CX], ['btnR', BTN_RIGHT_CX]].forEach(function (b) {
      var el = $(b[0]);
      el.style.left = (b[1] - size / 2) + 'px';
      el.style.top = (BTN_CY - size / 2) + 'px';
      el.style.width = el.style.height = size + 'px';
    });
    var sd = $('sd');
    sd.style.left = (SD_L - SD_M) + 'px';
    sd.style.top = (SD_T - SD_M) + 'px';
    sd.style.width = (SD_R - SD_L + 2 * SD_M) + 'px';
    sd.style.height = (SD_B - SD_T + 2 * SD_M) + 'px';
  }

  function start() {
    fitStage();
    window.addEventListener('resize', fitStage);
    strip = $('strip');
    initSounds();
    buildChannels();
    pages = Math.max(MIN_PAGES, Math.ceil(channels.length / SLOTS));

    placeButtons();
    place($('clock'), CLOCK_BOX.x, CLOCK_BOX.y, CLOCK_BOX.w, CLOCK_BOX.h);
    var colon = $('colon');
    colon.width = COLON_DOT + 4;
    colon.height = COLON_Y2 - COLON_Y1 + COLON_DOT + 4;
    place($('arrowR'), ARROW_TIP - ARROW_BOX.ox, ARROW_Y - ARROW_BOX.oy, ARROW_BOX.w, ARROW_BOX.h);
    place($('arrowL'), 2 * CX - ARROW_TIP - (ARROW_BOX.w - ARROW_BOX.ox), ARROW_Y - ARROW_BOX.oy,
      ARROW_BOX.w, ARROW_BOX.h);
    drawArrow($('arrowR'));
    drawArrow($('arrowL'));
    drawColon();
    drawHand($('hand'));
    jump($('hand'), handTransform());
    drawClock(true);
    setInterval(function () {
      var colonEl = $('colon');
      colonEl.style.visibility = colonEl.style.visibility === 'hidden' ? 'visible' : 'hidden';
      drawClock(false);
    }, 1000);

    loadStatic(function () {
      createTiles();
      createRings();
      drawButton($('btnL'), BTN_SETTINGS);
      drawButton($('btnR'), BTN_INPUTS);
      drawSd($('sd'));
      showFocus();
    });

    document.addEventListener('keydown', onKey);
    hookPointer();
    document.addEventListener('webOSRelaunch', function () {
      if (menuOpen) closeMenu();
      returnFromGame();
      drawClock(true);
    });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) return;
      returnFromGame();
      drawClock(true);
    });
    if (CFG.intro !== false) showIntro();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
