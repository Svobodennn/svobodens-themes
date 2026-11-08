// A style sheet read the way WebKit's tokenizer reads it, as far as the checker needs: where strings, escapes, comments
// and url() end, and which brackets close which. A checker that reads braces differently from the browser can be shown
// a rule inside a gate that the browser applies outside it.

const ESCAPE = /\\(?:([0-9a-fA-F]{1,6})[ \t\n]?|([^\n]))/y
const IDENT_CHAR = /[\w\u0080-\uffff-]/
const CLOSE = { '(': ')', '[': ']', '{': '}' }

/** The text an escape stands for: a code point by its hex, or the character after the backslash. */
const unescapeOne = (hex, char) => {
  if (char !== undefined) return char
  const code = parseInt(hex, 16)
  return code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) ? '�' : String.fromCodePoint(code)
}

/** A name with its escapes resolved, as the browser compares it. */
export const unescape = (text) => text.replace(new RegExp(ESCAPE.source, 'g'), (_, hex, char) => unescapeOne(hex, char))

/** Where a string that starts at `i` ends: at its closing quote, or before an unescaped newline (a bad string). */
function stringEnd(src, i) {
  for (let j = i + 1; j < src.length; j += src[j] === '\\' ? 2 : 1) {
    if (src[j] === src[i]) return j + 1
    if (src[j] === '\n') return j
  }
  return src.length
}

/** Where a run of name characters and escapes that starts at `i` ends; `i` when none starts there. */
function identEnd(src, i) {
  let j = i
  for (;;) {
    ESCAPE.lastIndex = j
    if (ESCAPE.test(src)) j = ESCAPE.lastIndex
    else if (j < src.length && IDENT_CHAR.test(src[j])) j++
    else return j
  }
}

/** The sheet as pieces: comment, string, ident (with its escapes resolved in `name`), url (unquoted, to its ")"), or a
 *  single char. CR LF, CR and form feed read as newlines first, as CSS reads them. */
export function pieces(text) {
  const src = text.replace(/\r\n?|\f/g, '\n')
  const out = []
  let i = 0
  while (i < src.length) {
    const start = i
    const word = identEnd(src, i)
    let type = 'char'
    if (src.startsWith('/*', i)) {
      const end = src.indexOf('*/', i + 2)
      i = end === -1 ? src.length : end + 2
      type = 'comment'
    } else if (src[i] === '"' || src[i] === "'") {
      i = stringEnd(src, i)
      type = 'string'
    } else if (word > i) {
      i = word
      type = 'ident'
      // url( with no quote after it is one token up to its ")", whatever it holds.
      const open = /\(\s*/y
      open.lastIndex = i
      if (unescape(src.slice(start, i)).toLowerCase() === 'url' && open.test(src) && !/["']/.test(src[open.lastIndex] ?? '')) {
        let j = open.lastIndex
        while (j < src.length && src[j] !== ')') j += src[j] === '\\' ? 2 : 1
        i = Math.min(j + 1, src.length)
        type = 'url'
      }
    } else i++
    const piece = { type, text: src.slice(start, i), start, end: i }
    out.push(type === 'ident' ? { ...piece, name: unescape(piece.text) } : piece)
  }
  return { src, list: out }
}

/** A prelude or statement for matching: comments out, whitespace collapsed. */
const tidy = (text) => pieces(text).list.map((p) => (p.type === 'comment' ? ' ' : p.text)).join('').replace(/\s+/g, ' ').trim()

/** A sheet's (or a block's) items: each rule's prelude and body, and statements (ended by ";", or the end) with a null
 *  body. Bodies are the source between the braces, to scan again. A bracket closes only the one it matches, as in
 *  WebKit's tokenizer; `problems` holds a "}" that closes nothing and a bracket left open at the end. */
export function scan(text) {
  const { src, list } = pieces(text)
  const items = [], problems = [], stack = []
  let start = 0, bodyStart = -1, preludeEnd = 0
  for (const p of list) {
    if (p.type !== 'char') continue
    const c = p.text
    if (CLOSE[c]) {
      if (!stack.length && c === '{') {
        preludeEnd = p.start
        bodyStart = p.end
      }
      stack.push(c)
    } else if (stack.length && c === CLOSE[stack.at(-1)]) {
      stack.pop()
      if (!stack.length && c === '}') {
        items.push({ prelude: tidy(src.slice(start, preludeEnd)), body: src.slice(bodyStart, p.start) })
        start = p.end
      }
    } else if (!stack.length && c === '}') {
      problems.push('a "}" closes nothing')
      start = p.end
    } else if (!stack.length && c === ';') {
      const statement = tidy(src.slice(start, p.start))
      if (statement) items.push({ prelude: statement, body: null })
      start = p.end
    }
  }
  if (stack.length) {
    problems.push(`a "${stack[0]}" is never closed`)
    // The browser closes it at the end, so what it holds still counts.
    if (stack[0] === '{') items.push({ prelude: tidy(src.slice(start, preludeEnd)), body: src.slice(bodyStart) })
  } else if (tidy(src.slice(start))) items.push({ prelude: tidy(src.slice(start)), body: null })
  return { items, problems }
}

/** A list split at its top-level commas: not those inside (), [] or a string. */
export function splitList(text) {
  const parts = []
  let depth = 0, part = ''
  for (const p of pieces(text).list) {
    if (p.type === 'char' && '(['.includes(p.text)) depth++
    else if (p.type === 'char' && ')]'.includes(p.text)) depth = Math.max(0, depth - 1)
    else if (p.type === 'char' && p.text === ',' && depth === 0) {
      parts.push(part.trim())
      part = ''
      continue
    }
    part += p.type === 'comment' ? ' ' : p.text
  }
  return [...parts, part.trim()]
}

/** A selector with nothing in it that could pass for syntax: strings emptied, comments gone, and each name's escapes
 *  resolved to name characters, so `.x\:after` stays a class and `:\61 fter` is `:after`. */
export const bare = (text) =>
  pieces(text).list.map((p) => {
    if (p.type === 'string') return '""'
    if (p.type === 'comment') return ' '
    if (p.type === 'ident') return p.name.replace(/[^\w\u0080-\uffff-]/g, '_')
    return p.text
  }).join('')
