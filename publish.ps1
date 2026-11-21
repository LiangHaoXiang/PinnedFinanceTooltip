<#
.SYNOPSIS
    构建、校验并发布 Pinned Finance Tooltip 到 Paradox Mods。

.DESCRIPTION
    按顺序做这些事，任一步失败即中止：
      1. 游戏进程闸门——工具链发布前会先清空 Mods\PinnedFinanceTooltip 再复制，
         游戏锁着 dll/文件时会出现「目录被清空但新文件没进去」的坏部署。
      2. 校验 CSII_USERDATAPATH / CSII_MODPUBLISHERPATH（不要猜路径，环境变量里就有）。
      3. npm run build，把 .mjs/.css 写进部署目录（纯 UI 模组缺这一步会发出没有 UI 的包）。
      4. 校验部署目录里确实有 .mjs 与 .css。
      5. NewVersion/Publish：同步递增 mod.json 与 PublishConfiguration.xml 的版本号
         （默认 z 位 +1，满十进位：1.0.9 -> 1.1.0），并写入 ChangeLog。
      6. 调 ModPublisher.exe（自动复用游戏内 PDX 登录态）。

.PARAMETER Command
    NewVersion（默认，发新版）/ Update（仅刷新页面元数据，不动版本号）/ Publish（首发）。

.PARAMETER Version
    显式指定版本号；省略则按当前版本自动递增。

.PARAMETER ChangeLog
    写入 <ChangeLog> 的文本，建议中英各一段。NewVersion / Publish 必填。

