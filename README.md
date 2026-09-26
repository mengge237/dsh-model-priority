# dsh-model-priority

自定义模型 / 提供方的排列顺序。宿主的模型选择列表按适配器注册顺序排，常用的模型
常常排在后面；这个插件让你在模型设置页里拖一下，把它顶到前面去。

## 长什么样

**设置 → 模型**页里，你自己配置的提供方卡片下面多一块「模型顺序」区（走上游槽位
`settings.models.provider-card`，不用另开页面，也不需要装 dsh-better-sidebar；席位按适配器家族各注册一次，覆盖 `llm-pi-ai` 与内置 `llm-deepseek` 两个家族）。
默认折叠，展开后是分组后的模型列表，按住行拖动排序：点「保存」写盘，
点「恢复默认」回到宿主原顺序。

## 它怎么生效

- 顺序存在 `~/.dsh/model-order.json`，纯数据，可以手改，删掉就回默认。
- 服务端半边在 `ctx.llm` 的**实例属性**上包一层，让这三个方法按这份顺序返回：
  `listProviders()`、`listConfigurableProviders()`、`listModels(provider)`。
  排序是**稳定排序**：没被点过名的条目保持原来的相对位置，所以只调两个不会搅乱别的。
- 为什么是替换实例属性：宿主的远端分发拿的是 `Reflect.get(活实例, 'listProviders')`
  （`dsh-api-gateway` 的 `prepareInvocation`），own property 优先，所以这一处改动
  同时覆盖直调方与远端两条路。模型选择对话框走的 `session/modelCatalog` 链内部
  同步调 `ctx.llm.listProviders()`、异步调 `ctx.llm.listModels()`，都在这条路上。
- 三个方法各有一处必须守住的契约（写错了是直接报错，不是静默降级）：
  - `listProviders` / `listConfigurableProviders` 的替换**必须是同步函数**。
    宿主 `buildModelCatalog` 同步调用它，返回 Promise 会在紧接着的
    `providers.map(...)` 上炸掉，模型选择对话框直接打不开。
  - 形参个数跟原方法一致（远端按签名校验）：`listProviders()` 收 0 个，
    `listModels(provider)` 收 1 个。
  - 只重排，条目本身一个字段都不动。
- 浏览器侧走本包自己的路由，不碰宿主的 Remote 通道（其余几条见下面「附带的轮换代理」）：
  - `GET /dsh-model-priority/state.json` —— 目录快照 + 当前顺序 + 挂钩状态
  - `GET /dsh-model-priority/provider-models?route=<route>` —— 某路由当前的模型 id 顺序
  - `GET /dsh-model-priority/suggest?route=<route>&mode=capability|cheap|quota` —— 建议顺序
  - `PUT /dsh-model-priority/order.json` —— 保存顺序文件（`{"reset":true}` 清空）
  - `POST /dsh-model-priority/settings-order` —— 按给定顺序重排**当前生效真源**里该提供方的 `models`
    （0.1.5 线是 `~/.dsh/settings.yaml`；0.1.7 线起是 profile 用户层 `~/.dsh/profiles/<p>/cordis.patch.yml`）

这些路由注册在 `ctx.webServer` 上，是**裸路由**：宿主的鉴权只覆盖 `client-connection`
注册的通道与首页。所以本包自己判来源（Host 必须是 loopback 或宿主登记的权威、
`sec-fetch-site` 不是 `cross-site`、有 `Origin` 时主机名要与 Host 一致），
浏览器里任意站点的跨域请求一律 403，响应也不再带 `Access-Control-Allow-Origin`。
本机 shell 里 `curl http://127.0.0.1:3080/dsh-model-priority/state.json` 照常能用。

## 它会动你的哪些文件

| 文件 | 什么时候 | 怎么收拾 |
|---|---|---|
| `~/.dsh/model-order.json` | 每次点「保存」 | 删掉就回默认 |
| `~/.dsh/settings.yaml`（0.1.5 线） | 点「保存」并同步宿主时 | **写之前先备份成 `settings.yaml.bak-<时间戳>`**；只重排对应提供方 `models` 数组的顺序，其它键一个都不动 |
| `~/.dsh/profiles/<p>/cordis.patch.yml`（0.1.7 线起的真源） | 同上 | **写之前先备份成 `cordis.patch.yml.bak-<时间戳>`**；只动对应提供方 `models` 的那几行，块外逐行必须一字不变。落盘前后各做一次校验：条目集合未增删、总行数不变、区域外逐行一致、重读一遍顺序符合要求 —— 任一道不过就整次拒绝、一个字节都不写 |
| `~/.dsh/model-priority-proxy.json` | 只有启用下面那个轮换代理才会创建 | 删掉即停用 |

为什么要写这份配置：宿主是拿 `models` 数组的**顺序**来渲染模型列表的（设置页与选择器都看它）。
只在读的时候排序，会出现「设置页一个顺序、模型选择器另一个顺序」，两套顺序来源必然打架。所以写盘这一边是刻意的 ——
也正因为如此，写之前必须备份。0.1.7 把配置从 `settings.yaml` 搬进了 profile 用户层（老文件只留 `settings.yaml.imported`），
本包两代形状都认：读到的提供方与模型顺序在两边完全一致，这一点有回归测试盯着（`test/settings-source.test.mjs`）。

