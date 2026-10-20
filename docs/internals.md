# 实现细节（README 放不下的部分）

## 为什么是"替换实例属性"

宿主的远端分发拿的是 `Reflect.get(活实例, 'listProviders')`（`dsh-api-gateway` 的 `prepareInvocation`），own property 优先。所以在 `ctx.llm` 实例属性上包一层，**一处改动同时覆盖直调方与远端两条路**。模型选择对话框走的 `session/modelCatalog` 链内部同步调 `ctx.llm.listProviders()`、异步调 `ctx.llm.listModels()`，都在这条路上。

## 三条必须守住的契约

写错了是直接报错，不是静默降级：

1. `listProviders` / `listConfigurableProviders` 的替换**必须是同步函数** —— 宿主 `buildModelCatalog` 同步调用它，返回 Promise 会在紧接着的 `providers.map(...)` 上炸掉，模型选择对话框直接打不开。
2. **形参个数跟原方法一致**（远端按签名校验）：`listProviders()` 收 0 个，`listModels(provider)` 收 1 个。
3. **只重排，条目本身一个字段都不动**。

## 两代配置真源

- 0.1.5 线：`~/.dsh/settings.yaml`
- 0.1.7 线起：profile 用户层 `~/.dsh/profiles/<p>/cordis.patch.yml`

两代形状都认，且读到的提供方与模型顺序在两边完全一致（`test/settings-source.test.mjs` 盯着）。写回只动 `models` 块，块外逐行不变，找不到提供方就一个字节不落。

## 自检都验了什么

五个脚本，合计 54 项，都不启动 dsh、不碰 3080 端口：

- `test/selftest.mjs` —— 数据层：顺序文件的读写与清洗、稳定排序边界（名单里有不存在的 id、缺 id、空名单、原数组不被就地改动）。
- `test/server-routes.mjs` —— 服务端半边端到端：拿假 ctx（假 `webServer` + 假 `llm`）把八条路由真跑一遍，验状态码、排序真的作用到三个 `list*` 方法、坏 body 回 400、不支持的方法回 405、**同步契约**、重复 apply 不套第二层挂钩，以及信任栅栏五条（跨站 403、DNS 重绑定 403、宿主登记的权威放行、响应不带跨域头、`proxy-status` 不含 token）。
- `test/client-smoke.mjs` —— 浏览器侧半边：用假 `window.__ModuleLoader__` 与假 react 跑一遍 bundle，验模块 id、只 require react、注册的描述符字段、icon 是内联 svg。
- `test/settings-source.test.mjs`（5 项）—— 配置真源两代形状解析一致、写回范围。
- `test/client-failure-state.test.mjs`（3 项）—— 读侧失败态：`provider-models` 被拒或回 `ok:false` 时，卡片标题必须落回「读取失败」（0.2.2 之前会永远停在「读取中…」）。
