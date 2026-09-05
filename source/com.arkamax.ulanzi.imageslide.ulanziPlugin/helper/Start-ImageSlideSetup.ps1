[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$PluginRoot,
  [Parameter(Mandatory=$true)][string]$PressedKey,
  [Parameter(Mandatory=$true)][string]$SetupActionId,
  [Parameter(Mandatory=$true)][ValidateSet('install','repair','restore')][string]$Operation
)

$ErrorActionPreference='Stop'
$assistant=[IO.Path]::GetFullPath((Join-Path $PluginRoot 'helper\Invoke-ImageSlideSetup.ps1'))
if(-not(Test-Path -LiteralPath $assistant -PathType Leaf)){exit 1}
$arguments="-NoProfile -ExecutionPolicy Bypass -File `"$assistant`" -Mode Assistant -Operation $Operation -PluginRoot `"$PluginRoot`" -PressedKey $PressedKey -SetupActionId $SetupActionId"
$process=Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -WindowStyle Hidden -PassThru
if($null-eq$process-or$process.Id-le0){exit 1}
exit 0
