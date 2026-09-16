# iOS 浏览器顶部渐变遮挡：候选兼容处理

状态：代码与回归检查可在本地验证；尚未经 iOS 27 Safari 真机验收，不应当作已确认消除系统模糊的修复发布。

用户反馈普通浏览器顶部出现渐变白雾，覆盖网页返回键和标题。不能仅凭截图将其归为 PWA 状态栏问题。

## 实现与取舍

`utils/iosBrowserTopEdge.ts` 在 iOS 普通浏览器中向 body 直接挂载一个宽度 100%、高度 4px、顶部固定且不透明的真实元素，颜色沿用 body 的 `#0f1115`。为浏览器提供独立于页面半透明顶栏的取色对象；脱离 PhoneShell 的 containment、滤镜与动画。它不占布局空间，不拦截点击，不进入无障碍树。

这是基于浏览器启发式取色的兼容候选，不是关闭系统 scroll-edge blur 的标准 API。代价是页面最顶部出现 4px 深色细线，不能保证与所有自定义皮肤无缝。不要盲目增加安全区 padding，也不要把 PWA 的 black-translucent 改为 default 来处理普通浏览器问题。

仅适用 iOS 浏览器；Android、桌面、主屏幕 standalone、Capacitor 原生应用不启用。不依赖 iOS 版本号检测。

行为依据：
- WebKit 状态栏背景在导航后退化为阴影的报告：https://bugs.webkit.org/show_bug.cgi?id=305546
- 独立取色实验及可运行示例：https://github.com/andesco/safari-color-tinting

## 真机验收

运行 `pnpm dev --host 0.0.0.0`，同一网络手机打开 `/test/fixtures/ios-browser-top-edge.html`，同页切换原始状态与候选处理。该测试页通过 Vite 开发服务访问，不随应用构建发布。

记录机型、完整 iOS 版本、浏览器名称、是否从主屏幕打开。需要检查：
1. 首次进入、向下滚动再回顶部、地址栏展开与折叠时，白雾是否消失，标题与返回键是否清晰。
2. 横竖屏切换、键盘弹出与收回、前进后退之后是否恢复白雾。
3. 实际应用桌面、聊天、切换角色及浅/深色自定义皮肤，确认深色细线可接受且所有控件仍可点击。
4. 对照上一代 iOS Safari；PWA 与 Android 应保持原布局。

若无改善，不应继续加高遮罩或宣布修复。移除入口安装调用即可回退，保留对照页继续定位浏览器行为。
