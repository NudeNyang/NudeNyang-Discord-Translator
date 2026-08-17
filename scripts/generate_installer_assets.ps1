[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$sourceLogo = Join-Path $repositoryRoot "assets\nude-translator.png"
$outputDirectory = Join-Path $repositoryRoot "assets\installer"

New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null

function New-InstallerBitmap {
    param(
        [Parameter(Mandatory = $true)]
        [int]$Width,

        [Parameter(Mandatory = $true)]
        [int]$Height,

        [Parameter(Mandatory = $true)]
        [string]$Destination,

        [Parameter(Mandatory = $true)]
        [scriptblock]$Draw
    )

    $bitmap = [System.Drawing.Bitmap]::new(
        $Width,
        $Height,
        [System.Drawing.Imaging.PixelFormat]::Format24bppRgb
    )
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)

    try {
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        & $Draw $graphics
        $bitmap.Save($Destination, [System.Drawing.Imaging.ImageFormat]::Bmp)
    }
    finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

$logo = [System.Drawing.Image]::FromFile($sourceLogo)

try {
    $sidebarPath = Join-Path $outputDirectory "sidebar-light.bmp"
    New-InstallerBitmap -Width 164 -Height 314 -Destination $sidebarPath -Draw {
        param($graphics)

        $background = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(241, 246, 250))
        $accentSoft = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(220, 235, 248))
        $accentMist = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(234, 242, 248))
        $accent = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(52, 127, 199))
        $border = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(196, 213, 226), 1)

        try {
            $graphics.FillRectangle($background, 0, 0, 164, 314)
            $graphics.FillEllipse($accentSoft, -54, 150, 218, 218)
            $graphics.FillEllipse($accentMist, 70, 196, 124, 124)
            $graphics.FillRectangle($accent, 0, 0, 7, 314)
            $graphics.DrawLine($border, 7, 0, 7, 314)
            $graphics.DrawImage($logo, 45, 39, 80, 80)
        }
        finally {
            $background.Dispose()
            $accentSoft.Dispose()
            $accentMist.Dispose()
            $accent.Dispose()
            $border.Dispose()
        }
    }

    $headerPath = Join-Path $outputDirectory "header-light.bmp"
    New-InstallerBitmap -Width 150 -Height 57 -Destination $headerPath -Draw {
        param($graphics)

        $background = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(251, 253, 255))
        $accentSoft = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(220, 235, 248))
        $accent = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(52, 127, 199))
        $border = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(196, 213, 226), 1)

        try {
            $graphics.FillRectangle($background, 0, 0, 150, 57)
            $graphics.FillEllipse($accentSoft, 83, -30, 90, 90)
            $graphics.FillRectangle($accent, 0, 53, 150, 4)
            $graphics.DrawLine($border, 0, 52, 150, 52)
            $graphics.DrawImage($logo, 106, 9, 36, 36)
        }
        finally {
            $background.Dispose()
            $accentSoft.Dispose()
            $accent.Dispose()
            $border.Dispose()
        }
    }
}
finally {
    $logo.Dispose()
}

Write-Host "Generated installer artwork in $outputDirectory"
