# Pinned Finance Tooltip

城市天际线 II（Cities: Skylines II）UI 模组：在底部工具栏的资金数字旁新增一个趋势按钮，点击后资金提示（当前走势）与收入/支出分类明细常驻显示在资金栏上方，再次点击收起。

- **Paradox Mods 页面**：<https://mods.paradoxplaza.com/mods/160391/Windows>
- **ModID**：160391（发新版本时需要，已回填在 PublishConfiguration.xml）
- **适配游戏版本**：1.6.2f1
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

## 测试排错

- 模组是否加载：看 `Player.log`（加载成功无日志；面板崩溃会有 `[PinnedFinanceTooltip]` 前缀的错误，启动时有 `loaded. Host runtime: {...}` 诊断行）
- UI 调试：`--uiDeveloperMode` 启动游戏，Chrome 连 <http://localhost:9444>

## 发布（Paradox Mods）

前提：游戏内已登录 PDX 账号（发布工具自动复用登录态）。

```bash
# 首次发布（已完成的用 Update / NewVersion）
DOTNET_ROLL_FORWARD=Major \
  "<游戏目录>\Cities2_Data\Content\Game\.ModdingToolchain\ModPublisher\ModPublisher.exe" \
  Publish <本文件绝对路径>\PublishConfiguration.xml \
  -c "%CSII_USERDATAPATH%\Mods\PinnedFinanceTooltip"
```

- **仅更新描述/图片/元数据**：同上，命令换成 `Update`
- **发新版本**：`mod.json` 和 PublishConfiguration.xml 的版本号递增，PublishConfiguration.xml 加 `<ChangeLog>` 元素，命令换成 `NewVersion`
- 图片单张不超过 2.1MB（大图转 1920 宽 JPEG 质量 85 即可）

游戏安装目录本机为 `D:\Game\Steam\steamapps\common\Cities Skylines II`。

## 项目结构

```
src/index.tsx                       # 入口：注册 Toolbar 扩展
src/mods/pinned-finance-tooltip.tsx # 全部实现（按钮注入、面板、数据订阅）
src/mods/*.module.scss              # 样式（CSS Modules，复用原版 CSS 变量）
publish/                            # 发布用图（缩略图 + 截图）
PublishConfiguration.xml            # 发布配置（含 ModId）
types/                              # 官方 cs2/* 包类型定义（游戏工具链提供）
```

## 实现要点（坑位备忘）

- 扩展点：`moduleRegistry.extend('game-ui/game/components/toolbar/toolbar.tsx', 'Toolbar', ...)`。**不能** extend money-field.tsx——该模块在 1.6.x 被编译为 const 绑定，override 必抛 `Assignment to constant variable`
- 按钮用原生 DOM 插入资金栏 field 内部（flex 布局正确 + 点击命中），pointerdown/mousedown/click 全部 stopPropagation 防止冒泡打开原版经济面板；插到 field 外部会撑坏布局
- Gameface 中 Portal 到 body 的 fixed 元素可见但**不响应点击**；`<img>` 引用 SVG 时 currentColor 不继承（显黑色），须内联 SVG
- budget 数据在 `cs2/bindings` 的 `economyBudget` 命名空间（`budget` 命名空间只有类型）
- 面板崩溃由 ErrorBoundary 兜底（按钮在边界外，永不消失）；运行时导出全部有本地 fallback
