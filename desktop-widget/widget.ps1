Add-Type -AssemblyName PresentationFramework, System.Windows.Forms, System.Drawing
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$cfgPath = Join-Path $PSScriptRoot 'config.json'
$cfg = Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json

[xml]$xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        WindowStyle="None" AllowsTransparency="True" Background="Transparent"
        ShowInTaskbar="False" Topmost="False" SizeToContent="Height" Width="300"
        FlowDirection="RightToLeft" FontFamily="Segoe UI">
  <Border CornerRadius="12" Background="#E61E1E2A" Padding="14" BorderBrush="#44FFFFFF" BorderThickness="1">
    <StackPanel>
      <DockPanel>
        <TextBlock Text="✕" x:Name="Close" Foreground="#88FFFFFF" DockPanel.Dock="Left" Cursor="Hand" FontSize="13"/>
        <TextBlock Text="⟳" x:Name="Refresh" Foreground="#88FFFFFF" DockPanel.Dock="Left" Cursor="Hand" FontSize="14" Margin="8,0,0,0"/>
        <TextBlock Text="مراقبة مخزوني" Foreground="White" FontSize="16" FontWeight="Bold"/>
      </DockPanel>
      <TextBlock x:Name="Updated" Foreground="#88FFFFFF" FontSize="10" Margin="0,2,0,8"/>
      <TextBlock Text="الخدمات" Foreground="#7FB3FF" FontSize="12" FontWeight="SemiBold"/>
      <StackPanel x:Name="Services" Margin="0,4,0,10"/>
      <TextBlock Text="الدومين والشهادات" Foreground="#7FB3FF" FontSize="12" FontWeight="SemiBold"/>
      <StackPanel x:Name="Domains" Margin="0,4,0,10"/>
      <TextBlock Text="الاشتراكات" Foreground="#7FB3FF" FontSize="12" FontWeight="SemiBold"/>
      <StackPanel x:Name="Subs" Margin="0,4,0,0"/>
    </StackPanel>
  </Border>
</Window>
'@

$win = [Windows.Markup.XamlReader]::Load((New-Object System.Xml.XmlNodeReader $xaml))
$ui = @{}; 'Close','Refresh','Updated','Services','Domains','Subs' | ForEach-Object { $ui[$_] = $win.FindName($_) }

# position: top-right of screen, remember last spot
$posFile = Join-Path $env:APPDATA 'makhzouni-widget-pos.txt'
$wa = [System.Windows.SystemParameters]::WorkArea
$win.Left = $wa.Right - 320; $win.Top = $wa.Top + 20
if (Test-Path $posFile) { $p = (Get-Content $posFile) -split ','; $win.Left = [double]$p[0]; $win.Top = [double]$p[1] }
$win.Add_MouseLeftButtonDown({ $win.DragMove(); "$($win.Left),$($win.Top)" | Set-Content $posFile })

function Add-Row($panel, $dot, $name, $info) {
  $dp = New-Object System.Windows.Controls.DockPanel
  $dp.Margin = '0,2,0,2'
  $i = New-Object System.Windows.Controls.TextBlock
  $i.Text = $info; $i.Foreground = '#AAFFFFFF'; $i.FontSize = 11
  [System.Windows.Controls.DockPanel]::SetDock($i, 'Left')
  $d = New-Object System.Windows.Controls.TextBlock
  $d.Text = '● '; $d.Foreground = $dot; $d.FontSize = 12
  $n = New-Object System.Windows.Controls.TextBlock
  $n.Text = $name; $n.Foreground = 'White'; $n.FontSize = 12
  $sp = New-Object System.Windows.Controls.StackPanel; $sp.Orientation = 'Horizontal'
  [void]$sp.Children.Add($d); [void]$sp.Children.Add($n)
  [void]$dp.Children.Add($i); [void]$dp.Children.Add($sp)
  [void]$panel.Children.Add($dp)
}

function Color-ForDays($days) { if ($days -lt 0) { '#FF5252' } elseif ($days -le 14) { '#FF5252' } elseif ($days -le 30) { '#FFC107' } else { '#4CAF50' } }

$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = [System.Drawing.SystemIcons]::Information; $notify.Visible = $true; $notify.Text = 'مراقبة مخزوني'
$script:lastDown = @{}

function Get-SslDays($hostName) {
  try {
    $tcp = New-Object Net.Sockets.TcpClient($hostName, 443)
    $ssl = New-Object Net.Security.SslStream($tcp.GetStream(), $false, { $true })
    $ssl.AuthenticateAsClient($hostName)
    $exp = [datetime]$ssl.RemoteCertificate.GetExpirationDateString()
    $tcp.Close(); return [int]($exp - (Get-Date)).TotalDays
  } catch { return $null }
}

function Get-DomainDays($domain) {
  try {
    $r = Invoke-RestMethod "https://rdap.org/domain/$domain" -TimeoutSec 15
    $e = ($r.events | Where-Object { $_.eventAction -eq 'expiration' }).eventDate
    return [int](([datetime]$e) - (Get-Date)).TotalDays
  } catch { return $null }
}

function Update-All {
  foreach ($k in 'Services','Domains','Subs') { $ui[$k].Children.Clear() }

  foreach ($s in $cfg.services) {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    try {
      $r = Invoke-WebRequest $s.url -UseBasicParsing -TimeoutSec 10
      $ms = $sw.ElapsedMilliseconds
      $color = if ($ms -gt 2000) { '#FFC107' } else { '#4CAF50' }
      Add-Row $ui.Services $color $s.name "$($r.StatusCode) · ${ms}ms"
      $script:lastDown[$s.name] = $false
    } catch {
      $code = try { [int]$_.Exception.Response.StatusCode } catch { 0 }
      Add-Row $ui.Services '#FF5252' $s.name $(if ($code) { "خطأ $code" } else { 'واقف' })
      if (-not $script:lastDown[$s.name]) { $notify.ShowBalloonTip(8000, 'تنبيه: خدمة واقفة', "$($s.name) ما يستجيب", 'Error') }
      $script:lastDown[$s.name] = $true
    }
  }

  foreach ($d in $cfg.domains) {
    $dd = Get-DomainDays $d
    if ($null -ne $dd) { Add-Row $ui.Domains (Color-ForDays $dd) "دومين $d" "باقي $dd يوم" } else { Add-Row $ui.Domains '#9E9E9E' "دومين $d" 'غير معروف' }
    $sd = Get-SslDays $d
    if ($null -ne $sd) { Add-Row $ui.Domains (Color-ForDays $sd) "شهادة SSL" "باقي $sd يوم" } else { Add-Row $ui.Domains '#FF5252' "شهادة SSL" 'فشل الفحص' }
  }

  foreach ($sub in $cfg.subscriptions) {
    $days = [int](([datetime]$sub.renews) - (Get-Date).Date).TotalDays
    $txt = if ($days -lt 0) { "منتهي من $(-$days) يوم" } else { "باقي $days يوم" }
    Add-Row $ui.Subs (Color-ForDays $days) $sub.name $txt
  }

  $ui.Updated.Text = 'آخر تحديث: ' + (Get-Date -Format 'HH:mm:ss')
}

$ui.Close.Add_MouseLeftButtonUp({ $notify.Dispose(); $win.Close() })
$ui.Refresh.Add_MouseLeftButtonUp({ Update-All })

$timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromSeconds([int]$cfg.refreshSeconds)
$timer.Add_Tick({ Update-All })
$win.Add_ContentRendered({ Update-All; $timer.Start() })

[void]$win.ShowDialog()
