// Menu configuration. Edit this file, then run tools/install.py again.
// App ids: run `python3 tools/sync.py <TV IP> --list` (or look in app/apps.js after an install).
window.CONFIG = {
  // Apps that get the first channels, in this order. Missing apps are skipped; the rest follow in
  // the order of the TV's own launcher.
  firstApps: ['netflix', 'youtube.leanback.v4', 'amazon', 'com.apple.appletv', 'spotify-beehive'],

  // Apps that never get a channel. Inputs and Live TV are in the envelope button's menu instead.
  hiddenApps: [
    'org.wiiwebos.menu',
    'com.webos.app.livetv',
    'com.webos.app.hdmi1', 'com.webos.app.hdmi2', 'com.webos.app.hdmi3', 'com.webos.app.hdmi4'
  ],

  // What the bottom buttons open: left button, SD card, and the Live TV entry under the envelope.
  settingsApp: 'com.palm.app.settings',
  mediaApp: 'com.webos.app.photovideo',
  liveTvApp: 'com.webos.app.livetv',

  // Text on the left button.
  settingsLabel: 'wiiOS',

  sounds: true,

  // Your own sound for each event, as a path under app/sounds/ (see README). An event whose file
  // is missing plays the built-in sound.
  soundFiles: {
    move: 'custom/move.wav',       // the focus moves to another channel or button
    page: 'custom/page.wav',       // the page turns
    select: 'custom/select.wav',   // a channel or button opens
    menu: 'custom/menu.wav',       // the inputs menu opens
    back: 'custom/back.wav',       // Back closes the inputs menu
    start: 'custom/start.wav'      // OK on the notice screen
  },

  // The Games channel, shown once RetroArch is set up with tools/games.py (see README).
  gamesChannel: true,

  // The white notice screen when the menu starts.
  intro: true,

  // '' follows the TV's language; 'en' or 'es' to force one. Other languages show English.
  language: ''
};
