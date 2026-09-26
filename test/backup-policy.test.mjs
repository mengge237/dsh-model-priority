// 备份策略回归（0.2.4）：本机实测暴露的问题 —— 09-11 半小时内 17 份逐字相同的
// settings.yaml.bak-*，09-26 连点三次保存又落 3 份。这里把"未变不写、同内容复用、
// 只留最近 N 份、手工备份不碰"四条钉死，并且真走一遍保存路径（不只测工具函数）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const B = await import(pathToFileURL(join(process.cwd(), 'lib', 'backup.js')).href)
const ISO = String.raw`\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z`

function tmp() { return mkdtempSync(join(tmpdir(), 'dshbk-')) }
function list(d, base) { return readdirSync(d).filter((n) => n.startsWith(base + '.bak-')).sort() }

test('内容没变：既不写盘也不新增备份', () => {
  const d = tmp(); const f = join(d, 'cfg.yml')
  writeFileSync(f, 'a: 1\nb: 2\n', 'utf8')
  const r = B.writeWithBackup(f, 'a: 1\nb: 2\n')
  assert.equal(r.changed, false, '未变要报 changed:false')
  assert.equal(r.backup, null, '未变不该有备份')
  assert.deepEqual(list(d, 'cfg.yml'), [], '未变不该留下备份文件')
  assert.equal(readFileSync(f, 'utf8'), 'a: 1\nb: 2\n')
})

test('内容变了：写成功并留下一份"等于写前状态"的备份', () => {
  const d = tmp(); const f = join(d, 'cfg.yml')
  writeFileSync(f, 'a: 1\n', 'utf8')
  const r = B.writeWithBackup(f, 'a: 2\n')
  assert.equal(r.changed, true)
  assert.equal(r.reused, false)
  assert.match(r.backup, new RegExp(String.raw`cfg\.yml\.bak-${ISO}$`), '命名要能认出是本插件产的')
  assert.equal(readFileSync(r.backup, 'utf8'), 'a: 1\n', '备份必须等于写前内容')
  assert.equal(readFileSync(f, 'utf8'), 'a: 2\n')
})

test('A→B→A→B 来回拖：每个写前状态各留一份，重复的写不增份', () => {
  const d = tmp(); const f = join(d, 'cfg.yml')
  writeFileSync(f, 'A\n', 'utf8')
  const r1 = B.writeWithBackup(f, 'B\n')
  const r2 = B.writeWithBackup(f, 'A\n')
  const r3 = B.writeWithBackup(f, 'B\n')
  assert.equal(r2.reused, false, '写回 A 时写前状态是 B，还没有 B 的备份，必须新落一份（回滚点不能少）')
  assert.equal(r3.reused, true, '此时 A、B 两份都在，写回 B 的写前状态 A 已有备份 —— 复用')
  const kept = list(d, 'cfg.yml')
  assert.equal(kept.length, 2, '来回拖三轮只该留 A、B 两份，实际 ' + kept.length + '：' + kept.join(','))
  assert.deepEqual(kept.map((p) => readFileSync(join(d, p), 'utf8')).sort(), ['A\n', 'B\n'], '两份备份正好覆盖两个写前状态')
  assert.equal(readFileSync(f, 'utf8'), 'B\n', '最终内容要是最后一次写的 B')
  const r4 = B.writeWithBackup(f, 'B\n')
  assert.equal(r4.changed, false, '再点一次同内容保存：什么都不该发生')
})

test('超过上限只清自己命名的最旧备份，手工放的一份不碰', () => {
  const d = tmp(); const f = join(d, 'cfg.yml')
  writeFileSync(f, 'v0\n', 'utf8')
  writeFileSync(join(d, 'cfg.yml.bak-20260905-170055'), 'human-keep-1\n', 'utf8')
  writeFileSync(join(d, 'cfg.yml.bak-before-ollama-20260912-183312'), 'human-keep-2\n', 'utf8')
  process.env.DSH_MODEL_PRIORITY_BACKUPS = '3'
  try {
    for (let i = 1; i <= 6; i++) {
      const before = readFileSync(f, 'utf8')
      const r = B.writeWithBackup(f, 'v' + i + '\n')
      assert.equal(r.backup, existsSync(r.backup) ? r.backup : null)
      if (!r.reused) assert.equal(readFileSync(r.backup, 'utf8'), before, '新备份必须等于写前内容')
    }
  } finally { delete process.env.DSH_MODEL_PRIORITY_BACKUPS }
  const mine = list(d, 'cfg.yml').filter((n) => new RegExp(String.raw`\.bak-(proxy-)?${ISO}$`).test(n))
  assert.ok(mine.length <= 3, '自己命名的备份最多留 3 份，实际 ' + mine.length)
  assert.ok(existsSync(join(d, 'cfg.yml.bak-20260905-170055')), '手工备份不许删（1）')
  assert.ok(existsSync(join(d, 'cfg.yml.bak-before-ollama-20260912-183312')), '手工备份不许删（2）')
  assert.equal(readFileSync(f, 'utf8'), 'v6\n', '写本身要成功')
})

