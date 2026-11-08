import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  compose, contextPercent, contextTokens, contextWindow, gather, killstreak, parseTail, plain, rainBar, readTail, render,
  streakRank, tokensLabel,
} from '../extras/statusline/statusline.mjs'

const SCRIPT = fileURLToPath(new URL('../extras/statusline/statusline.mjs', import.meta.url))
const THEMES = ['cyberpunk-2077', 'matrix', 'modern-warfare-2']

// Transcript lines in the shape Claude Code 2.1.316 writes them (fields copied from a real session, contents cut).
let seq = 0
const base = () => ({
  parentUuid: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`, isSidechain: false,
  uuid: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`, timestamp: '2026-11-02T11:14:03.508Z',
  userType: 'external', entrypoint: 'cli', cwd: '/Users/svoboden/development/Darlink',
  sessionId: 'fb83bb6a-6769-4e65-abc4-239167679215', version: '2.1.316', gitBranch: 'HEAD',
})
const assistant = (usage = {}, over = {}) => ({
  ...base(), type: 'assistant', requestId: 'req_011Cge19my9uhHuqNoQWv4EV',
  message: {
    model: 'claude-opus-5-5', id: 'msg_011Cge19nqVXwmX1UgCs6jdt', type: 'message', role: 'assistant',
    content: [{ type: 'tool_use', id: 'toolu_015YWuEhRjX1qyJefu9rZkW7', name: 'Bash', input: { command: 'ls -la' } }],
    stop_reason: 'tool_use', stop_sequence: null,
    usage: {
      input_tokens: 2, cache_creation_input_tokens: 141936, cache_read_input_tokens: 30613, output_tokens: 1560,
      service_tier: 'standard', cache_creation: { ephemeral_1h_input_tokens: 141936, ephemeral_5m_input_tokens: 0 }, ...usage,
    },
  },
  ...over,
})
// is_error true / false / undefined (Claude Code leaves it out on some tools' results).
const result = (isError, over = {}) => ({
  ...base(), type: 'user', promptId: '0a84930a-83e6-4f70-a571-c94ed887e792',
  message: {
    role: 'user',
    content: [{
      tool_use_id: 'toolu_015YWuEhRjX1qyJefu9rZkW7', type: 'tool_result',
      content: isError ? 'PreToolUse:Bash hook error: ENGELLENDI' : '644  /Users/svoboden/Downloads/bilan.html',
      ...(isError === undefined ? {} : { is_error: isError }),
    }],
  },
  toolUseResult: isError ? 'Error: PreToolUse:Bash hook error: ENGELLENDI' : { stdout: '644', stderr: '', interrupted: false, isImage: false },
  sourceToolAssistantUUID: 'ab70ef4d-d6f8-48b6-b43d-0e9e8ba894d1',
  ...over,
})
// Two tool calls answered in one message, in this order.
const results = (...errors) => {
  const line = result(false)
  line.message.content = errors.map((e, i) => ({ tool_use_id: `toolu_${i}`, type: 'tool_result', content: 'x', is_error: e }))
  return line
}
const prompt = (text) => ({ ...base(), type: 'user', promptId: 'p', message: { role: 'user', content: text } })
const turnDuration = () => ({ ...base(), type: 'system', subtype: 'turn_duration', durationMs: 645843, messageCount: 637, isMeta: false })
const compacted = (postTokens) => ({
  ...base(), parentUuid: null, type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted', level: 'info',
  compactMetadata: { trigger: 'auto', preTokens: 967791, postTokens, durationMs: 94174 },
})
// The request copy Claude Code also logs: a tool_result inside, but not a turn of the conversation.
const requestBlob = () => ({
  type: 'api-request-blob', sessionId: 'fb83bb6a-6769-4e65-abc4-239167679215', hash: 'a00538cdae',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_x', content: 'denied', is_error: true }] },
})
const jsonl = (lines) => lines.map((l) => JSON.stringify(l)).join('\n') + '\n'

