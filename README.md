# Pinned Finance Tooltip

城市天际线 II（Cities: Skylines II）UI 模组：在底部工具栏的资金数字旁新增一个趋势按钮，点击后资金提示（当前走势）与收入/支出分类明细常驻显示在资金栏上方，再次点击收起。

- **Paradox Mods 页面**：<https://mods.paradoxplaza.com/mods/160391/Windows>
- **ModID**：160391（发新版本时需要，已回填在 PublishConfiguration.xml）
- **适配游戏版本**：1.6.*（发布配置用通配符，游戏小版本更新不失效；构建/验证基于 1.6.2f1）
- 纯 UI 模组（TypeScript + React，Coherent Gameface），不写入任何存档数据

## 功能

- 资金栏旁展开/收缩按钮，面板常驻资金栏上方
- 当前走势（每小时收支）+ 收入/支出分类明细（数据来自原版经济面板同源绑定）
- 全部文案通过原版本地化组件取词，跟随游戏语言
- 按 ESC（暂停菜单）、读取存档、开始新游戏时自动收起（事件驱动，无轮询）

## 开发环境

- Node.js ≥ 20（本机通过 fnm 安装亦可）
- 依赖通过上级目录的 npm workspace 统一安装（`CitesSkylines2Mods/package.json`），本项目内无 node_modules

## 构建

```bash
# 在 CitesSkylines2Mods 根目录首次安装依赖（workspace 共用）
npm install

# 构建并自动部署到本地 Mods 目录（在项目目录执行）
# Windows (Git Bash / PowerShell)：
CSII_USERDATAPATH="C:/Users/<用户名>/AppData/LocalLow/Colossal Order/Cities Skylines II" npm run build
```

构建产物输出到 `%CSII_USERDATAPATH%\Mods\PinnedFinanceTooltip\`（.mjs + .css），游戏会自动加载本地 UI 模组。注意：

- 改完需要**完全重启游戏**才生效（不支持热加载，除非用 `--uiDeveloperMode`）
- 已订阅线上版时，本地部署会和订阅版产生加载不确定性——本地测试期间建议停用订阅版，测试完删除本地部署目录

## 测试

```bash
# 离线回归（150ms 聚合刷新 / 行预算与「+N」/ 脏数据兜底），不需要进游戏
npm test -w PinnedFinanceTooltip
# 类型检查（在 PinnedFinanceTooltip 目录）
npx tsc --noEmit -p tsconfig.json
```

## 测试排错

- 模组是否加载：看 `Player.log`，每次加载会有一条 `[UI] [ERROR] [PFT] info: module loaded (not an error)`，附带 bindings/loc 的可用性快照；面板崩溃会有 `[PinnedFinanceTooltip]` 前缀的错误
- **Gameface 只把 error 级别的 console 输出转发到 Player.log**，`console.log` 不会出现，排障日志一律用 `console.error`（且只保留一条，避免刷堆栈）
- UI 调试：`--uiDeveloperMode` 启动游戏，Chrome 连 <http://localhost:9444>

## 发布（Paradox Mods）

前提：游戏内已登录 PDX 账号（发布工具自动复用登录态），并且**已完全退出游戏**。

用项目根的 `publish.ps1`（内置游戏进程闸门、构建、包内容校验、双版本号递增、ChangeLog 写入、调用发布器）：

```powershell
# 只校验：构建 + 检查部署目录 + 打印将要执行的发布命令，不改版本号、不发布
powershell -ExecutionPolicy Bypass -File .\publish.ps1 -DryRun -ChangeLog "占位"

# 发新版本：版本号 1.0.1 -> 1.0.2（z 满十进位），写 ChangeLog，调 ModPublisher NewVersion
powershell -ExecutionPolicy Bypass -File .\publish.ps1 -Command NewVersion -ChangeLog "<中英文案>"

# 仅刷新页面元数据（不动版本号、不构建）
powershell -ExecutionPolicy Bypass -File .\publish.ps1 -Command Update
```

手动等价命令（脚本内部做的就是这个）：

```bash
DOTNET_ROLL_FORWARD=Major \
  "<游戏目录>\Cities2_Data\Content\Game\.ModdingToolchain\ModPublisher\ModPublisher.exe" \
  NewVersion <本文件绝对路径>\PublishConfiguration.xml \
  -c "%CSII_USERDATAPATH%\Mods\PinnedFinanceTooltip"
