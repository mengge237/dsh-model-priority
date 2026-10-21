# 更新日志

## 0.5.0 — 2026-10-22

- 顺序默认改**读侧**：POST /settings-order 只写 ~/.dsh/model-order.json 并装 ctx.llm 钩子，**不再改写 settings 真源**（config: { writeBack: true } 才切回旧行为）。
- 新增 GET/PUT /dsh-model-priority/ui-order.json 与 ~/.dsh/ui-order.json：原生列表顺序只存数据，浏览器侧按它重排 DOM；首批适配**设置左导航**（可拖拽，稳定 key = 标签文本），其它列表按同一描述符扩展。
- 新增 	est/ui-order.test.mjs（8 项：稳定排序、清洗、落盘往返）。


## 0.4.1 — 2026-10-16

- 读侧只读 route 时自动让位，不再与同格的模型能力面板抢 `settings.models.provider-card`。

## 0.4.0 — 2026-10-15（第二轮定型）

- 侧边栏「模型排序」页成为 `llm-pi-ai` 家族的主入口（`dsh-better-sidebar` 的 `registerTab`）；卡片格只留内置 DeepSeek 家族。
- 0.3.0 曾把 pi-ai 入口放在模型页底部 footer 区，实测没人滚到那儿、等于没有，第二轮改侧边栏页。

## 0.3.0 — 2026-10-15

- 让出 `settings.models.provider-card` 的 `llm-pi-ai` 席位（web-all 0.4.6 的「模型能力」面板要这一格，keyed 槽一格一主），排序入口改挂 `settings.models.footer`。

## 0.2.6 — 2026-10-15

- 修抢格：`SEAT_KEYS` 只剩 `['llm-deepseek']`，pi-ai 家族不再占卡片格。

## 0.2.2

- 修读侧失败态：`provider-models` 被拒或回 `ok:false` 时标题落回「读取失败」（此前会永远停在「读取中…」，因为错误正文只在展开后渲染）。

## 0.2.0

- 新增浏览器侧入口 `exports["./client"]` + `dsh.client.platform: "web"`（走宿主 boot 图，不再靠 tapIndex 注入）。

## 0.1.7 线

- 配置真源从 `~/.dsh/settings.yaml` 迁到 profile 用户层 `~/.dsh/profiles/<p>/cordis.patch.yml`；两代形状都认。

## 0.1.x

- `~/.dsh/model-order.json` 是这一代的顺序文件；09-10 读钩子停用后仅剩状态展示兼容。
- 初版：在 `ctx.llm` 实例属性上包一层，让 `listProviders` / `listConfigurableProviders` / `listModels` 按自定义顺序返回。
