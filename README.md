# dsh-model-priority

模型顺序 + 原生列表排序。

- **模型顺序**：拖动某个提供方内部的模型；写入走官方 settings（`describe` + `mutate` + revision），一次拖动 = 一个 `insertBefore` move。
- **入口是兼容的**：`settings.models.provider-card` 的 `llm-pi-ai` 格空闲时直接挂卡片格（和 DeepSeek 卡片同一位置、同款样式）；被别的插件（如 web-all「模型能力」）占住时才退回原生设置分区「模型顺序」。
- **设置左导航**：可拖拽排序，顺序存 `~/.dsh/ui-order.json`（`GET/PUT /dsh-model-priority/ui-order.json`），刷新后保持。

## 契约

- 模型顺序只改 settings 里 `providers.<route>.models` 的顺序；没有 `ctx.settings` 时返回 503，不写文件。
- 左导航顺序是纯展示数据，不碰宿主配置；key 是导航行标签文本。
- 设置分区用原生 `settings.section`（id `model-priority`，order 55）。

## 扩展

`lib/lists.js`：`registerList({ id, read, write })`。新增可排序列表 = 注册适配器，move 路由与前端拖动复用。

## 测试

`npm test`（不启动宿主）。
