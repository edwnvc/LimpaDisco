# Gera icone.ico (espanador laranja) em vários tamanhos. Rodar: powershell -File icone.ps1
Add-Type -AssemblyName System.Drawing
$sizes = 16, 24, 32, 48, 64, 128, 256
$pngs = foreach ($s in $sizes) {
    $bmp = New-Object Drawing.Bitmap $s, $s
    $g = [Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'; $g.PixelOffsetMode = 'HighQuality'
    $g.ScaleTransform($s / 256, $s / 256)   # desenha sempre em 256x256

    # fundo: quadrado arredondado com degradê laranja
    $r = 56; $p = New-Object Drawing.Drawing2D.GraphicsPath
    $p.AddArc(8, 8, $r*2, $r*2, 180, 90); $p.AddArc(248-$r*2, 8, $r*2, $r*2, 270, 90)
    $p.AddArc(248-$r*2, 248-$r*2, $r*2, $r*2, 0, 90); $p.AddArc(8, 248-$r*2, $r*2, $r*2, 90, 90); $p.CloseFigure()
    $bg = New-Object Drawing.Drawing2D.LinearGradientBrush ([Drawing.Point]::new(0,0)), ([Drawing.Point]::new(256,256)), ([Drawing.Color]::FromArgb(255,122,26)), ([Drawing.Color]::FromArgb(255,176,46))
    $g.FillPath($bg, $p)

    $dark = New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(43,18,3))
    # cabo na diagonal
    $pen = New-Object Drawing.Pen $dark.Color, 22; $pen.StartCap = 'Round'; $pen.EndCap = 'Round'
    $g.DrawLine($pen, 134, 134, 206, 206)
    # anel de amarração
    $pen2 = New-Object Drawing.Pen $dark.Color, 36; $pen2.StartCap = 'Round'; $pen2.EndCap = 'Round'
    $g.DrawLine($pen2, 128, 128, 144, 144)
    # penas: plumas alongadas abrindo em leque a partir da amarração (cada uma contornada em laranja para se separar)
    $edge = New-Object Drawing.Pen ([Drawing.Color]::FromArgb(255,150,40)), 7
    $vein = New-Object Drawing.Pen ([Drawing.Color]::FromArgb(150,255,170,90)), 3
    foreach ($a in 192, 258, 208, 242, 225) {   # graus; 225 = para cima e para a esquerda; a do meio por cima
        $st = $g.Save()
        $g.TranslateTransform(130, 130); $g.RotateTransform($a)
        $len = if ($a -eq 225) { 116 } else { 100 }
        $g.FillEllipse($dark, 6, -21, $len, 42); $g.DrawEllipse($edge, 6, -21, $len, 42)
        if ($s -ge 48) { $g.DrawLine($vein, 18, 0, $len - 6, 0) }   # nervura da pena só onde dá para ver
        $g.Restore($st)
    }
    $g.Dispose()
    $ms = New-Object IO.MemoryStream; $bmp.Save($ms, [Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
    , $ms.ToArray()
}

# formato ICO: cabeçalho + diretório + imagens PNG
$out = New-Object IO.MemoryStream; $w = New-Object IO.BinaryWriter $out
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $s = $sizes[$i]; $b = if ($s -ge 256) { 0 } else { $s }
    $w.Write([byte]$b); $w.Write([byte]$b); $w.Write([byte]0); $w.Write([byte]0)
    $w.Write([uint16]1); $w.Write([uint16]32); $w.Write([uint32]$pngs[$i].Length); $w.Write([uint32]$offset)
    $offset += $pngs[$i].Length
}
foreach ($png in $pngs) { $w.Write($png) }
[IO.File]::WriteAllBytes((Join-Path $PSScriptRoot 'icone.ico'), $out.ToArray())
"icone.ico gerado ($($sizes -join ', ') px)"