test('proxy 那类带 tag 的备份也算自己人，能进清理名单', () => {
  const d = tmp(); const f = join(d, 'settings.yaml')
  writeFileSync(f, 'x: 1\n', 'utf8')
  for (let i = 0; i < 4; i++) {
    B.writeWithBackup(f, 'x: ' + (i + 2) + '\n', { tag: 'proxy' })
  }
  const names = readdirSync(d).filter((n) => /^settings\.yaml\.bak-proxy-/.test(n))
  assert.equal(names.length, 4, 'tag 不同则内容不同，四份都该在')
  assert.ok(names.every((n) => new RegExp(String.raw`\.bak-proxy-${ISO}$`).test(n)), '命名形状要能被认出：' + names.join(','))
})

// ── 真走一遍保存路径（0.1.7 的 profile 用户层）──
let seq = 0
async function loadWith(home) {
  process.env.DSH_HOME = home
  const url = pathToFileURL(join(process.cwd(), 'lib', 'index.js')).href + '?t=' + (++seq)
  return (await import(url)).internals
}
const LAYER = [
  '- id: llm-pi-ai',
  '  name: "@deepseek-ai/dsh-llm-pi-ai"',
  '  config:',
  '    providers:',
  '      bailian:',
  '        apiKeyEnv: BAILIAN_API_KEY',
  '        models:',
  '          - id: m1',
  '          - id: m2',
  '          - id: m3',
  '',
].join('\n')

test('保存路径：同一顺序点两次，第二次什么都不落', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dshmp-' + ++seq + '-'))
  const rel = join('profiles', 'web', 'cordis.patch.yml')
  mkdirSync(join(home, 'profiles', 'web'), { recursive: true })
  writeFileSync(join(home, rel), LAYER, 'utf8')
  const I = await loadWith(home)

  const first = I.reorderProviderModels('bailian', ['m3', 'm1', 'm2'])
  assert.equal(first.ok, true, '第一次写要成功：' + first.error)
  const filesAfterFirst = readdirSync(join(home, 'profiles', 'web')).filter((n) => n.includes('.bak-')).length
  assert.equal(filesAfterFirst, 1, '第一次写留 1 份备份')

  const second = I.reorderProviderModels('bailian', ['m3', 'm1', 'm2'])
  assert.equal(second.ok, true)
  assert.equal(second.unchanged, true, '顺序没变要报 unchanged')
  const filesAfterSecond = readdirSync(join(home, 'profiles', 'web')).filter((n) => n.includes('.bak-')).length
  assert.equal(filesAfterSecond, 1, '第二次点保存不该再多一份备份')
})

test('保存路径：来回拖四次只留两份备份（A 与 B 各一份）', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dshmp-' + ++seq + '-'))
  const rel = join('profiles', 'web', 'cordis.patch.yml')
  mkdirSync(join(home, 'profiles', 'web'), { recursive: true })
  writeFileSync(join(home, rel), LAYER, 'utf8')
  const I = await loadWith(home)

  const seqs = [['m3', 'm1', 'm2'], ['m1', 'm2', 'm3'], ['m3', 'm1', 'm2'], ['m1', 'm2', 'm3']]
  for (const s of seqs) {
    const r = I.reorderProviderModels('bailian', s)
    assert.equal(r.ok, true, '写要成功：' + r.error)
  }
  const baks = readdirSync(join(home, 'profiles', 'web')).filter((n) => n.includes('.bak-'))
  assert.equal(baks.length, 2, '四次来回只该留 2 份：' + baks.join(','))
  assert.equal(readFileSync(join(home, rel), 'utf8').includes('- id: m1\n          - id: m2\n          - id: m3'), true,
    '最终顺序要回到 m1,m2,m3')
})
