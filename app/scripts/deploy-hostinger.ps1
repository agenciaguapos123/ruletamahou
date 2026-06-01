param(
  [string]$RemoteUser = 'u641777215',
  [string]$RemoteHost = '153.92.6.234',
  [int]$Port = 65002,
  [string]$RemotePath = '/home/u641777215/public_html/ruleta',
  [string]$KeyPath,
  [switch]$DeployRoot,
  [switch]$SkipBuild,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

function Invoke-CheckedCommand {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,

    [string[]]$Arguments = @()
  )

  & $FilePath @Arguments

  if ($LASTEXITCODE -ne 0) {
    throw "$FilePath failed with exit code $LASTEXITCODE."
  }
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$appDir = (Resolve-Path (Join-Path $scriptDir '..')).Path
$repoRoot = (Resolve-Path (Join-Path $appDir '..')).Path
$distDir = Join-Path $appDir 'dist'
$zipPath = Join-Path $appDir 'dist-hostinger.zip'
$stagingDir = Join-Path $appDir 'deploy-root-staging'
$remotePathNormalized = ($RemotePath -replace '\\', '/').TrimEnd('/')
$remoteDirName = ($remotePathNormalized -split '/')[(-1)]
$remoteHome = "/home/$RemoteUser"
$remoteZipPath = "$remoteHome/dist-hostinger.zip"
$backupPath = "$remoteHome/deploy_backups/{0}_{1}" -f $remoteDirName, (Get-Date -Format yyyyMMdd_HHmmss)
$remoteTarget = "$RemoteUser@$RemoteHost"

$sshArgs = @('-p', "$Port")
$scpArgs = @('-P', "$Port")

if ($KeyPath) {
  $resolvedKeyPath = (Resolve-Path $KeyPath).Path
  $sshArgs = @('-i', $resolvedKeyPath) + $sshArgs
  $scpArgs = @('-i', $resolvedKeyPath) + $scpArgs
}

$remoteCommand = "set -e; mkdir -p '$remoteHome/deploy_backups'; if [ -d '$remotePathNormalized' ]; then mv '$remotePathNormalized' '$backupPath'; fi; mkdir -p '$remotePathNormalized'; unzip -oq '$remoteZipPath' -d '$remotePathNormalized'; rm -f '$remoteZipPath'; echo 'Backup:' '$backupPath'; echo 'Deploy:' '$remotePathNormalized'"

if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) {
  throw 'ssh is not available in PATH.'
}

if (-not (Get-Command scp -ErrorAction SilentlyContinue)) {
  throw 'scp is not available in PATH.'
}

Push-Location $appDir

try {
  if (-not $SkipBuild) {
    Invoke-CheckedCommand -FilePath 'npm' -Arguments @('run', 'build')
  }

  if (-not (Test-Path $distDir)) {
    throw 'dist folder not found. Run without -SkipBuild or build the app first.'
  }

  if (Test-Path $zipPath) {
    Remove-Item $zipPath -Force
  }

  if ($DeployRoot) {
    $deployItems = @(
      '.htaccess',
      'api',
      'assets',
      'brands',
      'fonts',
      'icons',
      'index.html',
      'vite.svg'
    )

    if (Test-Path $stagingDir) {
      Remove-Item -LiteralPath $stagingDir -Recurse -Force
    }

    New-Item -ItemType Directory -Path $stagingDir | Out-Null

    foreach ($item in $deployItems) {
      $sourcePath = Join-Path $repoRoot $item

      if (-not (Test-Path $sourcePath)) {
        throw "Missing deploy artifact in repo root: $item"
      }

      Copy-Item -LiteralPath $sourcePath -Destination (Join-Path $stagingDir $item) -Recurse -Force
    }

    Compress-Archive -Path (Join-Path $stagingDir '*') -DestinationPath $zipPath -Force
  }
  else {
    Compress-Archive -Path (Join-Path $distDir '*') -DestinationPath $zipPath -Force
  }

  if ($DryRun) {
    Write-Host "Dry run enabled. Commands were not executed."
    Write-Host "Upload: scp $($scpArgs -join ' ') $zipPath ${remoteTarget}:$remoteZipPath"
    Write-Host "Remote: ssh $($sshArgs -join ' ') $remoteTarget $remoteCommand"
    return
  }

  Invoke-CheckedCommand -FilePath 'scp' -Arguments ($scpArgs + @($zipPath, "${remoteTarget}:$remoteZipPath"))
  Invoke-CheckedCommand -FilePath 'ssh' -Arguments ($sshArgs + @($remoteTarget, $remoteCommand))

  Write-Host "Deployment completed for $remotePathNormalized"
  Write-Host "Backup created at $backupPath"
}
finally {
  if (Test-Path $stagingDir) {
    Remove-Item -LiteralPath $stagingDir -Recurse -Force
  }

  Pop-Location
}