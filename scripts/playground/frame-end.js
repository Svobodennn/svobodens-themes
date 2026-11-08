// The last script in a playground frame, after the page's own: sounds, the app's and the theme's, only when the panel's
// sound box is ticked (a page played them without asking, and Safari would refuse a page that wasn't clicked); hit()
// still times the badge. Hooks.sound plays a theme's file on its own (the dashboard's pings), so it waits too, still
// telling the caller whether the theme has one.
(() => {
  const on = () => !!(window.parent.PG && window.parent.PG.sound());
  const sfx = window.Sfx;
  if (sfx) {
    window.Sfx = Object.assign(Object.create(sfx), {
      play: (...a) => (on() ? sfx.play(...a) : undefined),
      sample: (...a) => (on() ? sfx.sample(...a) : undefined),
      preload: (...a) => (on() ? sfx.preload(...a) : undefined),
    });
  }
  const hooks = window.Hooks;
  if (hooks) {
    window.Hooks = Object.assign(Object.create(hooks), {
      sound: (name) => (on() ? hooks.sound(name) : !!hooks.soundOf(name)),
    });
  }
})();
