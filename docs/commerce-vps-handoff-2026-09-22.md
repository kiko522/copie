# 外卖、银行卡与角色自主点单：Windows 接续说明

更新时间：2026-09-22
目标分支：`master`

这份说明用于从 macOS 切换到 Windows 后继续开发。它记录的是本次代码的真实状态，不代表 VPS 已部署，也不包含任何密钥。

## 一、这版已经完成什么

### 1. 本地银行卡与账本

- 新增银行卡数据模型和本地卡包，用户与角色的卡按 `ownerId` 隔离。
- 卡片支持 8 套原创视觉主题、余额、卡面翻转和默认卡。
- 支出、收入、退款统一进入同一套流水；金额统一保留两位小数。
- 旧流水迁移到新结构：旧正数按用户支出处理，旧负数按退款收入处理。
- 角色卡和角色流水可以查看，但不会混入用户支出统计。
- 备份与恢复已经包含银行卡、外卖订单和收货地址。

### 2. 外卖 App 第一版

- 桌面新增独立“外卖”入口。
- 使用稳定的本地店铺和商品目录，覆盖：美食外卖、奶茶饮品、甜品蛋糕、超市便利、生鲜果蔬、医药健康、鲜花绿植。
- 商品图为本地 SVG，没有“模拟菜单”之类破坏代入感的标签。
- 已有搜索、分类、店铺页、购物车、起送价、配送费、结账、订单列表、订单详情、退款。
- 配送状态由订单时间计算，不依赖后台任务：下单后 8 分钟接单、32 分钟进入配送、约 40 分钟送达。
- 订单列表按店铺只展示最新一单，但历史订单仍完整保留。
- 结账在同一个 IndexedDB 事务内完成订单、扣卡和账本流水，失败会整体回滚。
- 可以选择“给自己”或“给角色”点；角色没有地址时不可选。
- 当前从外卖 App 直接下单时，付款人仍是用户；“查手机”里的角色身份付款尚未接入。

### 3. 已完成的检查

- 7 个相关测试文件、共 60 项测试通过。
- `pnpm run build` 通过。
- 已在本地浏览器走过桌面入口、店铺、商品、购物车、结账拦截和创建银行卡的基本流程。
- 全量 TypeScript 检查仍有仓库原本就存在的其他模块报错；本次改动涉及的文件没有新增已知类型报错。
- 全量测试不是全绿：Cloudflare Worker 本地环境和几项既有聊天测试仍有与本次无关的失败，因此不要写成“全仓测试全部通过”。

## 二、这版明确还没做什么

- 购物 App 尚未开始。
- 没有接入 OpenStreetMap 或 OpenFoodFacts；当前单人、低频使用场景优先采用稳定的本地目录，也没有把商品数量固定为 670。
- “查手机”入口下的角色身份点单尚未完成。
- 角色通过 LLM 自主点外卖尚未实现。
- 外卖通知里的 HTML 深链尚未实现。
- 外卖记录尚未注入角色的生活轨迹。
- 本轮没有修改、重建、重启或部署 VPS，也没有更新主动消息 Worker。

## 三、下一阶段的产品规则（已经和用户确认）

目标是让角色在合适的情况下，自主为用户下虚拟外卖订单，并通过现有主动消息链送达；不发生现实支付。

### 1. 角色之间必须完全独立

- 不设全局订单上限，不让不同角色互相占额度，也不向角色暴露其他角色的订单。
- 每个角色单独计算：滚动 24 小时最多 2 单，同一角色两单之间至少间隔 6 小时。
- 上限只是防止失控，不是每日任务；角色可以一天一单都不点。
- 可给每个角色一个频率倾向：很少、普通、较常。它只影响概率，不保证次数。

### 2. 不把吃饭做成机械打卡

- 不要求用户每天必须吃早饭、午饭或晚饭，也不因为用户跳过某顿就催促。
- 时间只作为弱提示，不是触发命令。
- 针对当前用户习惯：早餐权重较低；午餐和晚餐普通；下午饮品较高；夜宵可以高于早餐。
- 用户提到“想喝/想吃某样东西”是强信号，建议有效约 90 分钟，而且同一条愿望最多考虑一次。
- “随口说”“不用点”“刚吃过”等表达应取消或压低触发。

### 3. 和角色生活轨迹一起判断

- 主依据使用主动消息 2.0 已经同步的角色当日日程、当前活动、下一活动和角色内心状态。
- 手册里的角色生活流可以作为气氛参考，但它是回顾性生成内容，不能作为硬条件。
- `LifeSim` 是独立小游戏，不应直接控制角色点单。
- 成功点单后，可以把这件事作为一条轻量生活事件反映给该角色；不要为了外卖覆盖整段日程。

### 4. 三层决策

1. 硬条件：该角色已允许自主点单、确实知道用户的这个地址、有可付款的角色银行卡、没有超过该角色自己的频率与冷却、商品仍有效。
2. 上下文：角色当前活动和日程、用户最近表达的需求、当前时间、该角色近期订单。
3. 人设判断：让 LLM 判断这个角色此刻是否真的会做这件事，而不是固定概率抽奖。

每个角色建议增加这些设置：

- 自主点外卖：关闭 / 只建议 / 可直接下单。
- 已知地址列表：由用户明确勾选“TA 知道这个地址”，不能仅凭恋爱关系自动推断。
- 用于付款的角色银行卡。
- 频率倾向：很少 / 普通 / 较常。

角色为用户下单时，订单语义应为：付款人是该角色，收货人是用户。

## 四、建议的实现边界

### 1. 云端只产生受控意图，本地执行真实落库

沿用主动消息 2.0 现有的副作用指令模式：

