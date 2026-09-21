# 个人 VPS 陪伴后端

这套后端部署在你自己的域名上，目标是承载角色后台生活、受控心跳和外部世界能力。
当前已落能力中枢、角色状态、经历日志、TrendRadar 读取、自适应心跳、消息 outbox，
以及浏览器侧角色快照同步和聊天数据库接入。

## 已实现

- `GET /healthz`：无需鉴权的存活检查，不返回密钥或用户数据。
- `GET /v1/capabilities`：列出当前可用能力。
- `GET /v1/weather?city=北京`：itboy 主源，Open-Meteo 自动备用。
- `POST /v1/tools/search`：受限 Tavily 搜索，不开放 crawl/map。
- `PUT /v1/characters/:id`：上传角色快照；只保留角色设定、兴趣与最近 30 条消息。
- `POST /v1/characters/:id/user-replied`：用户回复后将连续主动消息计数归零。
- `GET /v1/characters/:id/experiences`：读取追加式经历，不覆盖历史。
- `POST /v1/heartbeat/:id`：手动触发一次心跳，便于验收。
- `GET /v1/outbox` 与 `POST /v1/outbox/:id/ack`：可靠拉取、确认主动消息。
- 除健康检查外均要求 `Authorization: Bearer <BACKEND_TOKEN>`。
- 浏览器来源严格使用 `ALLOWED_ORIGINS` 白名单。
- 网页启动和每 6 小时同步全部角色的最小快照；用户发言后立即同步该角色并解除未回复暂停。
- 网页每分钟拉取 outbox，以 `companion:<消息 ID>` 幂等落入现有聊天数据库，落库成功后才确认。

心跳模型一次只选择一个动作；确需查证时才调用 Tavily 并进行第二次决策。`02:00–08:30`
直接延期到免打扰结束，连续三条主动消息无人回复时只记录经历、不再进入 outbox。静默心跳会逐级
退避，最长 6 小时。

## Debian 12 部署

先安装 Docker Engine 和 Compose 插件。不要把真实 `.env` 提交到 Git：

```bash
cd /opt
git clone https://github.com/kiko522/copie.git sully
git clone https://github.com/sansan0/TrendRadar.git TrendRadar
cd /opt/sully/deploy/companion
cp .env.example .env
chmod 600 .env
```

编辑 `.env`，将 `BACKEND_DOMAIN`、`ALLOWED_ORIGINS` 换成自己的后端域名和前端来源，
并填入随机 `BACKEND_TOKEN`、Tavily Key 和心跳模型密钥。然后：

```bash
docker compose build
docker compose up -d
docker compose ps
curl "https://${BACKEND_DOMAIN}:8443/healthz"
```

`LLM_BASE_URL` 使用 OpenAI 兼容地址；当前模板默认使用 DeepSeek：
`https://api.deepseek.com` 与 `deepseek-chat`。`LLM_API_KEY` 和 `TAVILY_API_KEY`
只放 VPS 的 `.env`。

Compose 会启动官方 `wantcat/trendradar` 与 `wantcat/trendradar-mcp` 镜像。前者定时抓取热榜，
后者给陪伴后端提供 `get_latest_news`；3333 只在 Docker 内部网络开放，不暴露到公网。
`TRENDRADAR_DIR` 默认指向 `/opt/TrendRadar`，读取官方仓库的 `config/`，抓取结果保存在独立
Docker 卷中。需要调整平台或关键词时修改 `/opt/TrendRadar/config/`，再执行
`docker compose restart trendradar trendradar-mcp`。更新镜像使用
`docker compose pull trendradar trendradar-mcp && docker compose up -d`。

Cloudflare 中的后端域名在首次签发证书期间保持“仅 DNS”。如果 VPS 的 443 已被其他服务占用，
Caddy 会通过 HTTPS 8443 与它共存，并保留 TCP 80 完成 ACME 证书验证；服务器安全组需要放行
TCP 80/8443。由于容器内外 TLS 端口不同，配置会禁用 HTTP/3，避免向浏览器错误宣告宿主机
的 443；HTTP/1.1 与 HTTP/2 不受影响。访问地址为
`https://<BACKEND_DOMAIN>:8443`。后端 8787 不映射到公网，只能由同一 Compose 网络中的 Caddy
访问，现有 Xray 配置无需改动。

## 本地验证

```bash
cd server/companion
cp .env.example .env
node --env-file=.env src/server.mjs
```

另开终端执行：

```bash
curl http://127.0.0.1:8787/healthz
curl -H "Authorization: Bearer <BACKEND_TOKEN>" \
  "http://127.0.0.1:8787/v1/weather?city=北京"
```

## 当前边界

天气、热搜和搜索只能产生“观察”，不能直接发送消息；最终发送必须经过角色关联判断、事实
查证、02:00–08:30 免打扰，以及连续三条未回复即暂停的规则。网页关闭期间消息会可靠留在
outbox，下次打开即补收；当前尚未把这条 VPS 通道接入系统 Web Push，因此网页完全关闭时不会
立即弹出系统通知。
