# Run in your LOCAL REPO ROOT after copying the draft files into your OWN feature branch.
# Does not deploy or run Supabase commands.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not (Test-Path 'client/package-lock.json')) { throw 'Run in repository root.' }
$branch = (git branch --show-current).Trim()
if ($LASTEXITCODE -ne 0 -or $branch -eq 'main' -or $branch -eq 'master' -or -not $branch) {
  throw 'Refusing verification on main/master or unknown branch. Create a local feature branch first.'
}
$origin = (git remote get-url origin).Trim()
if ($LASTEXITCODE -ne 0 -or $origin -notmatch '(^|[/:])lestonggg12/PhilamLife(\.git)?$') {
  throw 'Unexpected Git remote.'
}
Write-Host "Branch: $branch"
Write-Host 'No database migration is executed by this script.'
Push-Location client
try {
  npm ci
  if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
  npm test
  if ($LASTEXITCODE -ne 0) { throw 'Vitest suite failed' }
  npm run build
  if ($LASTEXITCODE -ne 0) { throw 'Vite build failed' }
  Write-Host 'LOCAL TESTS AND BUILD PASSED — NOT DEPLOYED.'
} finally { Pop-Location }
