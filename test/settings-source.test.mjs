// 真源两代形状的回归测试。
// 这条测试是 2026-09-25 补的：0.1.7 把 settings.yaml 搬进 profile 用户层之后，
// 本包的读路径整个失效（线上实测 6 个提供方各 0 个模型），而原有 46 项测试全绿 ——
// 因为它们从没碰过真源文件。这里用**真实的 0.1.7 形状**建夹具，不用老形状糊过去。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** 0.1.7 的 profile 用户层：providers 在 `- id: llm-pi-ai` 的 config 里，比老布局深两级。 */
const PROFILE_LAYER = [
  '# Your patch layer for this dsh profile, applied after every bundle layer:',
  '- { id: web-ui-ssh, name: \'@linxin666/dsh-web-all/ssh\', disabled: false }',
  '- id: llm-pi-ai',
  '  name: "@deepseek-ai/dsh-llm-pi-ai"',
  '  config:',
  '    providers:',
  '      bailian:',
  '        displayName: 阿里云百炼·免费额度',
  '        apiKeyEnv: BAILIAN_API_KEY',
  '        api: openai-completions',
  '        baseURL: https://bailian.invalid/compatible-mode/v1',
  '        models:',
  '          - id: kimi-k2.5',
  '            name: kimi-k2.5·百炼免费',
  '          - id: qwen-max',
  '            name: qwen-max·百炼免费',
  '      tokenplan:',
  '        displayName: 阿里云 Token Plan',
  '        apiKeyEnv: TOKENPLAN_API_KEY',
  '        baseURL: https://token-plan.invalid/compatible-mode/v1',
  '        defaultContextWindow: 1000000',
  '        models:',
  '          - id: glm-5.2',
  '          - id: qwen3.8-flash',
  '        retryPolicy:',
  '          maxRetries: 5',
  '- id: agent-default-model',
  '  name: "@deepseek-ai/dsh-agent-default-model"',
  '  config:',
  '    provider: tokenplan',
  '    model: qwen3.8-flash',
  '',
].join('\n')

/** 0.1.5 的老布局（同一份配置的等价写法），用来验两代解析结果一致。 */
const LEGACY_SETTINGS = [
  'llm-pi-ai:',
  '  providers:',
  '    bailian:',
  '      apiKeyEnv: BAILIAN_API_KEY',
  '      baseURL: https://bailian.invalid/compatible-mode/v1',
  '      models:',
  '        - id: kimi-k2.5',
  '          name: kimi-k2.5·百炼免费',
  '        - id: qwen-max',
  '          name: qwen-max·百炼免费',
  '    tokenplan:',
  '      apiKeyEnv: TOKENPLAN_API_KEY',
  '      baseURL: https://token-plan.invalid/compatible-mode/v1',
  '      models:',
  '        - id: glm-5.2',
  '        - id: qwen3.8-flash',
  '',
].join('\n')

let seq = 0
/** 每个夹具要换一个 DSH_HOME 再重新 import（模块顶层就把路径算成常量了）。 */
async function loadWith(home) {
  process.env.DSH_HOME = home
  const url = pathToFileURL(join(process.cwd(), 'lib', 'index.js')).href + '?t=' + (++seq)
  return (await import(url)).internals
}
function homeWith(relPath, text) {
  const home = mkdtempSync(join(tmpdir(), 'dshmp-' + ++seq + '-'))
  const p = join(home, relPath)
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, text, 'utf8')
  return home
}

test('0.1.7 形状：读得到提供方、baseURL 与模型顺序', async () => {
  const home = homeWith(join('profiles', 'web', 'cordis.patch.yml'), PROFILE_LAYER)
  const I = await loadWith(home)

  assert.ok(I.findProfileLayer(), '应能找到 profiles/web/cordis.patch.yml')
  const provs = I.readProviders()
  assert.deepEqual(Object.keys(provs).sort(), ['bailian', 'tokenplan'], '两个提供方都要解析出来')
  assert.equal(provs.bailian.baseURL, 'https://bailian.invalid/compatible-mode/v1')
  assert.equal(provs.bailian.apiKeyEnv, 'BAILIAN_API_KEY')
  assert.equal(provs.tokenplan.apiKeyEnv, 'TOKENPLAN_API_KEY')

  assert.deepEqual(I.readProviderModelIds('bailian'), ['kimi-k2.5', 'qwen-max'])
  assert.deepEqual(I.readProviderModelIds('tokenplan'), ['glm-5.2', 'qwen3.8-flash'])
})