## 装 / 卸

```
dsh plugin --profile web add "<本仓目录，或 git 地址>"
dsh plugin --profile web remove dsh-model-priority
```

面板挂在**上游**的 `settings.models.provider-card` 席位上（2026-09-10 改版时删掉了早期的
侧边栏 tab），所以不需要装 dsh-better-sidebar：宿主有模型设置页就能用；
拿不到 slots 服务时面板不挂载，那几条 HTTP 路由照常可用。

装完要**重启 dsh web**：服务端半边（注册路由、挂钩）与浏览器侧半边（进 boot 图的 combo）
都是启动时装配的，只有重启才生效。顺序文件是每次调用现读的，改它不用重启。

## 自检

```
npm test
```

五个脚本，合计 54 项，都不启动 dsh、不碰 3080 端口：

- `test/selftest.mjs` —— 数据层：顺序文件的读写与清洗、稳定排序的边界
  （名单里有不存在的 id、缺 id、空名单、原数组不被就地改动）。
- `test/server-routes.mjs` —— 服务端半边端到端：拿假 ctx（假 `webServer` + 假 `llm`）
  把八条路由真跑一遍，验状态码、排序真的作用到 `listProviders` / `listModels` /
  `listConfigurableProviders`、坏 body 回 400、不支持的方法回 405、
  **同步契约**、重复 apply 不套第二层挂钩，以及信任栅栏的那五条
  （跨站 403、DNS 重绑定 403、宿主登记的权威放行、响应不带跨域头、`proxy-status` 不含 token）。
- `test/client-smoke.mjs` —— 浏览器侧半边：用假 `window.__ModuleLoader__` 与假 react
  把 bundle 跑一遍，验模块 id、只 require react、注册的描述符字段、icon 是内联 svg。
- `test/settings-source.test.mjs`（5 项）—— 配置真源：0.1.5 的 `settings.yaml` 与 0.1.7 的 profile 用户层
  `cordis.patch.yml` 两代形状解析结果必须一致；写回只动 `models` 块、块外逐行不变、找不到提供方就一个字节不落。
- `test/client-failure-state.test.mjs`（3 项）—— 读侧失败态：`provider-models` 被拒或回 `ok:false` 时，
  卡片标题必须落回「读取失败」（0.2.2 之前会永远停在「读取中…」，因为错误正文只在展开后才渲染）。

## 边界

- 只在 `ctx.llm` 真的暴露上述方法的宿主版本上生效；挂不上时 `state.json` 的
  `hook.ok` 会是 `false` 并带上原因，页面顶部会把原因显示出来，顺序文件仍然可编辑。
- 可拖拽并写回的是你自己配置的提供方（`llm-pi-ai` 家族）；宿主内置的 DeepSeek 卡片里这块显示为只读，
  那份模型清单不在本机配置真源里，插件不碰。读侧挂住 10s 或报错时标题写「读取失败」，悬停看原因。
- 不改宿主任何一行代码；但会按你的操作重排**当前生效真源**里对应提供方的 `models` 数组（0.1.5 线是 `~/.dsh/settings.yaml`，0.1.7 线起是 `~/.dsh/profiles/<p>/cordis.patch.yml`；写前都自动备份，见上）。卸载后 `model-order.json` 与代理配置留在 `~/.dsh` 下，手动删。
- 靠改配置里 provider 的**键顺序**来排序不可靠：宿主的
  `registrationFacts` 会对 provider 做 sort 来判断"是否变化"，单纯调键序不触发
  replace，运行中不会立刻生效，而且被 replace 的那批路由会被挪到 Map 末尾。
  要固定顺序就用这个插件。
- 某个适配器不支持列举模型时，那个提供方下面是空的，这是适配器的能力边界，
  不是排序没生效。

## 它不管什么

- **只管「列表顺序」**：不做请求路由、不做故障转移、不做用量统计。那三件事各有人在管
  （路由/故障转移看 `dsh-model-router` 一类，用量统计看 `dsh-provider-usage` 一类），
  塞进一个插件里最容易互相打架。
- 上游没有「调整模型顺序」的入口（2026-09-10 提过一条 discussion，至今零回复）。这个插件补的就是那一格。

## 附带的轮换代理（默认关，未上页面）

包内另有一个小的本机转发层：把某个 provider 的 `baseURL` 指到本插件的 `rotate` 端点，
它会在 `.credentials.yaml` 里的多把 key 之间依次试（429 / 额度尽那类响应才换）。

- **默认不开**，也没有页面入口，只能用 HTTP 接口逐个 route 启用；
- 路径里带一个 32 字节随机 token（存在 `~/.dsh/model-priority-proxy.json`），不知道 token 一律 403 ——
  插件路由不走浏览器鉴权，不设这道门等于本机任何进程都能拿你的密钥刷额度；
- 想要的是「成熟的换 key / 故障转移」，建议先跟 `dsh-model-router` 那类插件比过再决定用哪个。
- 状态口 `GET /dsh-model-priority/proxy-status` 只报密钥**数量**、冷却与配置文件位置，
  不回显 token（要手工配 baseURL 就自己看 `~/.dsh/model-priority-proxy.json`）。