.PARAMETER DryRun
    照常构建与校验、打印将要写入的版本号与最终 ModPublisher 命令，
    但不修改 mod.json / PublishConfiguration.xml，也不调用发布器。

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\publish.ps1 -DryRun -ChangeLog "test"

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\publish.ps1 -Command NewVersion -ChangeLog `
      "Performance: the pinned panel now repaints at most once per 150 ms.`n`n性能：面板改为 150ms 聚合刷新。"
#>
param(
    [ValidateSet("NewVersion", "Update", "Publish")]
    [string]$Command = "NewVersion",
    [string]$Version,
    [string]$ChangeLog,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$projectDir = $PSScriptRoot
$modJsonPath = Join-Path $projectDir "mod.json"
$configPath = Join-Path $projectDir "PublishConfiguration.xml"

# --- 1. 游戏进程闸门 --------------------------------------------------------
$game = Get-Process -Name "Cities2" -ErrorAction SilentlyContinue
if ($game) {
    throw "游戏正在运行（PID $($game.Id -join ',')）。请完全退出游戏再发布：工具链会先清空 Mods\PinnedFinanceTooltip。"
}

# --- 2. 环境变量 ------------------------------------------------------------
$userData = $env:CSII_USERDATAPATH
if (-not $userData) { throw "CSII_USERDATAPATH 未设置（应由 CS2 模组工具链提供）。" }
if (-not (Test-Path $userData)) { throw "CSII_USERDATAPATH 指向的目录不存在：$userData" }

$publisher = $env:CSII_MODPUBLISHERPATH
if (-not $publisher) { throw "CSII_MODPUBLISHERPATH 未设置（ModPublisher.exe 的绝对路径在那个变量里）。" }
if (-not (Test-Path $publisher)) { throw "找不到 ModPublisher.exe：$publisher" }

$deployDir = Join-Path $userData "Mods\PinnedFinanceTooltip"

# --- 3. 当前版本 ------------------------------------------------------------
$modJson = Get-Content -Path $modJsonPath -Raw
$config = Get-Content -Path $configPath -Raw

$modVersion = [regex]::Match($modJson, '"version"\s*:\s*"([0-9.]+)"').Groups[1].Value
$configVersion = [regex]::Match($config, '<ModVersion Value="([0-9.]+)"').Groups[1].Value
if (-not $modVersion) { throw "mod.json 里读不到 version。" }
if (-not $configVersion) { throw "PublishConfiguration.xml 里读不到 ModVersion。" }
if ($modVersion -ne $configVersion) {
    Write-Warning "mod.json ($modVersion) 与 PublishConfiguration.xml ($configVersion) 版本号不一致，以 mod.json 为基准。"
}

function Get-NextVersion([string]$current) {
    $parts = @($current.Split('.') | ForEach-Object { [int]$_ })
    while ($parts.Count -lt 3) { $parts += 0 }
    $major, $minor, $patch = $parts[0], $parts[1], $parts[2]
    $patch += 1
    if ($patch -gt 9) { $patch = 0; $minor += 1 }
    if ($minor -gt 9) { $minor = 0; $major += 1 }
    return "$major.$minor.$patch"
}

$targetVersion = $modVersion
if ($Command -ne "Update") {
    $targetVersion = if ($Version) { $Version } else { Get-NextVersion $modVersion }
    if ($targetVersion -notmatch '^[0-9]+\.[0-9]+\.[0-9]+$') {
        throw "-Version 必须是 x.y.z 形式，收到：$targetVersion"
    }
    if ($targetVersion -eq $modVersion) { throw "目标版本号与当前版本相同（$targetVersion）。" }
    if (-not $ChangeLog) { throw "$Command 需要 -ChangeLog 文本（会写进 PublishConfiguration.xml）。" }
}

Write-Host "命令：$Command" -ForegroundColor Cyan
Write-Host "当前版本：$modVersion  ->  目标版本：$targetVersion" -ForegroundColor Cyan
Write-Host "部署目录：$deployDir"

# --- 4. 构建 ---------------------------------------------------------------
if ($Command -eq "Update") {
    Write-Host "Update：仅刷新页面元数据，跳过构建。"
} else {
    Push-Location $projectDir
    try {
        & npm run build
        if ($LASTEXITCODE -ne 0) { throw "npm run build 失败（退出码 $LASTEXITCODE）。" }
    } finally {
        Pop-Location
    }
}

# --- 5. 校验部署产物（纯 UI 模组的包必须同时带 .mjs 与 .css）--------------
$mjs = @(Get-ChildItem -Path $deployDir -Filter "*.mjs" -File -ErrorAction SilentlyContinue)
$css = @(Get-ChildItem -Path $deployDir -Filter "*.css" -File -ErrorAction SilentlyContinue)
if ($mjs.Count -eq 0) { throw "部署目录里没有 .mjs：UI 没构建进包，发布出去会是没有界面的版本。" }
if ($css.Count -eq 0) { throw "部署目录里没有 .css：样式会丢失。" }
$mjs | ForEach-Object { Write-Host ("  {0}  {1:N0} B" -f $_.Name, $_.Length) }
$css | ForEach-Object { Write-Host ("  {0}  {1:N0} B" -f $_.Name, $_.Length) }

# --- 6. 写入版本号与 ChangeLog（DryRun 跳过）-------------------------------
if ($DryRun) {
    Write-Host "DryRun：不修改 mod.json / PublishConfiguration.xml，也不调用发布器。" -ForegroundColor Yellow
} elseif ($Command -ne "Update") {
    $bumpedJson = [regex]::Replace($modJson, '("version"\s*:\s*")[0-9.]+(")', ('${1}' + $targetVersion + '${2}'))
    # [System.IO.File] + UTF8Encoding($false)：Windows PowerShell 5.1 的
    # `-Encoding utf8` 会写 BOM，BOM 会进 mod.json。
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($modJsonPath, $bumpedJson, $utf8NoBom)

    $escaped = [System.Security.SecurityElement]::Escape($ChangeLog.Trim())
    $bumpedConfig = [regex]::Replace($config, '(<ModVersion Value=")[0-9.]+(")', ('${1}' + $targetVersion + '${2}'))
    $bumpedConfig = [regex]::Replace($bumpedConfig, '(?s)<ChangeLog>.*?</ChangeLog>', "<ChangeLog>`r`n$escaped`r`n  </ChangeLog>")
    [System.IO.File]::WriteAllText($configPath, $bumpedConfig, $utf8NoBom)
    Write-Host "已写入版本号与 ChangeLog。" -ForegroundColor Green
}

# --- 7. 发布 ---------------------------------------------------------------
$publishArgs = @($Command, $configPath, "-c", $deployDir)
$preview = '"' + $publisher + '" ' + (($publishArgs | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }) -join ' ')
Write-Host "ModPublisher：$preview"

if ($DryRun) { return }

$env:DOTNET_ROLL_FORWARD = "Major"
$output = & $publisher @publishArgs 2>&1
$output | ForEach-Object { Write-Host $_ }
if ($LASTEXITCODE -ne 0) {
    Write-Warning "版本号与 ChangeLog 已写入本地文件；确认这次没发成功后，可用 git checkout -- mod.json PublishConfiguration.xml 回滚。"
    throw "ModPublisher 失败（退出码 $LASTEXITCODE）。"
}

# 首发 Publish 会回 'Mod published with Id=<数字>'；NewVersion 只回
# 'New mod version published ... finished successfully'，两者判定不同。
$text = ($output -join "`n")
if ($Command -eq "Publish") {
    $match = [regex]::Match($text, "Mod published with Id=(\d+)")
    if ($match.Success) {
        Write-Host "发布成功：$($match.Value)" -ForegroundColor Green
    } else {
        Write-Warning "首发没有返回 ModId，请到 PDX 页面确认后再回填 <ModId>。"
    }
} elseif ($text -match "(?i)published") {
    Write-Host "新版本已发布（发布器输出 'New mod version published'）。" -ForegroundColor Green
} else {
    Write-Warning "发布器没有输出 published，请到 PDX 页面确认。"
}

$modId = [regex]::Match($config, '<ModId Value="(\d+)"').Groups[1].Value
if ($env:CSII_PDXMODSPATH -and $modId) {
    $cache = Get-ChildItem -Path (Join-Path $env:CSII_PDXMODSPATH "pdx_mods") -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like "$modId*" } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($cache) {
        Write-Host "订阅端缓存：$($cache.FullName)（确认里面有 .mjs、.css）" -ForegroundColor Cyan
    }
}
