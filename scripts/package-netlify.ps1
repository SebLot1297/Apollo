param(
  [string]$BackendUrl = 'https://apollo-uwg4.onrender.com'
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path $PSScriptRoot -Parent
$previousApiUrl = $env:VITE_API_BASE_URL
Push-Location $repositoryRoot
try {
  $env:VITE_API_BASE_URL = $BackendUrl
  npm run build
  if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
  $outputDirectory = Join-Path $repositoryRoot 'output/deployment'
  New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
  $archivePath = Join-Path $outputDirectory 'commandgrid-frontend-netlify.zip'
  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $buildRoot = (Resolve-Path 'frontend/dist').Path
  $archiveStream = [System.IO.File]::Open($archivePath, [System.IO.FileMode]::Create)
  $archive = [System.IO.Compression.ZipArchive]::new(
    $archiveStream, [System.IO.Compression.ZipArchiveMode]::Create
  )
  try {
    foreach ($asset in Get-ChildItem -LiteralPath $buildRoot -Recurse -File) {
      $entryName = $asset.FullName.Substring($buildRoot.Length + 1).Replace('\', '/')
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
        $archive, $asset.FullName, $entryName,
        [System.IO.Compression.CompressionLevel]::Optimal
      ) | Out-Null
    }
  } finally {
    $archive.Dispose()
    $archiveStream.Dispose()
  }
  Write-Output "Netlify upload package: $archivePath"
} finally {
  $env:VITE_API_BASE_URL = $previousApiUrl
  Pop-Location
}
