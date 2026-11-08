# Svoboden's Themes

Colour themes for [Atalay's Terminal](https://github.com/atalaykarahan/atalay-terminal), each with touches from the film
or game it comes from.

## Themes

| Theme | Inspired by | Beyond its colours |
|---|---|---|
| Cyberpunk 2077 | Cyberpunk 2077's in-game interface | angled panels, a glitching brand, a breach-protocol code grid |
| Matrix | The Matrix's green code | falling code behind the dashboard, phosphor glow |
| Modern Warfare 2 | Modern Warfare 2's menus and gunship view | a skull-jaw mask stamp, gunship reticle, UAV sweep |

The palettes come from the games' own interface colours and the film's grade, measured from their sources. The
decorations are our own drawings in the style of each, not artwork from them.

## Install

Atalay's Terminal has no extension marketplace yet. Once it has one, find "Svoboden's Themes" there.

To try them now in a source checkout of the app:

```sh
npm run preview -- <atalay-terminal checkout>   # then start app/dev.sh there
```

## Making a theme

A theme is one JSON file in `themes/`, in the app's own theme format: the terminal's background, text, cursor and
selection, an accent, and the 16 ANSI colours. The app makes the rest of its look from these. Every field is described
in `schemas/theme.schema.json`; start the file with `"$schema": "../schemas/theme.schema.json"` and editors check it as
you type.

A theme can also have a style sheet (`css` in its `package.json` entry), as the app's own MUR47 theme does. Its rules
sit inside `@container style(--theme-id: <id>)`, and the theme sets that id in `ui`, so they apply only while the theme
is chosen.

List the files under `contributes.themes` in `package.json`, then check the pack:

```sh
npm run check   # package.json, every theme, its style sheet and fonts
npm test        # the checker's own tests
```

## Credits

Fonts, all under the SIL Open Font License 1.1 (texts in `themes/fonts/`): Rajdhani (Indian Type Foundry), Orbitron
(The Orbitron Project Authors), Barlow Condensed (The Barlow Project Authors) and Michroma (The Michroma Project
Authors).

This is an unofficial fan work and is not approved or endorsed by CD PROJEKT RED, Activision or Warner Bros. Cyberpunk
2077, Modern Warfare and The Matrix are trademarks of their owners.

## License

MIT for the themes, style sheets and scripts; the fonts keep their own licence.
