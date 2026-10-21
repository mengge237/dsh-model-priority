// dsh-model-priority — client half: drag a model row, save one insertBefore move.
window.__ModuleLoader__.load({
  id: 'dsh-model-priority',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const react = require('react')
    const h = react.createElement

    const inject = ['slots', 'betterSidebar']
    const FAMILY_NS = 'llm-pi-ai'   // 自定义提供方所属家族的 settings namespace（旧卡片形态的默认 ns / 侧边栏页取数兜底 ns）
    // 2026-10-15 让格：llm-pi-ai 的卡片格让给 web-all 0.4.6 的「模型能力」面板（keyed 槽一格一主，
    // 并列报错就是那天「模型能力面板未挂载」的真因）。DeepSeek 卡片格维持不变（它没被占）。
    // 2026-10-16 第三轮：pi-ai 家族的排序入口从侧边栏页挪到模型页 footer（list 槽，见 apply 内 FOOTER_ID）。
    const SEAT_KEYS = ['llm-deepseek']   // 仍走卡片格的适配器家族：内置 DeepSeek
    const FOOTER_ID = 'dsh-model-priority:order'
    const STATE_ROUTE = '/dsh-model-priority/state.json'

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

    const sectionTitle = { fontSize: 12, fontWeight: 600, opacity: 0.8, margin: '0 0 6px' }

    /* ── 可拖拽列表 ── */

    function SortableList(props) {
      const items = props.items || []
      const dragFrom = react.useRef(null)
      const [overIndex, setOverIndex] = react.useState(null)
      const [draggingIndex, setDraggingIndex] = react.useState(null)

      function handleDragStart(i, e) {
        if (items[i] && items[i].pinned) { dragFrom.current = null; return }
        dragFrom.current = i
        setDraggingIndex(i)
        try {
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', String(i))
        } catch (err) {}
      }

      function handleDragOver(i, e) {
        if (items[i] && items[i].pinned) return
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
        if (items[i] && items[i].pinned) return
        const next = items.slice()
        const moved = next.splice(from, 1)[0]
        next.splice(i, 0, moved)
        // 固定行（★ 默认模型）钉回原下标，其余按新序填坑；服务端写入时同样会钉一次
        const pins = []
        items.forEach(function (x, k) { if (x && x.pinned) pins.push({ item: x, at: k }) })
        if (pins.length) {
          const free = next.filter(function (x) { return !(x && x.pinned) })
          for (const p of pins) free.splice(Math.min(p.at, free.length), 0, p.item)
          props.onReorder(free)
          return
        }
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
        draggable: !item.pinned,
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
        item.pinned
          ? h('span', { style: Object.assign({}, handleStyle, { cursor: 'default', opacity: 0.9 }), title: '默认模型：固定在原位，不参与拖动' }, '★')
          : h('span', { style: handleStyle, title: '按住拖动排序' }, h(GripIcon)),
        h('span', {
          style: { flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 },
          title: item.label || item.name || item.id,
        }, item.label || item.name || item.id),
      )))
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
      const [state, setState] = react.useState({ ids: null, tiers: {}, quota: {}, declared: false, note: '', failed: false, defaultId: null })
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
            setState({ ids: d.ids || [], tiers: tm, quota: d.quota || {}, declared: d.declared === true, note: d.note || '', failed: false, defaultId: d.defaultId || null })
            // 2026-10-16：把「本提供方是否在配置真源里」回报给外层。侧栏页据此躲开只读提供方——
            // 默认落在内置 DeepSeek Account 时整页只显示「只读」，看着就像"排序没了"。
            if (typeof props.onDeclared === 'function') { try { props.onDeclared(route, d.declared === true) } catch (e) {} }
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
            if (d.via === 'settings') {
              setStatus(prefix + '已通过 settings 服务保存（带版本校验）')
              return null
            }
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

      // Drag = one insertBefore move (same shape as upstream workspace reorder).
      function reorderWithin(family, nextGroupItems) {
        const ids = (state.ids || []).slice()
        const oldGroup = ids.filter((id) => familyOf(id) === family)
        const nextGroupIds = nextGroupItems.map((x) => x.id)
        const nextIds = ids.slice()
        let k = 0
        ids.forEach((id, i) => {
          if (familyOf(id) === family) { nextIds[i] = nextGroupIds[k]; k += 1 }
        })
        const moved = findMoved(oldGroup, nextGroupIds)
        if (!moved) { applyOrder(nextIds); return }
        const at = nextIds.indexOf(moved.id)
        const beforeId = at >= 0 ? (nextIds[at + 1] || null) : null
        setBusy(true); setStatus('')
        fetch('/dsh-model-priority/order/move', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ list: 'models', route: route, id: moved.id, beforeId: beforeId }),
        })
          .then((r) => r.json())
          .then((d) => {
            if (d && d.ok) {
              setState((prev) => Object.assign({}, prev, { ids: d.ids || nextIds }))
              setStatus('已保存（' + (d.via === 'settings' ? 'settings 服务' : d.via || 'ok') + '）')
            } else setStatus('保存失败：' + ((d && d.error) || '未知错误'))
          })
          .catch((e) => setStatus('保存失败：' + String((e && e.message) || e)))
          .finally(() => setBusy(false))
      }

      function findMoved(prev, next) {
        let i = 0
        while (i < prev.length && i < next.length && prev[i] === next[i]) i += 1
        let j = 0
        while (j < prev.length - i && j < next.length - i &&
               prev[prev.length - 1 - j] === next[next.length - 1 - j]) j += 1
        const id = next[i]
        if (!id) return null
        return { id: id }
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
                    const isDef = state.defaultId && id === state.defaultId
                    return { id: id, pinned: !!isDef, label: (isDef ? '★ ' : '') + id + '  · T' + (state.tiers[id] || '?') + ' · ' + q }
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

    /* ── 「模型排序」页主体（现挂侧边栏页；曾为卡片格/页底区）─────────────────
     * 席位演进：卡片格(0.2.x) → 页底 footer(0.3.0，实测不可见=没有) → 侧边栏页(0.4.0，registerTab)。
     * 写入路径与卡片版**完全同一机制**：下拉选提供方 → 复用 CardOrderPanel
     * （provider-models 读 + settings-order 物理重排真源 + 默认模型钉位 + 双 profile 镜像）。
     * 绝不再走旧 View() 的 model-order.json —— 那条读时钩子 09-10 已废弃，保存了也不生效。
     */
    function FooterOrderPanel(props) {
      const hostCtx = props && props.hostCtx
      const [route, setRoute] = react.useState('')
      const [providers, setProviders] = react.useState([])
      const [err, setErr] = react.useState('')
      const advisedRef = react.useRef({})

      // 只读提供方（宿主内置的 DeepSeek 家族不在本机配置真源里）自动让位：
      // 每个 route 只试一次，全试完就停在原地，不会来回弹。
      const onDeclared = react.useCallback(function (r, declared) {
        if (declared || !r) return
        if (advisedRef.current[r]) return
        advisedRef.current[r] = true
        const idx = providers.findIndex(function (p) { return p.id === r })
        if (idx < 0) return
        const rest = providers.slice(idx + 1).concat(providers.slice(0, idx))
        const cand = rest.find(function (p) { return !advisedRef.current[p.id] })
        if (cand) setRoute(cand.id)
      }, [providers])

      react.useEffect(function () {
        let alive = true
        fetch(STATE_ROUTE, { headers: { Accept: 'application/json' } })
          .then(function (r) { return r.json() })
          .then(function (d) {
            if (!alive) return
            if (!d || d.ok !== true) { setErr('state.json 读取失败：' + ((d && d.error) || '未知错误')); return }
            const ps = (d.providers || []).filter(function (p) { return p && p.id })
            setProviders(ps)
            setRoute(function (cur) {
              if (cur && ps.some(function (p) { return p.id === cur })) return cur
              const dm = d.defaultModel
              if (dm && dm.provider && ps.some(function (p) { return p.id === dm.provider })) return dm.provider
              return ps.length ? ps[0].id : ''
            })
          })
          .catch(function (e) { if (alive) setErr(String((e && e.message) || e)) })
        return function () { alive = false }
      }, [])

      const selStyle = { height: 26, padding: '0 6px', borderRadius: 6, border: '1px solid ' + HAIR,
                         background: 'transparent', color: 'inherit', fontSize: 12, maxWidth: 260 }
      const head = h('div', { key: 'h', style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } }, [
        h('span', { key: 't', style: sectionTitle }, '模型排序（自定义提供方）'),
        h('select', { key: 's', style: selStyle, value: route,
                      onChange: function (ev) { setRoute(ev.target.value) },
                      title: '选一个提供方，下方卡片式拖拽即写回真源' },
          providers.map(function (p) { return h('option', { key: p.id, value: p.id }, p.label || p.id) })),
      ])
      const body = err
        ? h('div', { key: 'e', style: Object.assign({}, MUTED, { fontSize: 12, marginTop: 6 }) }, err)
        : (route
          ? h(CardOrderPanel, { key: route, provider: { provider: route, settingsNs: FAMILY_NS }, hostCtx: hostCtx, onDeclared: onDeclared })
          : h('div', { key: 'n', style: Object.assign({}, MUTED, { fontSize: 12, marginTop: 6 }) }, '没有可排序的提供方（宿主未报出提供方列表）'))
      return h('div', {
        'data-dsh-plugin': 'dsh-model-priority',
        'data-dsh-part': 'order-console',
        style: { marginTop: 12, border: '1px solid ' + HAIR, borderRadius: 8, padding: '4px 10px 10px' },
      }, [head, body])
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

      const disposers = []

      // 每个「适配器家族」注册一次：pi-ai 家族（我们自定义的提供方）与内置的 deepseek 家族。
      // 席位是按 settingsNs 分键的，所以想覆盖 DeepSeek 卡片就得用它的 namespace 再注册一次。
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

      // 2026-10-16 第三轮：pi-ai 家族的排序入口挂模型页 footer（settings.models.footer，list 槽）。
      // list 槽按 id 分格 ⇒ 与 web-all「模型能力」的 footer 辅助区（id=ui-model-capabilities）并列共存，
      // 既不抢 pi-ai 那张 keyed 卡片格，也不再占用侧边栏（本人 10-16 明确侧栏不要这个功能）。
      // 拿不到该槽或注册被拒就只 warn 跳过：DeepSeek 卡片格与 /dsh-model-priority/* 路由不受影响。
      try {
        const disposeFooter = slots.inject('settings.models.footer', function () {
          let unregister = null
          try {
            unregister = slots.register({
              name: 'settings.models.footer',
              id: FOOTER_ID,
              order: 40,
              inject: function () { return { hostCtx: ctx } },
            }, FooterOrderPanel)
            return function () { if (typeof unregister === 'function') unregister() }
          } catch (err) {
            console.warn('[dsh-model-priority] footer 席位注册失败: ' + String((err && err.message) || err))
            return function () {}
          }
        })
        if (typeof disposeFooter === 'function') disposers.push(disposeFooter)
      } catch (err) {
        console.warn('[dsh-model-priority] slots.inject(settings.models.footer) 失败: ' + String((err && err.message) || err))
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