# Run this script as Administrator to install Docker Desktop
# Right-click PowerShell -> "Run as Administrator", then:
#   .\install-docker.ps1

Write-Host "Installing Docker Desktop..." -ForegroundColor Cyan
winget install -e --id Docker.DockerDesktop --accept-source-agreements --accept-package-agreements

Write-Host ""
Write-Host "Done! Please:" -ForegroundColor Green
Write-Host "  1. Restart your computer (or log out and back in)" -ForegroundColor White
Write-Host "  2. Launch Docker Desktop from the Start Menu" -ForegroundColor White
Write-Host "  3. Wait for the whale icon in the taskbar to turn green (Running)" -ForegroundColor White
Write-Host "  4. Open a normal PowerShell in c:\Users\anshw\Documents\Atlas" -ForegroundColor White
Write-Host "  5. Run:  .\atlas.ps1 up" -ForegroundColor Yellow