1. Worker 经过硬条件预筛和 LLM 判断后，生成结构化的 `delivery_order_intent`。
2. 推送元数据把指令带回客户端。
3. 客户端再次验证角色、地址、银行卡、余额、冷却和商品，然后调用现有的原子结账方法。
4. 订单、扣款和账本只在客户端验证成功后落库。

主要接点：

- `worker/amsg/src/classifier.ts`：识别并输出新的结构化指令。
- 主动消息推送元数据与补收链：携带指令和稳定的幂等 ID。
- `utils/activeMsgRuntime.ts` 及助手回复后处理：接收、校验、重放指令。
- `utils/db.ts` 的 `checkoutCommerceOrder`：继续作为唯一实际结账入口。

不要让 Worker 在客户端校验成功前就写出“已经下单”的确定文案。建议使用两阶段结果：先发待执行意图；本地成功后再生成确定的订单卡片或固定成功消息。校验失败时不得留下虚假订单宣称。

### 2. 离线与防重复

- 设备离线时，云端可以保留意图；客户端上线补收后再写入本地订单和账本。
- 每个意图必须有稳定 ID，本地重放必须幂等，避免重复扣款。
- 为防设备离线期间同一角色连续生成多个意图，云端需要保存该角色自己的最近意图时间和滚动计数；仍然不能做跨角色全局计数。
- 同步到云端的地址信息应尽量小：只传地址 ID、是否默认、角色是否获知等判断字段。除非后续明确需要并获得授权，不上传完整地址文本。

### 3. HTML 只负责展示和安全跳转

当前消息 HTML 沙箱不允许任意脚本、表单和弹窗，因此不能让一段原始 HTML 直接扣款。可以增加一个很窄的白名单桥接，例如 `data-sully-action="open-delivery"`，由宿主验证动作和值后打开外卖 App 或订单详情。不要为了这个功能开放任意 JavaScript。

## 五、Windows 接续命令

### 1. Windows 上已有仓库

在 PowerShell 中进入仓库后执行：

```powershell
git status --short
git branch --show-current
git remote -v
git pull --ff-only origin master
corepack enable
pnpm install --frozen-lockfile
pnpm exec vitest run utils/deliveryCatalog.test.ts utils/commerce.test.ts utils/db.commerce.test.ts utils/bankLedger.test.ts utils/db.bankLedger.test.ts utils/lifeRecords.test.ts utils/format.test.ts
pnpm run build
```

如果 `git status --short` 有本地改动，先停下来检查，不要直接覆盖。

### 2. Windows 上还没有仓库

```powershell
git clone https://github.com/kiko522/copie.git
cd copie
git checkout master
corepack enable
pnpm install --frozen-lockfile
pnpm exec vitest run utils/deliveryCatalog.test.ts utils/commerce.test.ts utils/db.commerce.test.ts utils/bankLedger.test.ts utils/db.bankLedger.test.ts utils/lifeRecords.test.ts utils/format.test.ts
pnpm run build
```

### 3. 给 Windows 上的新 Codex 的首条说明

可以把下面这段直接发给新任务：

> 请继续维护 `kiko522/copie` 的 `master`。先完整阅读根目录 `AGENTS.md`、README 的“给想二改的人”和 `docs/commerce-vps-handoff-2026-09-22.md`，再检查最近提交与工作树，不要按摘要猜代码。下一步先做设计和代码定位：把角色自主点外卖接入主动消息 2.0，但不同角色的额度、冷却和数据必须完全隔离；每角色滚动 24 小时最多 2 单、至少间隔 6 小时，这只是上限不是每日任务；不要机械催早餐午餐晚餐；综合角色日程、当前活动、用户近 90 分钟愿望和角色人设。云端只产生结构化意图，本地二次校验并调用现有原子结账，必须幂等，不能在成功前宣称已下单。先不要部署或重启 VPS，也不要要求或输出任何密钥。

## 六、回到 VPS 后先做的只读检查

这些命令不改服务状态：

```bash
cd /opt/sully
git status --short
git branch --show-current
git remote -v
git log --oneline --decorate -10
git diff -- deploy/companion worker/amsg server/companion
cd /opt/sully/deploy/companion
docker compose config --services
docker compose ps
docker compose logs --tail=100 backend
```

预期 Compose 至少包含 `backend`、`trendradar`、`trendradar-mcp`、`caddy`、`cloudflared`。如果工作树有改动、分支不是预期分支，或日志中有现有故障，应先记录和处理，不要直接拉取或重建。

## 七、后续真正部署时的原则

- 先在 Windows 完成代码、测试、提交和 GitHub 推送。
- 再到 VPS 执行 `git pull --ff-only origin master`；如果不能快进，停下来检查，不做强制覆盖。
- 只改陪伴后端时，优先只重建并更新 `backend`，不要无理由重启整套 Compose。
- 主动消息 2.0 Worker 是 Cloudflare Worker，和 `/opt/sully/deploy/companion` 不是同一个部署目标；必须分别验证。
- 任何实际 VPS 更新、容器重建、Worker 发布或线上验证，都应在当次得到明确授权后再执行。

## 八、本次提交涉及的核心文件

- 外卖界面：`apps/DeliveryApp.tsx`
- 商品 SVG：`components/delivery/DeliveryProductArt.tsx`
- 本地目录：`utils/deliveryCatalog.ts`
- 订单规则：`utils/commerce.ts`
- 银行卡：`components/bank/BankCardWallet.tsx`、`utils/bankCardStyles.ts`
- 流水规则：`utils/bankLedger.ts`
- 数据结构与原子事务：`types.ts`、`utils/db.ts`
- 桌面入口：`constants.tsx`、`components/PhoneShell.tsx`
