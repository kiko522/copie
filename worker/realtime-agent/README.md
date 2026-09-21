# Sully Windows Realtime Agent

Windows 常驻的 LiveKit 实时语音 Worker。音频链路为：浏览器麦克风 → LiveKit Cloud → Groq STT → DeepSeek → MiniMax 或 ElevenLabs TTS → LiveKit Cloud → 浏览器。

## 安全边界

- `.env.local` 只保存在运行 Worker 的 Windows 电脑，已被仓库根目录的 `*.local` 规则忽略。
- 浏览器会话只允许传递角色设定、TTS 服务商、模型和音色 ID，不允许覆盖任何 API Key。
- Worker 中的 STT、LLM、TTS Key 永远从本机环境变量读取。
- LiveKit API Secret 还会在 VPS 的受保护令牌端点中使用；绝不放进 Vercel 前端。

## 首次配置

1. 在本目录将 `.env.local.example` 复制为 `.env.local`。
2. 填写 LiveKit、Groq、DeepSeek、MiniMax、ElevenLabs 凭据。
3. 在仓库根目录执行 `pnpm install`。
4. 测试运行：`pnpm --filter sully-realtime-agent dev`。
5. 正式常驻：`pnpm --filter sully-realtime-agent start`。

角色级路由由小手机 `voiceProfile.provider` 决定：`minimax` 使用角色 `voiceId`；`elevenlabs` 使用角色 `elevenLabsVoiceId`。未指定的旧角色继承全局设置。

## 来源与许可证

Worker 基于 `fox988r/sully-realtime-addon` 的实验性实现适配，保留其 PolyForm Noncommercial License 1.0.0 与 Required Notice。完整真人 E2E 仍需使用真实 LiveKit 与供应商账户验证。
