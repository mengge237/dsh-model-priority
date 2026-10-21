# dsh-model-priority

模型顺序 + 原生列表排序。

- **模型顺序**：设置页「模型顺序」分区里拖动某个提供方内部的模型；写入走官方 settings（`describe` + `mutate` + revision），一次拖动 = 一个 `insertBefore` move。
- **设置左导航**：设置里的左侧列表可直接拖拽排序，顺序存 `~/.dsh/ui-order.json`，刷新后保持。

## 契约

- 模型顺序只改 settings 里 `providers.<route>.models` 的顺序；没有 `ctx.settings` 时返回 503，不写文件。
- 左导航顺序是纯展示数据，走插件自己的 `GET/PUT /dsh-model-priority/ui-order.json`，不碰宿主配置。
- 设置分区用原生 `settings.section`（id `model-priority`，order 55），样式由宿主给。

## 扩展

`lib/lists.js`：`registerList({ id, read, write })`。新增可排序列表 = 注册适配器，move 路由与前端拖动复用。

## 测试

`npm test`（不启动宿主）。
