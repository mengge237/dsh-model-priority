# 更新日志

## 0.7.0 — 2026-10-22

- 排序改成与上游工作区一致的 **insertBefore** 语义：客户端一次拖动只发 `POST /order/move {list, route, id, beforeId}`，服务端在列表适配器上执行 `insertBefore` 再写 settings；整份数组的 `/settings-order` 仍保留给预设排序。
- 新增 `lib/lists.js` 列表适配器注册表：`registerList({ id, read, write })`，模型顺序是内置的第一条（`models`）；后续列表按同一接口接入，不动路由与前端。
- 新增 `lib/order.js`（`insertBefore` + `OrderMoveInvalidError`）与 `test/order.test.mjs`；路由测试扩到 9 条。
- 文案/描述只讲模型顺序；provider 列表与设置左导航排序不在契约内。


## 0.6.1 — 2026-10-22

- **写入口收紧为契约单路径**：`POST /settings-order` 只走官方 `ctx.settings.describe()` + `mutate(ns, ops, revision)`；`ctx.settings` 缺席或 `llm-pi-ai` 命名空间不存在时回 **503**，不再回退到文本级重排（文本回退会绕开宿主的 revision 校验，且会自造备份/跨 profile 镜像）。
- 删掉只验证文本重排引擎的 `settings-source.test.mjs`；`providerOrder` 仅为旧订单文件兼容保留，**不再生效**（插件只排「某提供方内部的模型顺序」，没有 provider 列表排序的官方口）。
- 真机对照（探针 profile，真实 dsh 0.2.0-rc.2）：旧 0.4.2 → `settings-order` 自己写 `cordis.patch.yml` 并生成 `.bak-<ISO>`、还镜像到别的 profile；0.6.x → 返回 `via:"settings"`，文件由宿主 settings 服务改写，无 `.bak`，`state.json` 的 `models.demo` 顺序随之变成 `gamma,alpha,beta`。


## 0.6.0 — 2026-10-22

- **按宿主契约重写写入路径**：排序保存改走官方 `ctx.settings.describe()` + `ctx.settings.mutate(ns, ops, revision)`，由宿主负责落盘与版本冲突（`SETTINGS_CONFLICT` → 提示刷新重试）。不再重写 `cordis.patch.yml` / `settings.yaml` 的文本块，也不再自建备份与跨 profile 镜像。
- **去掉 0.5.0 的两条非契约做法**：不再替换 `ctx.llm` 实例方法（排序靠 settings 真源里 `models` 数组的顺序，pi-ai 适配器的 `listModels` 直接读它），也不再做「原生列表 DOM 重排 / ui-order.json」。设置左导航的排序不在宿主契约里（slot 只在注册时接受 `order`），本插件不提供，需上游加口。
- 老宿主兼容：`ctx.settings` 缺席或命名空间不存在时，仍回退到原来的文本级重排路径。


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
