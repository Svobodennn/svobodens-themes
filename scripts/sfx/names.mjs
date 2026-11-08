// The sounds a theme can replace with a `--sfx-<name>` token, as Atalay's Terminal 0.19 plays them:
//   - sfx.js's synth (Sfx.play), including `clash`, which is `wait` unless a theme gives it its own;
//   - app.js's ping(kind), the dashboard's sound button: `ping-waiting`, `ping-idle`;
//   - sfx.js's recorded badge sounds (Sfx.sample);
//   - the theme-only moments, played only when a theme sets them: a streak mark, a streak broken, a return from idle,
//     a theme kept.
export const SOUND_NAMES = Object.freeze([
  'wait', 'message', 'request', 'friend', 'online', 'accept', 'decline', 'send', 'xp', 'glitch', 'levelup', 'rankup',
  'fire', 'alarm', 'hit', 'boom', 'clash',
  'ping-waiting', 'ping-idle',
  'badge-impact', 'badge-shine', 'badge-equip',
  'streak', 'streak-break', 'back', 'theme-kept',
])

/** The largest sound file a pack may ship: each one is loaded whole when it plays. */
export const MAX_SOUND_BYTES = 300 * 1024
