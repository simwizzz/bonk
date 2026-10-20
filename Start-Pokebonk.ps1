$ErrorActionPreference = 'Stop'
$ReaPython = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $ReaPython) { throw '需要 Python 3；本机归档时使用 Python 3.14。' }
Write-Host '本地离线版：http://127.0.0.1:8765/?lang=zh；按 Ctrl+C 关闭服务。'
& $ReaPython (Join-Path $PSScriptRoot 'serve_local.py') --port 8765 --open
