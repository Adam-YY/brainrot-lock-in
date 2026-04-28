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
    <Grid Margin="24"
          ClipToBounds="True">
      <Grid.ColumnDefinitions>
        <ColumnDefinition Width="*" />
        <ColumnDefinition Width="*" />
        <ColumnDefinition Width="*" />
      </Grid.ColumnDefinitions>

      <MediaElement x:Name="LeftVideo"
                    Grid.Column="0"
                    LoadedBehavior="Manual"
                    UnloadedBehavior="Manual"
                    Stretch="UniformToFill"
                    Opacity="0.92"
                    IsMuted="True"
                    RenderTransformOrigin="0.5,0.5">
        <MediaElement.LayoutTransform>
          <ScaleTransform ScaleX="-1"
                          ScaleY="1" />
        </MediaElement.LayoutTransform>
      </MediaElement>

      <MediaElement x:Name="CenterVideo"
                    Grid.Column="1"
                    LoadedBehavior="Manual"
                    UnloadedBehavior="Manual"
                    Stretch="UniformToFill"
                    Opacity="0.96"
                    IsMuted="True" />

      <MediaElement x:Name="RightVideo"
                    Grid.Column="2"
                    LoadedBehavior="Manual"
                    UnloadedBehavior="Manual"
                    Stretch="UniformToFill"
                    Opacity="0.92"
                    IsMuted="True"
                    RenderTransformOrigin="0.5,0.5">
        <MediaElement.LayoutTransform>
          <ScaleTransform ScaleX="-1"
                          ScaleY="1" />
        </MediaElement.LayoutTransform>
      </MediaElement>
    </Grid>

    <Border BorderBrush="#B3FF2B2B"
            BorderThickness="6"
            Margin="4" />

    <Grid Background="#66000000" />

    <Canvas x:Name="TextCanvas"
            Margin="24,24,24,120"
            IsHitTestVisible="False">
      <StackPanel x:Name="WarningBanner"
                  Width="1500">
        <TextBlock x:Name="WarningText1"
                   Text="LOCK BACK IN"
                   FontSize="128"
                   FontWeight="Black"
                   Foreground="#FFF1BE"
                   TextAlignment="Center"
                   TextWrapping="Wrap" />
        <TextBlock x:Name="WarningText2"
                   Text="LOCK BACK IN"
                   FontSize="128"
                   FontWeight="Black"
                   Foreground="#FFF1BE"
                   TextAlignment="Center"
                   TextWrapping="Wrap" />
        <TextBlock x:Name="LockBackInText"
                   Margin="0,18,0,0"
                   Text="LOCK BACK IN"
                   FontSize="60"
                   FontWeight="Bold"
                   Foreground="#FFFF7A7A"
                   TextAlignment="Center"
                   TextWrapping="Wrap" />
      </StackPanel>
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
$leftVideo = $window.FindName("LeftVideo")
$centerVideo = $window.FindName("CenterVideo")
$rightVideo = $window.FindName("RightVideo")
$textCanvas = $window.FindName("TextCanvas")
$warningBanner = $window.FindName("WarningBanner")
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
  if (-not $textCanvas -or -not $warningBanner) {
    return
  }

  $canvasWidth = [Math]::Max(0.0, $textCanvas.ActualWidth)
  $canvasHeight = [Math]::Max(0.0, $textCanvas.ActualHeight)
  $textWidth = [Math]::Max(0.0, $warningBanner.ActualWidth)
  $textHeight = [Math]::Max(0.0, $warningBanner.ActualHeight)

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

  [System.Windows.Controls.Canvas]::SetLeft($warningBanner, $script:textPosX)
  [System.Windows.Controls.Canvas]::SetTop($warningBanner, $script:textPosY)
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
  $leftVideo.Stop()
  $centerVideo.Stop()
  $rightVideo.Stop()
})

$null = $window.Add_ContentRendered({
  Start-VideoLoop -Element $leftVideo
  Start-VideoLoop -Element $centerVideo
  Start-VideoLoop -Element $rightVideo

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
