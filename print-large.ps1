Add-Type -AssemblyName System.Drawing

$text = [Console]::In.ReadToEnd()
$printerName = $env:PRINTER_NAME
$logoPath = $env:LOGO_PATH

if ([string]::IsNullOrWhiteSpace($printerName)) {
  throw "Nenhuma impressora configurada."
}

$brandFont = New-Object System.Drawing.Font("Arial", 24, [System.Drawing.FontStyle]::Bold)
$companyFont = New-Object System.Drawing.Font("Arial", 12, [System.Drawing.FontStyle]::Bold)
$bodyFont = New-Object System.Drawing.Font("Arial", 12, [System.Drawing.FontStyle]::Bold)
$commandFont = New-Object System.Drawing.Font("Arial", 20, [System.Drawing.FontStyle]::Bold)
$brush = [System.Drawing.Brushes]::Black
$lines = ($text -replace "`r`n", "`n" -replace "`r", "`n") -split "`n", -1
$logoImage = $null

if (-not [string]::IsNullOrWhiteSpace($logoPath) -and (Test-Path -LiteralPath $logoPath)) {
  $logoImage = [System.Drawing.Image]::FromFile($logoPath)
}

$script:index = 0
$document = New-Object System.Drawing.Printing.PrintDocument
$document.PrinterSettings.PrinterName = $printerName
$document.DocumentName = "Mari Mais Sabor"
$document.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(4, 4, 4, 4)

if (-not $document.PrinterSettings.IsValid) {
  throw "Impressora invalida: $printerName"
}

$document.add_PrintPage({
  param($sender, $event)

  $left = [single]$event.MarginBounds.Left
  $top = [single]$event.MarginBounds.Top
  $maxWidth = [int]$event.MarginBounds.Width

  if ($maxWidth -gt 300) {
    $maxWidth = 290
  }

  if ($script:index -eq 0 -and $logoImage -ne $null) {
    $logoSize = [single]110
    $logoLeft = $left + (($maxWidth - $logoSize) / 2)
    $event.Graphics.DrawImage($logoImage, $logoLeft, $top, $logoSize, $logoSize)
    $top += $logoSize + 8
  }

  while ($script:index -lt $lines.Length) {
    $line = $lines[$script:index]

    if ([string]::IsNullOrWhiteSpace($line)) {
      $top += 6
      $script:index++
      continue
    }

    $font = $bodyFont
    $alignment = [System.Drawing.StringAlignment]::Near

    if ($line -eq "MARI MAIS SABOR") {
      $font = $brandFont
      $alignment = [System.Drawing.StringAlignment]::Center
    } elseif ($line -eq "COMANDA COZINHA") {
      $font = $commandFont
      $alignment = [System.Drawing.StringAlignment]::Center
    } elseif ($line -match "^(Endereco|Contato|CEP|CNPJ):") {
      $font = $companyFont
      $alignment = [System.Drawing.StringAlignment]::Center
    }

    $size = $event.Graphics.MeasureString($line, $font, $maxWidth)
    $height = [Math]::Ceiling($size.Height) + 3

    if (($top + $height) -gt $event.MarginBounds.Bottom) {
      $event.HasMorePages = $true
      return
    }

    $area = New-Object System.Drawing.RectangleF($left, $top, $maxWidth, $height)
    $format = New-Object System.Drawing.StringFormat
    $format.Alignment = $alignment
    $event.Graphics.DrawString($line, $font, $brush, $area, $format)
    $top += $height
    $script:index++
  }

  $event.HasMorePages = $false
})

try {
  $document.Print()
} finally {
  $bodyFont.Dispose()
  $brandFont.Dispose()
  $companyFont.Dispose()
  $commandFont.Dispose()
  if ($logoImage -ne $null) {
    $logoImage.Dispose()
  }
  $document.Dispose()
}
