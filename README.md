# Svoboden's Themes

Colour themes for [Atalay's Terminal](https://github.com/atalaykarahan/atalay-terminal).

## Themes

Coming soon.

## Install

Atalay's Terminal has no extension marketplace yet. Once it has one, find "Svoboden's Themes" there.

## Making a theme

A theme is one JSON file in `themes/`, in the app's own theme format: the terminal's background, text, cursor and
selection, an accent, and the 16 ANSI colours. The app makes the rest of its look from these. Every field is described
in `schemas/theme.schema.json`; start the file with `"$schema": "../schemas/theme.schema.json"` and editors check it as
you type.

List the file under `contributes.themes` in `package.json`, then check the pack:

```sh
npm run check   # package.json and every theme
npm test        # the checker's own tests
```

## License

MIT
