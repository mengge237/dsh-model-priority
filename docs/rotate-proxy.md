# 附带的轮换代理（默认关闭）

把某个 provider 的 `baseURL` 指到本插件的 `rotate` 端点，它会在 `.credentials.yaml` 里的多把 key 之间依次试，**只对 429 / 额度尽那类响应**换 key。

- **默认不开，也没有页面入口**，只能用 HTTP 接口逐个 route 启用。
- 路径里带一个 32 字节随机 token（存在 `~/.dsh/model-priority-proxy.json`）；不知道 token 一律 403。
  插件路由不走浏览器鉴权，不设这道门等于本机任何进程都能拿你的密钥刷额度。
- 想要成熟换 key / 故障转移的，先跟 `dsh-model-router` 一类插件比过再决定用哪个。
- 状态口 `GET /dsh-model-priority/proxy-status` 只报密钥**数量**、冷却与配置文件位置，不回显 token（要手工配 baseURL 就自己看那个 json）。
