param([string]$OutputName = 'LineAlbumSaver.exe')
$ErrorActionPreference = 'Stop'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$metadata = Join-Path $env:WINDIR 'System32\WinMetadata'
$framework = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$refsRoot = Join-Path ${env:ProgramFiles(x86)} 'Reference Assemblies\Microsoft\Framework\.NETFramework'
$facade = Get-ChildItem -LiteralPath $refsRoot -Filter System.Runtime.dll -Recurse | Where-Object FullName -Match 'v4\.7\.2\\Facades' | Select-Object -First 1 -ExpandProperty FullName
if (-not $facade) { throw 'Missing .NET Framework reference assemblies (v4.7.2).' }
$arguments = @('/nologo','/codepage:65001','/target:winexe','/platform:x64','/optimize+',('/out:' + (Join-Path $PSScriptRoot $OutputName)),('/win32manifest:' + (Join-Path $PSScriptRoot 'app.manifest')))
foreach ($reference in @('System.dll','System.Core.dll','System.Drawing.dll','System.Windows.Forms.dll','WindowsBase.dll','UIAutomationClient.dll','UIAutomationTypes.dll')) {
    $candidate = Join-Path $framework $reference
    if (-not (Test-Path -LiteralPath $candidate)) { $candidate = Join-Path $framework ('WPF\' + $reference) }
    $arguments += '/r:' + $candidate
}
$arguments += '/r:' + $facade
$arguments += '/r:' + (Join-Path $framework 'System.Runtime.WindowsRuntime.dll')
foreach ($reference in @('Windows.Foundation.winmd','Windows.Globalization.winmd','Windows.Graphics.winmd','Windows.Media.winmd','Windows.Storage.winmd')) { $arguments += '/r:' + (Join-Path $metadata $reference) }
$arguments += '/resource:' + (Join-Path $PSScriptRoot 'nmdc.jpg') + ',nmdc.jpg'
$arguments += '/resource:' + (Join-Path $PSScriptRoot 'line.png') + ',line.png'
$arguments += '/win32icon:' + (Join-Path $PSScriptRoot 'app.ico')
$arguments += Join-Path $PSScriptRoot 'LineAlbumSaver.cs'
& $compiler @arguments
if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
Write-Output (Join-Path $PSScriptRoot $OutputName)

