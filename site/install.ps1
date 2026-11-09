# Instala o Orbi a partir da última release no GitHub.
#
#   irm https://<site do Orbi>/install.ps1 | iex
#
# O que este script faz, e só isso:
#   1. baixa Orbi-Setup.exe e Orbi-Setup.exe.sha256 da última release de github.com/joel1fps/orbi;
#   2. confere o SHA-256 do instalador; se não bater, apaga o arquivo e para;
#   3. abre o instalador, que instala só para o seu usuário (sem administrador);
#   4. apaga o arquivo baixado.
# Não pede administrador, não muda ExecutionPolicy nem nenhuma configuração do sistema.

& {
    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'   # o Windows PowerShell 5.1 baixa muito devagar com a barra de progresso

    $repo = 'joel1fps/orbi'
    $base = "https://github.com/$repo/releases/latest/download"
    if ($env:ORBI_RELEASE_BASE) { $base = $env:ORBI_RELEASE_BASE.TrimEnd('/') }   # para testar contra uma release falsa
    $file = 'Orbi-Setup.exe'

    if ([Environment]::OSVersion.Platform -ne 'Win32NT') {
        Write-Host 'O Orbi é só para Windows, por enquanto.' -ForegroundColor Yellow
        return
    }

    # O Windows PowerShell 5.1 pode não oferecer TLS 1.2 por padrão; vale só para esta janela.
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

    $dir = Join-Path ([IO.Path]::GetTempPath()) ('orbi-install-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Path $dir | Out-Null
    $exe = Join-Path $dir $file

    try {
        Write-Host ''
        Write-Host '  Orbi' -ForegroundColor Cyan
        Write-Host "  Baixando de $base/$file"
        Invoke-WebRequest -Uri "$base/$file" -OutFile $exe -UseBasicParsing
        $sumText = (Invoke-WebRequest -Uri "$base/$file.sha256" -UseBasicParsing).Content
        if ($sumText -is [byte[]]) { $sumText = [Text.Encoding]::ASCII.GetString($sumText) }

        Write-Host '  Conferindo o SHA-256...'
        $expected = ([string]$sumText).Trim().Split(@(' ', "`t", "`r", "`n"), [StringSplitOptions]::RemoveEmptyEntries)[0]
        if ($expected -notmatch '^[0-9a-fA-F]{64}$') {
            throw "O arquivo $file.sha256 da release não tem um SHA-256 válido. Nada foi instalado."
        }
        $actual = (Get-FileHash -Path $exe -Algorithm SHA256).Hash
        if ($actual -ne $expected.ToUpperInvariant()) {
            throw "O SHA-256 do instalador não confere (esperado $($expected.ToLowerInvariant()), veio $($actual.ToLowerInvariant())). O arquivo foi apagado e nada foi instalado."
        }
        Write-Host "  SHA-256 confere: $($actual.ToLowerInvariant())" -ForegroundColor Green

        Write-Host '  Abrindo o instalador...'
        # WaitForExit, e não -Wait: o instalador abre o Orbi no fim, e -Wait esperaria o Orbi fechar.
        $proc = Start-Process -FilePath $exe -PassThru
        $null = $proc.Handle
        $proc.WaitForExit()
        if ($proc.ExitCode -ne 0) {
            throw "O instalador terminou com o código $($proc.ExitCode)."
        }
        Write-Host ''
        Write-Host '  Pronto! O Orbi está instalado e fica na bandeja do Windows. Ctrl+Alt+O abre o painel.' -ForegroundColor Green
        Write-Host ''
    }
    catch {
        Write-Host ''
        Write-Host "  Não deu para instalar o Orbi: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "  Você também pode baixar direto em https://github.com/$repo/releases/latest"
        Write-Host ''
    }
    finally {
        Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
    }
}
