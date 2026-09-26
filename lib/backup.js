// 备份策略（0.2.4）：写盘前留一份能回到"写前状态"的备份，但不许把它刷成一串垃圾。
//
// 为什么要有这个模块：09-26 真机连点三次保存，profiles/web 下就落了 3 份 ISO 命名的
// 备份；翻旧账更夸张 —— ~/.dsh 里 09-11 那半小时刷出 17 份 settings.yaml.bak-*，
// 12493 字节逐字相同。行为本身没错（每次写都留了退路），但没人会去翻第 4 份以后的
// 同类备份，留着只是把配置目录变成垃圾场。三条规则：
//   1. 内容没变就不写也不备份（点了保存但顺序没动 → 什么都没发生）；
//   2. 最新那份备份已经等于当前内容时复用它，不再新增（A→B→A→B 来回拖不会成对刷）；
//   3. 只保留最近 N 份（默认 5，可用 DSH_MODEL_PRIORITY_BACKUPS 调），
//      且**只清理本插件自己命名的那份形状** `<file>.bak-<ISO>` / `<file>.bak-proxy-<ISO>`，
//      手工放的 `settings.yaml.bak-20260905-170055`、`…bak-before-ollama-…` 一律不碰。
'use strict'
import fs from 'node:fs'
import path from 'node:path'

/** 本插件自己产生的备份名形状（ISO 到毫秒，冒号与点换成短横）。 */
const ISO_TAIL = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z(-\d+)?$/

function readOrNull(p) {
  try { return fs.readFileSync(p, 'utf8') } catch { return null }
}

/** 该文件的全部"自己人"备份，按名字里的时间戳倒序（最新在前）。 */
function backupsOf(target) {
  const dir = path.dirname(target)
  const prefix = path.basename(target) + '.bak-'
  let names = []
  try { names = fs.readdirSync(dir) } catch { return [] }
  return names
    .filter((n) => n.startsWith(prefix))
    .map((n) => n.slice(prefix.length))
    .filter((tail) => tail.startsWith('proxy-') ? ISO_TAIL.test(tail.slice(6)) : ISO_TAIL.test(tail))
    .map((tail) => path.join(dir, prefix + tail))
    .sort()
    .reverse()
}

function keepLimit() {
  const raw = process.env.DSH_MODEL_PRIORITY_BACKUPS
  const n = raw === undefined || raw === '' ? 5 : Number.parseInt(raw, 10)
  return Number.isFinite(n) && n >= 1 ? n : 5
}

/**
 * 原子写 + 受控备份。
 * @param target 要写的文件（绝对路径）
 * @param next 新内容（整份文本）
 * @param opts.tag 备份名后缀段（如 'proxy'），默认留空
 * @returns {{changed: boolean, backup: string|null, reused: boolean, removed: string[], error?: string}}
 */
export function writeWithBackup(target, next, opts) {
  const tag = (opts && opts.tag) || ''
  const cur = readOrNull(target)
  if (cur === null) return { changed: false, backup: null, reused: false, removed: [], error: '目标文件不存在，拒绝写' }
  if (cur === next) return { changed: false, backup: null, reused: false, removed: [] }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const suffix = tag ? '.bak-' + tag + '-' + stamp : '.bak-' + stamp
  const cand = path.join(path.dirname(target), path.basename(target) + suffix)

  // 复用判据看的是「已有备份里是否已存着这一份写前状态」，不是只看最新那份：
  // A→B→A→B 这种来回拖，只看最新一份会连着刷出 BK(A)、BK(B)、BK(A)…，扫全表才收得住。
  const list = backupsOf(target)
  let backup = null
  let reused = false
  const hit = list.find((p) => readOrNull(p) === cur)
  if (hit) { backup = hit; reused = true }
  if (!backup) {
    let cand2 = cand
    for (let n = 2; fs.existsSync(cand2); n++) {
      // 同一毫秒内撞上同名（理论上要两次写之间还换了内容才会发生）就加序号，别让备份互相覆盖。
      cand2 = cand + '-' + n
    }
    fs.copyFileSync(target, cand2); backup = cand2
  }

  const tmp = target + '.tmp'
  fs.writeFileSync(tmp, next, 'utf8')
  fs.renameSync(tmp, target)

  const keep = keepLimit()
  const removed = []
  backupsOf(target).slice(keep).forEach((p) => {
    if (p === backup) return
    try { fs.unlinkSync(p); removed.push(p) } catch { /* 只尽力清，不因此判失败 */ }
  })
  return { changed: true, backup, reused, removed }
}

export { backupsOf as listBackups, keepLimit }
