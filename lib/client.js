// dsh-model-priority —— 浏览器侧：在**设置 → 模型**页的每张提供方卡片里加「模型顺序」区
//
// 形态：走**上游**槽位 settings.models.provider-card（keyed，key = 适配器家族的 settings
// namespace，我们是 llm-pi-ai）。这是官方为「仓库外插件往模型页加 UI」提供的正式扩展点
// （见 dsh-client-ui-settings-models 的 slot-contract 与架构笔记
//  .agents/notes/archived/architecture/2026-08-26-models-page-extension-slots）。
// 2026-09-10 改版：**删掉了原来的侧边栏 tab 与自建设置分区** —— 排序入口收敛到用户本来
// 就在看的模型页里，不再另开页面，也不再有第二套顺序来源。
//
// 顺序的唯一事实来源 = settings.yaml 里该提供方的 models 数组；拖拽后由本包服务端做
// 「文本块级重排」（原子写 + .bak 备份，逐行校验，字段零丢失）。
//
// 拖拽用原生 HTML5 drag & drop：宿主客户端模块图只保证给到 react，@dnd-kit 那类包解析不到。
//
// 本文件是宿主客户端模块图里的一个 bundle（package.json 的 exports["./client"]）：
// **改完要重启 dsh web**（启动时扫进 boot 图，不是每次现读磁盘）。