const dirs = []
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })))
const transcript = (text) => {
  const dir = mkdtempSync(join(tmpdir(), 'svoboden-statusline-'))
  dirs.push(dir)
  const file = join(dir, 'fb83bb6a-6769-4e65-abc4-239167679215.jsonl')
  writeFileSync(file, text)
  return file
}
// Claude Code's stdin, as in the status line docs' full schema.
const stdin = (over = {}) => ({
  cwd: '/Users/svoboden/development/svobodens-themes', session_id: 'abc123', transcript_path: '/nonexistent/none.jsonl',
  model: { id: 'claude-opus-5-5', display_name: 'Opus' },
  workspace: { current_dir: '/Users/svoboden/development/svobodens-themes', project_dir: '/Users/svoboden/development/svobodens-themes', added_dirs: [] },
  version: '2.1.316', output_style: { name: 'default' },
  cost: { total_cost_usd: 0.01234, total_duration_ms: 45000, total_api_duration_ms: 2300, total_lines_added: 156, total_lines_removed: 23 },
  context_window: { total_input_tokens: 0, total_output_tokens: 0, context_window_size: 200000, used_percentage: null, remaining_percentage: null, current_usage: null },
  exceeds_200k_tokens: false,
  ...over,
})

// ---------------------------------------------------------------- killstreak

test('killstreak: tool results in a row since the last error, and the reward they earn', () => {
  const lines = [prompt('fix it'), assistant(), result(true), ...Array.from({ length: 7 }, () => [assistant(), result(false)]).flat(), turnDuration()]
  assert.deepEqual(killstreak(lines), { count: 7, sawError: true })
  assert.equal(streakRank(7).earned.name, 'GUNSHIP')
  assert.deepEqual(killstreak(parseTail(jsonl(lines))), { count: 7, sawError: true })
})

test('killstreak: an error resets it, and it counts up again from there', () => {
  const run = [result(false), result(false), result(false), result(false)]
  assert.deepEqual(killstreak([...run, result(true)]), { count: 0, sawError: true })
  assert.deepEqual(killstreak([...run, result(true), result(false), result(false)]), { count: 2, sawError: true })
})

test('killstreak: a result without is_error counts; parallel results go in their order', () => {
  assert.deepEqual(killstreak([result(true), result(undefined), result(false)]), { count: 2, sawError: true })
  assert.deepEqual(killstreak([results(false, true)]), { count: 0, sawError: true })
  assert.deepEqual(killstreak([results(true, false)]), { count: 1, sawError: true })
})

test('killstreak: request copies, subagent turns and prompts are not the main thread\'s tool results', () => {
  const lines = [result(true), result(false), requestBlob(), result(true, { isSidechain: true }), prompt('go on'), result(false)]
  assert.deepEqual(killstreak(lines), { count: 2, sawError: true })
})

test('killstreak: no tool results at all, or no error in what was read', () => {
  assert.deepEqual(killstreak([]), { count: 0, sawError: false })
  assert.deepEqual(killstreak([prompt('hi'), assistant()]), { count: 0, sawError: false })
  assert.deepEqual(killstreak([result(false), result(false)]), { count: 2, sawError: false })
})

test('the rewards: UAV at 3, PRECISION STRIKE at 5, GUNSHIP at 7, TACTICAL NUKE at 25', () => {
  const name = (n) => streakRank(n).earned?.name ?? null
  assert.deepEqual([0, 2, 3, 4, 5, 6, 7, 24, 25, 99].map(name),
    [null, null, 'UAV', 'UAV', 'PRECISION STRIKE', 'PRECISION STRIKE', 'GUNSHIP', 'GUNSHIP', 'TACTICAL NUKE', 'TACTICAL NUKE'])
  assert.deepEqual(streakRank(0), { earned: null, next: { at: 3, name: 'UAV' }, toNext: 3 })
  assert.deepEqual(streakRank(8), { earned: { at: 7, name: 'GUNSHIP' }, next: { at: 25, name: 'TACTICAL NUKE' }, toNext: 17 })
  assert.deepEqual(streakRank(25), { earned: { at: 25, name: 'TACTICAL NUKE' }, next: null, toNext: 0 })
})

// ---------------------------------------------------------------- context