```

- **发新版本**：`mod.json` 和 `PublishConfiguration.xml` 的 `ModVersion` 必须一致，并写 `<ChangeLog>`
- 图片单张不超过 2.1MB（大图转 1920 宽 JPEG 质量 85 即可）
- 脚本存为 **UTF-8 BOM**，Windows PowerShell 5.1 / pwsh 7 都能解析中文

游戏安装目录本机为 `D:\Game\Steam\steamapps\common\Cities Skylines II`。

## 项目结构

```
src/index.tsx                          # 入口：注册 Toolbar 扩展
src/mods/pinned-finance-tooltip.tsx     # 注册、Toolbar 包装、ErrorBoundary、ESC/读档收起
src/mods/finance-bindings.ts            # 宿主绑定惰性解析（缺导出可降级）
src/mods/finance-store.ts               # 8 个绑定的聚合 store（150ms 收集窗口）
src/mods/use-finance-snapshot.ts        # 面板侧订阅 hook
src/mods/money-anchor.ts                # 资金栏锚点：DOM 查找、跟随、可见性、rem 换算（唯一 DOM 来源）
src/mods/use-anchor-state.ts            # 锚点 hook（仅面板展开时跟随）
src/mods/layout.ts                      # 行预算与「+N」分配（纯函数，离线可测）
src/mods/toolbar-button.tsx             # 资金栏内的原生按钮注入
src/mods/finance-panel.tsx              # 面板渲染（memo 行 + 截断页脚）
src/mods/localization.tsx / format.tsx  # 原版词条与数字/颜色格式化（含本地 fallback）
src/mods/*.module.scss                  # 样式（CSS Modules，复用原版 CSS 变量）
tests/finance-store.test.cjs            # 离线回归（假时钟 + 假绑定）
docs/优化清单.md                         # 性能与代码整改清单（含决策与验收方法）
publish.ps1                             # 一键发布（闸门 + 构建 + 校验 + 版本号 + ModPublisher）
publish/                                # 发布用图（缩略图 + 截图）
PublishConfiguration.xml                # 发布配置（含 ModId）
types/                                  # 官方 cs2/* 包类型定义（游戏工具链提供）
```

## 实现要点（坑位备忘）

- 扩展点：`moduleRegistry.extend('game-ui/game/components/toolbar/toolbar.tsx', 'Toolbar', ...)`。**不能** extend money-field.tsx——该模块在 1.6.x 被编译为 const 绑定，override 必抛 `Assignment to constant variable`
- 三套工具栏（新版 / 经典 / 手柄 Console）都包装，同一时刻只挂载一套；按钮注入用 `data-pft-toggle` 去重，避免两套同挂时出现两个按钮
- 按钮用原生 DOM 插入资金栏 field 内部（flex 布局正确 + 点击命中），pointerdown/mousedown/click 全部 stopPropagation 防止冒泡打开原版经济面板；插到 field 外部会撑坏布局
- 面板与按钮共用 `money-anchor.ts` 找锚点：选择器优先 `money-field_`（新版/经典同名类），找不到才回退 `field_`
- Gameface 中 Portal 到 body 的 fixed 元素可见但**不响应点击**；`<img>` 引用 SVG 时 currentColor 不继承（显黑色），须内联 SVG
- budget 数据在 `cs2/bindings` 的 `economyBudget` 命名空间（`budget` 命名空间只有类型），且**不能模块顶层解构**：改名为惰性读取，缺导出只降级不崩
- 面板订阅走 `finance-store` 的 150ms 收集窗口：同一 simulation tick 里 8 个绑定各回调一次也只重绘一次
- 重绘判定比的是「实际画出来的内容」：money 取整后比较、分类数组按 `id`/`active`/颜色分量结构比较——宿主每次 push 都会重建对象，直接比引用会退化成每 tick 都重绘
- 面板随工具栏隐藏：照片模式 / 隐藏 UI 时根节点带 `hide-ui`，而 body 直挂的 Portal 逃逸了原版的 `.hide-ui .app-container>*{opacity:0}`，因此自己用「锚点矩形 + hide-ui 类」判定，命中后**只暂时不渲染**（`expanded` 保留），退出后自动回来
- 行数超出可用高度时截断并显示 `+N`（`pointer-events: none` 的面板无法滚动）；`rem` 不是 html font-size，用 probe 元素量换算
- 面板崩溃由 ErrorBoundary 兜底（按钮在边界外，永不消失）；运行时导出全部有本地 fallback
