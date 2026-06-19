$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$launcher = Join-Path $projectRoot "iniciar-impressora.cmd"
$startup = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startup "Mari Mais Sabor - Impressora.lnk"

if (-not (Test-Path -LiteralPath $launcher)) {
  throw "Inicializador não encontrado: $launcher"
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $launcher
$shortcut.WorkingDirectory = $projectRoot
$shortcut.WindowStyle = 7
$shortcut.Description = "Agente automático da impressora Mari Mais Sabor"
$shortcut.Save()

Write-Host "Inicialização automática instalada com sucesso." -ForegroundColor Green
Write-Host "O agente será aberto minimizado sempre que este usuário entrar no Windows."
Write-Host "Atalho criado em: $shortcutPath"
