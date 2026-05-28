$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$appDir = (Resolve-Path (Join-Path $scriptDir '..')).Path
$repoRoot = (Resolve-Path (Join-Path $appDir '..')).Path
$distDir = Join-Path $appDir 'dist'

if (-not (Test-Path $distDir)) {
  throw 'dist folder not found. Run the Vite build before syncing.'
}

$deployItems = @(
  '.htaccess',
  'assets',
  'brands',
  'fonts',
  'icons',
  'index.html',
  'vite.svg'
)

foreach ($item in $deployItems) {
  $sourcePath = Join-Path $distDir $item
  $destinationPath = Join-Path $repoRoot $item

  if (-not (Test-Path $sourcePath)) {
    throw "Missing dist artifact: $item"
  }

  if (Test-Path $destinationPath) {
    Remove-Item -LiteralPath $destinationPath -Recurse -Force
  }

  Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Recurse -Force
}

Write-Host "Synced dist artifacts to $repoRoot"