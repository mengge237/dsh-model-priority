# dsh-model-priority

模型顺序（不是提供方排序）。按 settings 里 `providers.<route>.models` 的顺序排列，
设置页与模型选择器读同一份数据。

## 契约

- 写入只走官方 settings 服务：`describe()` 取 revision → `mutate('llm-pi-ai', [{op:'set', path:['providers', route, 'models'], value}], revision)`。
- 没有 `ctx.settings` 或 `llm-pi-ai` 命名空间时返回 503，不写任何文件。
- 一次拖动 = 一个 `insertBefore` move（`POST /dsh-model-priority/order/move {list, route, id, beforeId}`），与上游工作区排序同形。

## 扩展

`lib/lists.js` 是列表适配器注册表：

```js
registerList({ id: 'models', read(ctx, params), write(ctx, params, ids) })
```

新增一类可排序列表 = 注册一个适配器；路由与前端拖动复用同一套 move。

## 不做

- 设置左导航排序、provider 列表排序：宿主没有运行时排序契约（slot 只在注册时收 `order`）。
- `model-order.json` 里的 `providerOrder` 仅为旧文件兼容保留，不生效。

## 测试

`npm test`（不启动宿主）。
