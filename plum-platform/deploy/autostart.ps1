# Windows 开机自启动：在「当前用户启动文件夹」创建/删除一个快捷方式。
# 不需要管理员权限、不写注册表、不装服务，卸载就是删掉那个 .lnk。
param(
  [ValidateSet('install', 'uninstall', 'status')]
  [string]$Action = 'install'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$startup = [Environment]::GetFolderPath('Startup')
$link = Join-Path $startup 'PlumPlatform.lnk'
$target = Join-Path $root 'deploy\run_server.bat'

if ($Action -eq 'install') {
  if (-not (Test-Path $target)) { throw "run_server.bat not found: $target" }
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($link)
  $shortcut.TargetPath = $target
  $shortcut.WorkingDirectory = $root
  $shortcut.WindowStyle = 7
  $shortcut.Description = 'Plum platform auto start (Flask + AI QA)'
  $shortcut.Save()
  Write-Host "INSTALLED: $link"
  Write-Host "TARGET   : $target"
  Write-Host 'It starts on next sign-in. To start now, run deploy\run_server.bat'
} elseif ($Action -eq 'uninstall') {
  if (Test-Path $link) {
    Remove-Item $link -Force
    Write-Host "REMOVED: $link"
  } else {
    Write-Host 'NOT INSTALLED'
  }
} else {
  if (Test-Path $link) {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($link)
    Write-Host 'ENABLED : True'
    Write-Host "LINK    : $link"
    Write-Host "TARGET  : $($shortcut.TargetPath)"
  } else {
    Write-Host 'ENABLED : False'
  }
}
