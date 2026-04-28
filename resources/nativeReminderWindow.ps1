param(
  [Parameter(Mandatory = $true)]
  [string]$VideoPath,

  [Parameter(Mandatory = $true)]
  [string]$AudioPath,

  [Parameter(Mandatory = $true)]
  [string]$DismissUrl
)

Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName WindowsBase

[xml]$xaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Tung Tung Lock-In"
        WindowStyle="None"
        ResizeMode="NoResize"
        WindowState="Maximized"
        Topmost="True"
        ShowInTaskbar="True"
        Background="#120103">
  <Grid Background="#120103">
    <MediaElement x:Name="BackgroundVideo"
                  LoadedBehavior="Manual"
                  UnloadedBehavior="Manual"
                  Stretch="UniformToFill"
                  Opacity="0.24"
                  IsMuted="True" />
    <MediaElement x:Name="ForegroundVideo"
                  LoadedBehavior="Manual"
                  UnloadedBehavior="Manual"
                  Stretch="Uniform"
                  Margin="24"
                  Opacity="0.95"
                  IsMuted="True" />

    <Border BorderBrush="#B3FF2B2B"
            BorderThickness="6"
            Margin="4" />

    <Grid Background="#66000000" />

    <Canvas x:Name="TextCanvas"
            Margin="24,24,24,120"
            IsHitTestVisible="False">
      <TextBlock x:Name="WarningText"
                 Width="1500"
                 Text="TUNG TUNG TUNG SAHUR"
                 FontSize="88"
                 FontWeight="Black"
                 Foreground="#FFF1BE"
                 TextAlignment="Center"
                 TextWrapping="Wrap" />
    </Canvas>

    <Button x:Name="DismissButton"
            Content="I AM BACK IN VS CODE"
            Width="320"
            Height="58"
            VerticalAlignment="Bottom"
            HorizontalAlignment="Center"
            Margin="0,0,0,32"
            Background="#FFFF3B3B"
            Foreground="White"
            FontSize="22"
            FontWeight="Bold"
            BorderBrush="#00FFFFFF" />
  </Grid>
</Window>
"@

$reader = New-Object System.Xml.XmlNodeReader $xaml
$window = [Windows.Markup.XamlReader]::Load($reader)
$backgroundVideo = $window.FindName("BackgroundVideo")
$foregroundVideo = $window.FindName("ForegroundVideo")
$textCanvas = $window.FindName("TextCanvas")
$warningText = $window.FindName("WarningText")
$dismissButton = $window.FindName("DismissButton")

$videoUri = [System.Uri]::new($VideoPath)
$audioUri = [System.Uri]::new($AudioPath)
$audioPlayer = [System.Windows.Media.MediaPlayer]::new()
$audioPlayer.Open($audioUri)
$audioPlayer.Volume = 1.0

$script:didDismiss = $false
$script:textPosX = 80.0
$script:textPosY = 48.0
$script:textVelX = 7.0
$script:textVelY = 5.5

function Update-WarningTextPosition {
  if (-not $textCanvas -or -not $warningText) {
    return
  }

  $canvasWidth = [Math]::Max(0.0, $textCanvas.ActualWidth)
  $canvasHeight = [Math]::Max(0.0, $textCanvas.ActualHeight)
  $textWidth = [Math]::Max(0.0, $warningText.ActualWidth)
  $textHeight = [Math]::Max(0.0, $warningText.ActualHeight)

  if ($canvasWidth -le 0 -or $canvasHeight -le 0 -or $textWidth -le 0 -or $textHeight -le 0) {
    return
  }

  $maxX = [Math]::Max(0.0, $canvasWidth - $textWidth)
  $maxY = [Math]::Max(0.0, $canvasHeight - $textHeight)

  $script:textPosX += $script:textVelX
  $script:textPosY += $script:textVelY

  if ($script:textPosX -le 0 -or $script:textPosX -ge $maxX) {
    $script:textVelX *= -1
    $script:textPosX = [Math]::Max(0.0, [Math]::Min($maxX, $script:textPosX))
  }

  if ($script:textPosY -le 0 -or $script:textPosY -ge $maxY) {
    $script:textVelY *= -1
    $script:textPosY = [Math]::Max(0.0, [Math]::Min($maxY, $script:textPosY))
  }

  [System.Windows.Controls.Canvas]::SetLeft($warningText, $script:textPosX)
  [System.Windows.Controls.Canvas]::SetTop($warningText, $script:textPosY)
}

function Send-DismissSignal {
  if ($script:didDismiss) {
    return
  }

  $script:didDismiss = $true

  try {
    Invoke-WebRequest -UseBasicParsing -Uri $DismissUrl -Method Post | Out-Null
  } catch {
  }
}

function Start-VideoLoop {
  param(
    [Parameter(Mandatory = $true)]
    [System.Windows.Controls.MediaElement]$Element
  )

  $Element.Source = $videoUri
  $null = $Element.add_MediaEnded({
    $this.Position = [System.TimeSpan]::Zero
    $this.Play()
  })

  $Element.Play()
}

$null = $dismissButton.Add_Click({
  Send-DismissSignal
  $window.Close()
})

$null = $window.Add_KeyDown({
  if ($_.Key -eq [System.Windows.Input.Key]::Escape) {
    Send-DismissSignal
    $window.Close()
  }
})

$null = $window.Add_Closing({
  Send-DismissSignal
  $audioPlayer.Stop()
  $foregroundVideo.Stop()
  $backgroundVideo.Stop()
})

$null = $window.Add_ContentRendered({
  Start-VideoLoop -Element $backgroundVideo
  Start-VideoLoop -Element $foregroundVideo

  $null = $audioPlayer.add_MediaEnded({
    $audioPlayer.Position = [System.TimeSpan]::Zero
    $audioPlayer.Play()
  })

  $audioPlayer.Play()
  $window.Activate()
  $window.Focus()
  $window.Topmost = $true
  Update-WarningTextPosition
})

$raiseTimer = [System.Windows.Threading.DispatcherTimer]::new()
$raiseTimer.Interval = [System.TimeSpan]::FromMilliseconds(1200)
$null = $raiseTimer.Add_Tick({
  try {
    $window.Topmost = $true
    $window.Activate()
    $window.Focus()
  } catch {
  }
})
$raiseTimer.Start()

$bounceTimer = [System.Windows.Threading.DispatcherTimer]::new()
$bounceTimer.Interval = [System.TimeSpan]::FromMilliseconds(16)
$null = $bounceTimer.Add_Tick({
  Update-WarningTextPosition
})
$bounceTimer.Start()

$null = $window.ShowDialog()