test('context: the last response\'s input + cache tokens, not its output (as Claude Code counts used_percentage)', () => {
  const lines = [assistant({ input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }), result(false),
    assistant({ input_tokens: 8500, cache_creation_input_tokens: 5000, cache_read_input_tokens: 2000, output_tokens: 1200 })]
  assert.equal(contextTokens(lines), 15500)
  // 15500 of the default 200000 window, the docs' example: used_percentage 8
  assert.equal(Math.round(contextPercent(contextTokens(lines), contextWindow(stdin()))), 8)
})

test('context: errors Claude Code writes itself (no usage) and subagent turns are passed over', () => {
  const synthetic = assistant({ input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 },
    { isApiErrorMessage: true })
  synthetic.message.model = '<synthetic>'
  const sub = assistant({ input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 999 }, { isSidechain: true })
  assert.equal(contextTokens([assistant({ input_tokens: 100, cache_creation_input_tokens: 200, cache_read_input_tokens: 300 }), synthetic, sub]), 600)
})

test('context: after a compaction it is the compacted size until the next response', () => {
  const before = assistant({ input_tokens: 2, cache_creation_input_tokens: 500000, cache_read_input_tokens: 467789 })
  assert.equal(contextTokens([before, compacted(44489)]), 44489)
  assert.equal(contextTokens([before, compacted(44489), result(false), assistant({ input_tokens: 5, cache_creation_input_tokens: 50000, cache_read_input_tokens: 0 })]), 50005)
  assert.equal(contextTokens([before, compacted(undefined)]), null)
  assert.equal(contextTokens([prompt('hi')]), null)
})

test('the window: Claude Code\'s own figure first, then the model id; unknown stays unknown', () => {
  assert.equal(contextWindow(stdin()), 200000)
  assert.equal(contextWindow(stdin({ context_window: { context_window_size: 1000000 } })), 1000000)
  assert.equal(contextWindow({ model: { id: 'claude-sonnet-4-5[1m]' } }), 1000000)
  assert.equal(contextWindow({ model: { id: 'claude-sonnet-4-5-20250929' } }), 200000)
  assert.equal(contextWindow({ model: { id: 'claude-3-7-sonnet-latest' } }), 200000)
  assert.equal(contextWindow({ model: { id: 'some-new-model' } }), null)
  assert.equal(contextWindow({ model: { id: 'some-new-model' }, context_window: { context_window_size: 0 } }), null)
  assert.equal(contextWindow({}), null)
})

test('the percentage: tokens over window, held to 100, unknown when either is', () => {
  assert.equal(contextPercent(50000, 200000), 25)
  assert.equal(contextPercent(250000, 200000), 100)
  assert.equal(contextPercent(0, 200000), 0)
  assert.equal(contextPercent(null, 200000), null)
  assert.equal(contextPercent(50000, null), null)
})

// ---------------------------------------------------------------- reading the transcript

test('a tail starts mid-line: its first line is dropped, and a line still being written is skipped', () => {
  const text = jsonl([result(true), result(false), result(false)])
  const cut = text.slice(text.indexOf('\n') - 20) // inside the first line
  assert.equal(parseTail(cut, false).length, 2)
  assert.equal(parseTail(cut, true).length, 2) // the cut line doesn't parse either way
  assert.equal(parseTail(`${text}{"type":"assistant","mess`).length, 3)
  assert.deepEqual(parseTail(''), [])
  assert.deepEqual(parseTail('no newline at all', false), [])
})

test('an empty transcript: nothing used, no streak, the window still known', () => {
  const s = gather(stdin({ transcript_path: transcript('') }))
  assert.equal(s.tokens, null)
  assert.equal(s.percent, null)
  assert.deepEqual(s.streak, { count: 0, exact: true })
  assert.equal(s.window, 200000)
})

test('a missing transcript: no error, and Claude Code\'s own current_usage is used instead', () => {
  assert.equal(readTail('/nonexistent/none.jsonl', 1024), null)
  const s = gather(stdin())
  assert.deepEqual([s.tokens, s.percent, s.streak], [null, null, { count: 0, exact: true }])
  const usage = { input_tokens: 8500, output_tokens: 1200, cache_creation_input_tokens: 5000, cache_read_input_tokens: 2000 }
  assert.equal(gather(stdin({ context_window: { context_window_size: 200000, current_usage: usage } })).tokens, 15500)
  assert.equal(gather({}).tokens, null)
})

