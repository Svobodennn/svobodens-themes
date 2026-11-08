// The last script in a playground frame, after the page's own: the app's sounds only when the panel's "sounds" is on
// (a page played them without asking, and Safari would refuse a page that wasn't clicked); hit() still times the badge.
(() => {
  const real = window.Sfx;
  if (!real) return;
  const on = () => !!(window.parent.PG && window.parent.PG.sound());
  window.Sfx = Object.assign(Object.create(real), {
    play: (...a) => (on() ? real.play(...a) : undefined),
    sample: (...a) => (on() ? real.sample(...a) : undefined),
    preload: (...a) => (on() ? real.preload(...a) : undefined),
  });
})();