window.__ModuleLoader__.load({
  id: 'dsh-model-priority',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const react = require('react')
    const h = react.createElement

    const inject = ['slots']
    const FAMILY_NS = 'llm-pi-ai'   // 自定义提供方所属家族的 settings namespace（槽位 key）
    const SEAT_KEYS = ['llm-pi-ai', 'llm-deepseek']   // 要覆盖的适配器家族：pi-ai + 内置 DeepSeek
    const STATE_ROUTE = '/dsh-model-priority/state.json'
    const ORDER_ROUTE = '/dsh-model-priority/order.json'

    const HAIR = 'rgba(127,127,127,0.28)'
    const MUTED = { color: 'inherit', opacity: 0.55 }
const READ_TIMEOUT_MS = 10000   // 读侧挂住的兜底：超时也落回「读取失败」，别停在「读取中…」
    const ACCENT = '#58a6ff'

    /* ── 小图标：一律自己画，不用 emoji ── */

    function GripIcon() {
      const dots = []
      for (const cy of [3, 7, 11]) {
        dots.push(h('circle', { key: 'l' + cy, cx: 2.6, cy: cy, r: 1.15 }))
        dots.push(h('circle', { key: 'r' + cy, cx: 7.4, cy: cy, r: 1.15 }))
      }
      return h('svg', {
        width: 10, height: 14, viewBox: '0 0 10 14',
        'aria-hidden': 'true', focusable: 'false', style: { display: 'block' },
      }, h('g', { fill: 'currentColor' }, dots))
    }

    function TabIcon(size) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round',
      },
        h('path', { d: 'M5.2 3.4h7.4M5.2 8h7.4M5.2 12.6h7.4' }),
        h('path', { d: 'M2.2 3.4h.01M2.2 8h.01M2.2 12.6h.01', strokeWidth: 2 }),
        h('path', { d: 'M3.4 1.6v3.6M3.4 6.2v3.6M3.4 10.8v3.6', opacity: 0.35 }))
    }

    /* ── 样式 ── */

    const rowBase = {
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '6px 8px', borderRadius: 6,
      border: '1px solid transparent',
      background: 'transparent',
      cursor: 'grab', userSelect: 'none',
    }

    function rowStyle(state) {
      const s = Object.assign({}, rowBase)
      if (state.dragging) s.opacity = 0.4
      if (state.over) {
        s.borderColor = ACCENT
        s.background = 'rgba(88,166,255,0.10)'
      }
      if (state.selected) s.background = 'rgba(127,127,127,0.12)'
      return s
    }

    const handleStyle = Object.assign({}, MUTED, { flex: '0 0 auto', cursor: 'grab' })

    const btnStyle = {
      padding: '3px 10px', borderRadius: 6, cursor: 'pointer',
      border: '1px solid ' + HAIR, background: 'transparent',
      color: 'inherit', fontSize: 12, lineHeight: '18px',
    }

    const sectionTitle = { fontSize: 12, fontWeight: 600, opacity: 0.8, margin: '0 0 6px' }

    /* ── 可拖拽列表 ── */

    function SortableList(props) {
      const items = props.items || []
      const dragFrom = react.useRef(null)
      const [overIndex, setOverIndex] = react.useState(null)
      const [draggingIndex, setDraggingIndex] = react.useState(null)

      function handleDragStart(i, e) {
        dragFrom.current = i
        setDraggingIndex(i)
        try {
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', String(i))
        } catch (err) {}
      }

      function handleDragOver(i, e) {
        e.preventDefault()
        try { e.dataTransfer.dropEffect = 'move' } catch (err) {}
        if (overIndex !== i) setOverIndex(i)
      }

      function handleDrop(i, e) {
        e.preventDefault()
        const from = dragFrom.current
        dragFrom.current = null
        setOverIndex(null)
        setDraggingIndex(null)
        if (from == null || from === i) return
        const next = items.slice()
        const moved = next.splice(from, 1)[0]
        next.splice(i, 0, moved)
        props.onReorder(next)
      }

      function handleDragEnd() {
        dragFrom.current = null
        setOverIndex(null)
        setDraggingIndex(null)
      }

      if (!items.length) {
        return h('div', { style: Object.assign({}, MUTED, { fontSize: 12, padding: '6px 8px' }) },
          props.emptyText || '这里没有可排序的条目')
      }

      return h('div', { role: 'list' }, items.map((item, i) => h('div', {
        key: item.id || String(i),
        role: 'listitem',
        draggable: true,
        onDragStart: (e) => handleDragStart(i, e),
        onDragOver: (e) => handleDragOver(i, e),
        onDrop: (e) => handleDrop(i, e),
        onDragEnd: handleDragEnd,
        onClick: props.onPick ? () => props.onPick(item) : undefined,
        style: rowStyle({
          dragging: draggingIndex === i,
          over: overIndex === i && draggingIndex !== i,
          selected: props.selectedId && item.id === props.selectedId,
        }),
      },
        h('span', { style: handleStyle, title: '按住拖动排序' }, h(GripIcon)),
        h('span', {
          style: { flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 },
          title: item.label || item.name || item.id,
        }, item.label || item.name || item.id),
      )))
    }

    /* ── 主视图 ── */

    function View() {
      const [data, setData] = react.useState(null)
      const [providers, setProviders] = react.useState([])
      const [models, setModels] = react.useState({})
      const [selected, setSelected] = react.useState('')
      const [error, setError] = react.useState('')
      const [status, setStatus] = react.useState('')
      const [loading, setLoading] = react.useState(false)
      const [dirty, setDirty] = react.useState(false)

      function adopt(payload) {
        setData(payload)
        const provs = (payload.providers || []).map((p) => ({ id: p.id, label: p.label }))
        setProviders(provs)
        const nextModels = {}
        const src = payload.models || {}
        for (const key of Object.keys(src)) {
          nextModels[key] = (src[key] || []).map((m) => ({ id: m.id, name: m.name }))
        }
        setModels(nextModels)
        const ids = provs.map((p) => p.id).filter(Boolean)
        setSelected((cur) => (cur && ids.indexOf(cur) !== -1 ? cur : (ids[0] || '')))
        setDirty(false)
      }

      const load = react.useCallback(function () {
        setLoading(true)
        setError('')
        fetch(STATE_ROUTE, { headers: { Accept: 'application/json' } })
          .then((r) => r.json())
          .then((payload) => {
            if (!payload || payload.ok !== true) throw new Error((payload && payload.error) || 'state.json 没有返回 ok')
            adopt(payload)
            setStatus('')
          })
          .catch((err) => setError(String((err && err.message) || err)))
          .finally(() => setLoading(false))
      }, [])

      react.useEffect(function () { load() }, [load])

      function save() {
        setLoading(true)
        setError('')
        const modelOrder = {}
        for (const key of Object.keys(models)) {
          const list = models[key]
          if (list && list.length) modelOrder[key] = list.map((m) => m.id)
        }
        fetch(ORDER_ROUTE, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            version: 1,
            providerOrder: providers.map((p) => p.id),
            modelOrder: modelOrder,
          }),
        })
          .then((r) => r.json())
          .then((payload) => {
            if (!payload || payload.ok !== true) throw new Error((payload && payload.error) || '保存失败')
            setDirty(false)
            setStatus('已保存，模型列表下次打开就按这个顺序排')
          })
          .catch((err) => setError(String((err && err.message) || err)))
          .finally(() => setLoading(false))
      }

      function reset() {
        setLoading(true)
        setError('')
        fetch(ORDER_ROUTE, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reset: true }),
        })
          .then((r) => r.json())
          .then((payload) => {
            if (!payload || payload.ok !== true) throw new Error((payload && payload.error) || '重置失败')
            setStatus('已恢复默认顺序')
            load()
          })
          .catch((err) => setError(String((err && err.message) || err)))
          .finally(() => setLoading(false))
      }

      const currentModels = models[selected] || []
      const selectedProvider = providers.find((p) => p.id === selected)

      const head = h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' } },
        h('div', { style: { fontSize: 13, fontWeight: 600, marginRight: 'auto' } }, '模型排序'),
        h('button', { style: btnStyle, onClick: load, disabled: loading }, '刷新'),
        h('button', {
          style: Object.assign({}, btnStyle, dirty ? { borderColor: ACCENT, color: ACCENT } : {}),
          onClick: save, disabled: loading || !dirty,
        }, dirty ? '保存 *' : '保存'),
        h('button', { style: btnStyle, onClick: reset, disabled: loading }, '恢复默认'))

      const body = []

      if (error) {
        body.push(h('div', {
          key: 'err',
          style: { fontSize: 12, color: '#f85149', border: '1px solid rgba(248,81,73,0.4)', borderRadius: 6, padding: '6px 8px', marginBottom: 8 },
        }, error))
      }
      if (status) {
        body.push(h('div', { key: 'st', style: Object.assign({}, MUTED, { fontSize: 12, marginBottom: 8 }) }, status))
      }
      if (data && data.hook && data.hook.ok === false) {
        body.push(h('div', {
          key: 'hook',
          style: { fontSize: 12, border: '1px solid ' + HAIR, borderRadius: 6, padding: '6px 8px', marginBottom: 8 },
        }, '排序没挂上宿主的模型列表：' + data.hook.reason))
      }
      for (const note of (data && data.notes) || []) {
        body.push(h('div', { key: 'n' + note, style: Object.assign({}, MUTED, { fontSize: 11, marginBottom: 4 }) }, note))
      }

      body.push(h('div', { key: 'p', style: { marginBottom: 14 } },
        h('div', { style: sectionTitle }, '提供方'),
        h(SortableList, {
          items: providers,
          selectedId: selected,
          onPick: (item) => setSelected(item.id),
          emptyText: '宿主没报出任何提供方',
          onReorder: (next) => { setProviders(next); setDirty(true); setStatus('') },
        })))

      body.push(h('div', { key: 'm' },
        h('div', { style: sectionTitle }, '模型' + (selectedProvider ? ' · ' + selectedProvider.label : '')),
        h(SortableList, {
          items: currentModels,
          emptyText: selected ? '这个提供方没有报出模型（适配器可能不支持列举）' : '先在上面选一个提供方',
          onReorder: (next) => {
            setModels((cur) => Object.assign({}, cur, { [selected]: next }))
            setDirty(true)
            setStatus('')
          },
        })))

      if (data) {
        body.push(h('div', {
          key: 'f',
          style: Object.assign({}, MUTED, { fontSize: 11, marginTop: 14, wordBreak: 'break-all' }),
        }, '顺序文件: ' + data.orderFile))
      }

      return h('div', { style: { padding: '10px 12px', fontSize: 13 } }, head, body)
    }

    /* ── 模型页卡片内的「模型顺序」区 ─────────────────────────────────────────
     * 2026-09-11 重做（按用户反馈）：
     *   - 默认折叠（原来一进来就铺开，太占地方；用户明确要求默认收起）
     *   - 按家族分段，每段各自可折叠（百炼一个路由 111 个模型，不分组根本拖不动）
     *   - 只有段内的模型行可拖，段头不可拖（"只有里面的模型可以拖动"）
     *   - 未在 settings 声明的路由（如内置的 deepseek-official）只读展示，明确说明为什么不能排
     * 席位：settings.models.provider-card（keyed），注册 key = 该卡片的 settingsNs。
     */
    const FAMILY_ORDER = ['qwen', 'glm', 'kimi', 'minimax', 'deepseek', 'other']

    function familyOf(id) {
      const s = String(id || '').toLowerCase().replace(/^(kimi|zhipu|siliconflow|minimax|moonshotai|moonshot)\//, '')
      if (s.indexOf('qwen') === 0 || s.indexOf('qvq') === 0 || s.indexOf('gui-') === 0) return 'qwen'
      if (s.indexOf('glm') === 0) return 'glm'
      if (s.indexOf('kimi') === 0 || s.indexOf('moonshot') === 0) return 'kimi'
      if (s.indexOf('minimax') === 0) return 'minimax'
      if (s.indexOf('deepseek') === 0) return 'deepseek'
      return 'other'
    }

    function CardOrderPanel(props) {
      const provider = (props && props.provider) || {}
      const route = provider.provider || ''
      const ns = provider.settingsNs || FAMILY_NS
      const [state, setState] = react.useState({ ids: null, tiers: {}, quota: {}, declared: false, note: '', failed: false })
      const [status, setStatus] = react.useState('')
      const [busy, setBusy] = react.useState(false)
      const [open, setOpen] = react.useState(false)              // 默认折叠
      const [closedGroups, setClosedGroups] = react.useState({}) // 每个家族段单独折叠
      const [err, setErr] = react.useState('')

      const load = react.useCallback(function () {
        if (!route) return
        setErr('')
        let alive = true
        const url = '/dsh-model-priority/provider-models?route=' + encodeURIComponent(route)
                  + '&ns=' + encodeURIComponent(ns)
        // 标题原来只有「读取中…」：读侧一报错就永远停在那句上，所以失败与超时都要落回标题。
        const timer = setTimeout(function () {
          if (!alive) return
          setErr('读取超时：' + (READ_TIMEOUT_MS / 1000) + 's 内 provider-models 没有返回')
          setState((prev) => Object.assign({}, prev, { failed: true }))
        }, READ_TIMEOUT_MS)
        const stop = function () { alive = false; clearTimeout(timer) }
        fetch(url, { headers: { Accept: 'application/json' } })
          .then((r) => r.json())
          .then((d) => {
            if (!alive) return
            clearTimeout(timer)
            if (!d || d.ok !== true) {
              setErr((d && d.error) || '读取失败')
              setState((prev) => Object.assign({}, prev, { failed: true }))
              return
            }
            const tm = {}
            ;(d.ids || []).forEach((id, i) => { tm[id] = (d.tiers || [])[i] })
            setState({ ids: d.ids || [], tiers: tm, quota: d.quota || {}, declared: d.declared === true, note: d.note || '', failed: false })
          })
          .catch((e) => {
            if (!alive) return
            clearTimeout(timer)
            setErr(String((e && e.message) || e))
            setState((prev) => Object.assign({}, prev, { failed: true }))
          })
        return stop
      }, [route, ns])

      react.useEffect(function () { return load() }, [load])

      function syncHost(nextIds, hostCtx) {
        const rs = hostCtx && hostCtx.remote && hostCtx.remote.settings
        if (!rs || typeof rs.describe !== 'function' || typeof rs.mutate !== 'function') return Promise.resolve('no-remote')
        return rs.describe().then(function (d) {
          const list = (d && d.namespaces) || []
          let view = null
          for (const x of list) if (x && x.ns === ns) { view = x; break }
          const provs = view && view.value && view.value.providers
          const arr = provs && provs[route] && provs[route].models
          if (!Array.isArray(arr) || !arr.length) return 'no-models'
          const byId = new Map()
          arr.forEach(function (m, i) { byId.set((m && m.id) || ('__unnamed_' + i), m) })
          const out = []
          for (const id of nextIds) { const m = byId.get(id); if (m !== undefined) { out.push(m); byId.delete(id) } }
          byId.forEach(function (m) { out.push(m) })
          return rs.mutate(ns, [{ op: 'set', path: ['providers', route, 'models'], value: out }], undefined)
            .then(function (resp) { return (resp && resp.ok === false) ? 'mutate-refused' : 'ok' })
        }).catch(function (e) { return 'error:' + String((e && e.message) || e) })
      }

      function applyOrder(nextIds, note) {
        setBusy(true); setStatus('')
        fetch('/dsh-model-priority/settings-order', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ route: route, ids: nextIds, ns: ns }),
        })
          .then((r) => r.json())
          .then((d) => {
            if (!d || d.ok !== true) { setStatus('写入失败：' + ((d && d.error) || '未知错误')); return null }
            setState((prev) => Object.assign({}, prev, { ids: d.ids || nextIds }))
            const prefix = note ? note + '：' : ''
            return syncHost(d.ids || nextIds, props.hostCtx).then(function (r) {
              if (r === 'ok') setStatus(prefix + '已写入并同步 —— 模型选择器顺序已跟随')
              else if (r === 'no-remote') setStatus(prefix + '已写入 settings.yaml（刷新页面后生效）')
              else setStatus(prefix + '已写入 settings.yaml，同步宿主未成功（' + r + '），刷新后生效')
            })
          })
          .catch((e) => setStatus('写入失败：' + String((e && e.message) || e)))
          .finally(() => setBusy(false))
      }

      function preset(mode, label) {
        setBusy(true); setStatus('')
        fetch('/dsh-model-priority/suggest?route=' + encodeURIComponent(route) + '&mode=' + mode,
              { headers: { Accept: 'application/json' } })
          .then((r) => r.json())
          .then((d) => { if (d && d.ok) applyOrder(d.ids, label); else setStatus('排序建议失败') })
          .catch((e) => setStatus('排序建议失败：' + String((e && e.message) || e)))
          .finally(() => setBusy(false))
      }

      // 段内拖动：把该段的新顺序写回全局顺序
      function reorderWithin(family, nextGroupItems) {
        const ids = (state.ids || []).slice()
        const nextGroupIds = nextGroupItems.map((x) => x.id)
        const positions = []
        ids.forEach((id, i) => { if (familyOf(id) === family) positions.push(i) })
        positions.forEach((pos, k) => { ids[pos] = nextGroupIds[k] })
        applyOrder(ids)
      }

      if (!route) return null

      const ids = state.ids || []
      const groups = {}
      for (const id of ids) {
        const f = familyOf(id)
        ;(groups[f] = groups[f] || []).push(id)
      }
      const famKeys = FAMILY_ORDER.filter((f) => groups[f] && groups[f].length)
      famKeys.sort(function (a, b) {
        if (a === 'other') return 1
        if (b === 'other') return -1
        return groups[b].length - groups[a].length
      })

      const btn = { fontSize: 12, padding: '3px 8px', border: '1px solid ' + HAIR, borderRadius: 6,
                    background: 'transparent', color: 'inherit', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.5 : 1 }
      const head = h('div', { key: 'hd', style: { display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' },
                              onClick: function () { setOpen(!open) } }, [
        h('span', { key: 'a', style: Object.assign({}, MUTED, { fontSize: 12 }) }, open ? '▾' : '▸'),
        h('span', { key: 't', style: sectionTitle }, '模型顺序'),
        h('span', { key: 'n', style: Object.assign({}, MUTED, { fontSize: 12 }),
                    title: state.failed ? (err || '读取失败') : '' },
          state.failed ? '读取失败'
            : state.ids === null ? '读取中…'
            : (ids.length + ' 个模型' + (state.declared ? '' : ' · 只读'))),
        h('span', { key: 'w', style: Object.assign({}, MUTED, { fontSize: 12 }) },
          state.declared ? '（拖动调整，写回 settings）' : ''),
      ])

      const body = []
      if (open) {
        if (err) body.push(h('div', { key: 'e', style: Object.assign({}, MUTED, { fontSize: 12, marginTop: 6 }) }, '读取失败：' + err))
        if (state.note) body.push(h('div', { key: 'note', style: Object.assign({}, MUTED, { fontSize: 12, marginTop: 6, lineHeight: 1.5 }) }, state.note))
        if (state.declared && ids.length) {
          body.push(h('div', { key: 'acts', style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8, marginBottom: 6 } }, [
            h('button', { key: 'c', type: 'button', style: btn, disabled: busy, onClick: function () { preset('capability', '旗舰优先') } }, '旗舰优先'),
            h('button', { key: 'q', type: 'button', style: btn, disabled: busy, onClick: function () { preset('cheap', '便宜优先') } }, '便宜优先'),
            h('button', { key: 'o', type: 'button', style: btn, disabled: busy, onClick: function () { preset('quota', '有额度优先') } }, '有额度优先'),
            h('button', { key: 'r', type: 'button', style: btn, disabled: busy, onClick: load }, '重新读取'),
          ]))
          body.push(h('div', { key: 'gl', style: { maxHeight: 420, overflowY: 'auto', border: '1px solid ' + HAIR, borderRadius: 6, padding: '4px 6px' } },
            famKeys.map(function (f) {
              const gIds = groups[f]
              const closed = !!closedGroups[f]
              return h('div', { key: f }, [
                h('div', { key: 'gh', style: { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                                               padding: '4px 2px', fontSize: 12, opacity: 0.75 },
                           onClick: function () { setClosedGroups(Object.assign({}, closedGroups, { [f]: !closed })) } }, [
                  h('span', { key: 'x' }, closed ? '▸' : '▾'),
                  h('span', { key: 'n', style: { fontWeight: 600 } }, f === 'other' ? '其他' : f),
                  h('span', { key: 'c', style: MUTED }, gIds.length + ' 个'),
                ]),
                closed ? null : h(SortableList, {
                  key: 'l' + f,
                  items: gIds.map(function (id) {
                    const q = state.quota[id] === 'ok' ? '余' : (state.quota[id] === 'exhausted' ? '尽' : '?')
                    return { id: id, label: id + '  · T' + (state.tiers[id] || '?') + ' · ' + q }
                  }),
                  onReorder: function (next) { reorderWithin(f, next) },
                  emptyText: '（空）',
                }),
              ])
            })))
        }
        if (status) body.push(h('div', { key: 's', style: Object.assign({}, MUTED, { fontSize: 12, marginTop: 6 }) }, status))
      }

      return h('div', { style: { marginTop: 10, borderTop: '1px solid ' + HAIR, paddingTop: 8 } },
        [head].concat(body))
    }

    /* ── 注册 ── */

    function apply(ctx) {
      // 2026-09-10 改版：入口从「侧边栏 tab + 设置分区」收敛为**模型设置页里的卡片扩展区**。
      // 依据上游契约 settings.models.provider-card（keyed，key = 适配器家族 settings namespace，
      // 见 dsh-client-ui-settings-models 的 slot-contract）：注册一次即可拿到该家族每张提供方卡片。
      // 这样"拖动调顺序"就发生在用户本来就在看的模型页里，而不是另开一个页面。
      const slots = ctx.slots || (typeof ctx.get === 'function' ? ctx.get('slots') : null)
      if (!slots || typeof slots.inject !== 'function' || typeof slots.register !== 'function') {
        console.warn('[dsh-model-priority] 没拿到 slots 服务，模型顺序面板不挂载（/dsh-model-priority/provider-models 等路由仍然可用）')
        return function () {}
      }

      // 每个「适配器家族」注册一次：pi-ai 家族（我们自定义的提供方）与内置的 deepseek 家族。
      // 席位是按 settingsNs 分键的，所以想覆盖 DeepSeek 卡片就得用它的 namespace 再注册一次。
      const disposers = []
      for (const key of SEAT_KEYS) {
        try {
          const disposeInject = slots.inject('settings.models.provider-card', (function (k) {
            return function () {
              let unregister = null
              try {
                unregister = slots.register({
                  name: 'settings.models.provider-card',
                  key: k,
                  inject: function () { return { hostCtx: ctx } },
                }, CardOrderPanel)
                return function () { if (typeof unregister === 'function') unregister() }
              } catch (err) {
                console.warn('[dsh-model-priority] provider-card 席位注册失败（key=' + k + '）: ' + String((err && err.message) || err))
                return function () {}
              }
            }
          })(key))
          if (typeof disposeInject === 'function') disposers.push(disposeInject)
        } catch (err) {
          console.warn('[dsh-model-priority] slots.inject 失败（key=' + key + '）: ' + String((err && err.message) || err))
        }
      }
      return function () {
        for (const d of disposers) { try { if (typeof d === 'function') d() } catch (err) {} }
      }
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