test('a model with an unknown window: the tokens are read, the share is shown as unknown', () => {
  const file = transcript(jsonl([assistant({ input_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 })]))
  const s = gather({ transcript_path: file, model: { id: 'some-new-model', display_name: 'New' } })
  assert.deepEqual([s.tokens, s.window, s.percent], [100, null, null])
  for (const slug of THEMES) assert.match(strip(render(slug, s)), /--%/, slug)
})

test('only the tail is read, widened until the streak\'s start is in it', () => {
  // ~150 KB of results after the error, then the newest assistant message
  const big = () => result(false, { toolUseResult: { stdout: 'x'.repeat(30000), stderr: '' } })
  const lines = [assistant(), result(true), ...Array.from({ length: 5 }, big), assistant({ input_tokens: 7 })]
  const file = transcript(`${jsonl(Array.from({ length: 40 }, big))}${jsonl(lines)}`)
  const widened = gather({ transcript_path: file }, { steps: [64 * 1024, 512 * 1024, 4 * 1024 * 1024] })
  assert.deepEqual(widened.streak, { count: 5, exact: true })
  assert.equal(widened.tokens, 7 + 141936 + 30613)
  // Told to stop at 64 KB, it reports what it saw as a lower bound.
  const short = gather({ transcript_path: file }, { steps: [64 * 1024] })
  assert.equal(short.streak.exact, false)
  assert.ok(short.streak.count >= 1 && short.streak.count < 5)
  assert.match(strip(render('modern-warfare-2', { ...short, model: 'Opus', dir: '' })), /KILLSTREAK 0\d\+/)
})

// ---------------------------------------------------------------- what is printed