test('两代形状解析结果必须一致（防止规一时缩进算错）', async () => {
  const h1 = homeWith('settings.yaml', LEGACY_SETTINGS)
  const legacy = await loadWith(h1)
  const h2 = homeWith(join('profiles', 'web', 'cordis.patch.yml'), PROFILE_LAYER)
  const prof = await loadWith(h2)

  assert.deepEqual(Object.keys(prof.readProviders()).sort(), Object.keys(legacy.readProviders()).sort())
  for (const r of ['bailian', 'tokenplan']) {
    assert.deepEqual(prof.readProviderModelIds(r), legacy.readProviderModelIds(r), r + ' 的模型顺序两代应一致')
    assert.equal(prof.readProviders()[r].baseURL, legacy.readProviders()[r].baseURL)
  }
})

test('0.1.7 上写回 profile 用户层：只动模型条目、区域外一字不变、不造 settings.yaml', async () => {
  const rel = join('profiles', 'web', 'cordis.patch.yml')
  const home = homeWith(rel, PROFILE_LAYER)
  const I = await loadWith(home)
  const file = join(home, rel)
  const before = readFileSync(file, 'utf8')

  const res = I.reorderProviderModels('bailian', ['qwen-max', 'kimi-k2.5'])
  assert.equal(res.ok, true, '写回应成功：' + res.error)
  assert.deepEqual(res.ids, ['qwen-max', 'kimi-k2.5'])

  const after = readFileSync(file, 'utf8')
  assert.notEqual(after, before, '文件应已改写')
  assert.equal(existsSync(I.SETTINGS_FILE), false, '绝不凭空造 settings.yaml（0.1.7 的 loader 会再导入一次）')
  assert.match(res.backup, /cordis\.patch\.yml\.bak-/, '要留备份')
  assert.ok(existsSync(res.backup), '备份文件应在盘上')

  const b = before.split('\n'), a2 = after.split('\n')
  assert.equal(a2.length, b.length, '总行数不许变')
  // 区域外逐行一致
  let first = 0; while (b[first] === a2[first]) first++
  let lastd = 0; while (lastd < b.length - first && b[b.length - 1 - lastd] === a2[a2.length - 1 - lastd]) lastd++
  for (let i = 0; i < b.length; i++) {
    if (i >= first && i < b.length - lastd) continue
    assert.equal(a2[i], b[i], '区域外第 ' + (i + 1) + ' 行被改动：' + b[i])
  }
  // 改动区内只允许模型条目缩进（10 空格起）
  for (const l of a2.slice(first, b.length - lastd)) {
    if (l.trim() === '') continue
    assert.match(l, /^ {10,}\S/, '区外不应出现非模型条目行：' + l)
  }
  // 集合不变（只是排列），且顺序生效
  assert.deepEqual(I.readProviderModelIds('bailian'), ['qwen-max', 'kimi-k2.5'])
  assert.deepEqual(I.readProviderModelIds('tokenplan'), ['glm-5.2', 'qwen3.8-flash'], '另一个提供方不应被牵连')
  assert.equal(Object.keys(I.readProviders()).length, 2, '提供方集合不变')
})

test('0.1.7 写回：找不到提供方时明确报错且一个字节都不落', async () => {
  const rel = join('profiles', 'web', 'cordis.patch.yml')
  const home = homeWith(rel, PROFILE_LAYER)
  const I = await loadWith(home)
  const file = join(home, rel)
  const before = readFileSync(file, 'utf8')

  const res = I.reorderProviderModels('no-such-route', ['x'])
  assert.equal(res.ok, false)
  assert.match(res.error, /找不到提供方/)
  assert.equal(readFileSync(file, 'utf8'), before, '失败必须完全没写')
  assert.equal(existsSync(I.SETTINGS_FILE), false)
})

test('老布局仍可写，且写前留 .bak', async () => {
  const home = homeWith('settings.yaml', LEGACY_SETTINGS)
  const I = await loadWith(home)

  const res = I.reorderProviderModels('bailian', ['qwen-max', 'kimi-k2.5'])
  assert.equal(res.ok, true, res.error)
  assert.deepEqual(res.ids, ['qwen-max', 'kimi-k2.5'])
  const text = readFileSync(I.SETTINGS_FILE, 'utf8')
  assert.ok(text.indexOf('qwen-max') < text.indexOf('kimi-k2.5'), '文件里顺序应真的换了')
  assert.ok(existsSync(I.SETTINGS_FILE + '.bak-' + res.backup.slice(res.backup.length - 24)) ||
            /settings\.yaml\.bak-/.test(res.backup), '要留备份')
})
