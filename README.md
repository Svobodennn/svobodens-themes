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

It edits that checkout's `app/Resources/web` (the themes file and three pages) and adds a folder there;
`git checkout -- app/Resources/web` and deleting `app/Resources/web/themes/svobodens-themes` undo it.

## Making a theme

A theme is one JSON file in `themes/`, in the app's own theme format: the terminal's background, text, cursor and
selection, an accent, and the 16 ANSI colours. The app makes the rest of its look from these. Every field is described
in `schemas/theme.schema.json`; start the file with `"$schema": "../schemas/theme.schema.json"` and editors check it as
you type.

A theme can also have a style sheet, as the app's own MUR47 theme does (the app links MUR47's itself; `css` in a
`package.json` entry is this pack's field, read by its checker and preview script). The theme sets its id in `ui`
(`"--theme-id"`), and every rule waits for it:

- element rules inside `@container style(--theme-id: <id>)`;
- `::before` / `::after` rules inside `@container svb-root style(--theme-id: <id>)`, with `html { container-name:
  svb-root }` in the sheet. WebKit checks an unnamed query on a pseudo-element against its element's old style, so
  without the name a theme's decorations stay on screen after another theme is chosen.

List the files under `contributes.themes` in `package.json`, then check the pack:

```sh
npm run check   # package.json, every theme, its sheet's gate, and the fonts it loads
npm test        # the checker's and preview script's tests
```

## Terminal extras

`extras/` takes each theme into the shell itself; `<slug>` below is `cyberpunk-2077`, `matrix` or `modern-warfare-2`.
`node extras/make-extras.mjs` builds them all from the theme files (and `npm test` fails if they fall behind). They
print only ASCII, box drawing and single-width marks, so lines stay straight inside GNU screen.

- **Starship prompt:** `export STARSHIP_CONFIG=/path/to/extras/<slug>/starship.toml`.
- **Claude Code status line:** in `~/.claude/settings.json`, `"statusLine": { "type": "command", "command": "node
  /path/to/extras/statusline/statusline.mjs --theme <slug>" }`. A RAM bar for the context window (Cyberpunk), the same
  as falling katakana (Matrix), a killstreak of tool calls without an error (Modern Warfare 2).
- **bat:** copy `extras/<slug>/bat.tmTheme` to `"$(bat --config-dir)/themes/svoboden-<slug>.tmTheme"`, run
  `bat cache --build`, then `bat --theme svoboden-<slug>`.
- **delta:** in `~/.gitconfig`, `[include] path = /path/to/extras/<slug>/delta.gitconfig`, then `features = <slug>` under
  `[delta]` (it uses the bat theme above).
- **eza:** save `extras/<slug>/eza.yml` as `theme.yml` in a folder and point `EZA_CONFIG_DIR` at it.

## Credits

Fonts, all under the SIL Open Font License 1.1 (texts in `themes/fonts/`): Rajdhani (Indian Type Foundry), Orbitron
(The Orbitron Project Authors), Barlow Condensed (The Barlow Project Authors) and Michroma (The Michroma Project
Authors).

This is an unofficial fan work and is not approved or endorsed by CD PROJEKT RED, Activision or Warner Bros. Cyberpunk
2077, Modern Warfare and The Matrix are trademarks of their owners.

## License

MIT for the themes, style sheets and scripts; the fonts keep their own licence.