const strip = (line) => line.replace(/\x1b\[[0-9;]*m/g, '')
// One column in GNU screen 4.00.03 and in the app's view alike: ASCII, box drawing, half-width katakana.
const SAFE = /^[\x20-\x7e─-╿ｦ-ﾝ]*$/

test('width safety: every theme prints only one-column characters, whatever the input holds', () => {
  const hostile = {
    model: { id: 'x', display_name: 'Opus \u{1f4c5} ⏱️ \x1b]0;pwn\x07' },
    workspace: { current_dir: '/Users/svoboden/Çalışma \u{1f525}‍️́' },
  }
  const states = [
    gather(stdin()), gather(hostile), gather({}),
    ...[0, 37, 61, 86, 100].map((percent) => ({ ...gather(stdin()), tokens: percent * 2000, percent })),
    ...[[0, true], [3, true], [7, true], [25, true], [31, false]].map(([count, exact]) => ({ ...gather(stdin()), streak: { count, exact } })),
  ]
  for (const slug of THEMES) {
    for (const state of states) {
      const line = render(slug, state)
      const text = strip(line)
      assert.ok(!text.includes('\x1b'), `${slug}: an escape other than a colour: ${JSON.stringify(line)}`)
      assert.match(text, SAFE, `${slug}: ${JSON.stringify(text)}`)
      assert.ok(!line.includes('\n'), slug)
    }
  }
  assert.equal(plain('Çalışma'), 'Calisma')
  assert.equal(plain('a\u{1f4c5}b⏱️c'), 'a?b??c')
})

test('each theme shows its own reading', () => {
  const s = { model: 'Opus', dir: 'svobodens-themes', tokens: 124000, window: 200000, percent: 62, streak: { count: 7, exact: true } }
  assert.equal(strip(render('cyberpunk-2077', s)), ' OPUS ╱ RAM ┃┃┃┃┃┃││││ 62% 124K/200K ╱ svobodens-themes')
  assert.match(strip(render('matrix', s)), /^> Opus :: [ｦ-ﾝ]{12} 62% :: svobodens-themes$/)
  assert.equal(strip(render('modern-warfare-2', s)),
    '[OP SVOBODEN] OPUS > KILLSTREAK 07 GUNSHIP NEXT TACTICAL NUKE 18 > AMMO 38% > svobodens-themes')
  assert.equal(render('no-such-theme', s), null)
})

test('the colours are the theme\'s own, in 24-bit', () => {
  const s = { model: 'Opus', dir: '', tokens: 0, window: 200000, percent: 0, streak: { count: 0, exact: true } }
  assert.ok(render('cyberpunk-2077', s).includes('\x1b[48;2;252;238;10m')) // #fcee0a behind the model's name
  assert.ok(render('modern-warfare-2', s).includes('\x1b[38;2;220;173;0m')) // #dcad00, the callsign
  assert.ok(render('matrix', s).includes('\x1b[38;2;29;92;18m')) // #1d5c12, the unlit rain
})

test('the Matrix bar: half-width katakana, lit from the left with the drop\'s head last', () => {
  const bar = rainBar(50, 12, 15500)
  assert.equal(bar.length, 12)
  assert.ok(bar.every(({ glyph }) => /^[ｦ-ﾝ]$/.test(glyph)))
  // half of 12 lit: the head at the 6th, two bright glyphs behind it, then the phosphor trail
  assert.deepEqual(bar.map((c) => c.tone), [
    'phosphor', 'phosphor', 'phosphor', 'bright', 'bright', 'head', 'unlit', 'unlit', 'unlit', 'unlit', 'unlit', 'unlit'])
  assert.equal(rainBar(25, 12).at(-1).tone, 'unlit')
  // full: the trail fades from the head (5 back) into plain code green
  assert.deepEqual(rainBar(100, 12).map((c) => c.tone), [
    'code', 'code', 'code', 'code', 'code', 'code', 'phosphor', 'phosphor', 'phosphor', 'bright', 'bright', 'head'])
  assert.deepEqual(rainBar(50, 12, 15500), bar) // same reading, same glyphs
  assert.equal(rainBar(null, 12).filter((c) => c.tone !== 'unlit').length, 0)
  assert.equal(rainBar(100, 12).filter((c) => c.tone === 'unlit').length, 0)
  assert.equal(rainBar(100, 12)[11].tone, 'head')
})

test('a line too wide for COLUMNS sheds its extras first', () => {
  const groups = [
    { parts: [['KEEP', {}]] }, { parts: [[' dir-dir-dir', {}]], drop: 1 }, { parts: [[' more', {}]], drop: 2 },
  ]
  assert.equal(strip(compose(groups, 80)), 'KEEP dir-dir-dir more')
  assert.equal(strip(compose(groups, 12)), 'KEEP more')
  assert.equal(strip(compose(groups, 3)), 'KEEP')
  assert.equal(strip(compose(groups, NaN)), 'KEEP dir-dir-dir more')
})

test('token counts in short form', () => {
  assert.deepEqual([850, 15500, 124000, 1000000, 1500000, null].map(tokensLabel), ['850', '16K', '124K', '1M', '1.5M', '--'])
})

// ---------------------------------------------------------------- the script itself

const run = (args, input, env = {}) => spawnSync(process.execPath, [SCRIPT, ...args],
  { input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8', env: { ...process.env, ...env } })

test('the script: one line from Claude Code\'s JSON on stdin', () => {
  const file = transcript(jsonl([result(true), assistant(), result(false), assistant(), result(false), assistant(), result(false)]))
  const out = run(['--theme', 'modern-warfare-2'], stdin({ transcript_path: file }), { COLUMNS: '200' })
  assert.equal(out.status, 0, out.stderr)
  assert.equal(out.stderr, '')
  assert.equal(strip(out.stdout), '[OP SVOBODEN] OPUS > KILLSTREAK 03 UAV NEXT PRECISION STRIKE 2 > AMMO 14% > svobodens-themes\n')
  const cp = run(['--theme=cyberpunk-2077'], stdin({ transcript_path: file }), { COLUMNS: '200' })
  assert.match(strip(cp.stdout), / RAM ┃┃┃┃┃┃┃┃┃│ 86% 173K\/200K /)
})

test('the script: a missing transcript, bad JSON or a wrong --theme still print a line', () => {
  for (const slug of THEMES) {
    const out = run(['--theme', slug], stdin())
    assert.equal(out.status, 0, out.stderr)
    assert.equal(out.stdout.split('\n').length, 2, slug)
  }
  assert.match(strip(run(['--theme', 'matrix'], 'not json').stdout), /^> Claude :: /)
  assert.equal(run(['--theme', 'nope'], stdin()).stdout,
    'statusline: unknown --theme "nope", use cyberpunk-2077, matrix, modern-warfare-2\n')
})
