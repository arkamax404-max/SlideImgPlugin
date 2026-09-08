<# Safe setup assistant. Never terminates Ulanzi Studio. #>
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidateSet('Assistant','Prepare','Apply')][string]$Mode,
  [Parameter(Mandatory=$true)][string]$PluginRoot,
  [string]$PressedKey='',
  [string]$SetupActionId='',
  [ValidateSet('install','repair','restore')][string]$Operation='install',
  [ValidateRange(30,3600)][int]$WaitTimeoutSeconds=900
)
Set-StrictMode -Version 2.0
$ErrorActionPreference='Stop'
$ActionUuid='com.arkamax.ulanzi.imageslide.slideshow'
$PluginUuid='com.arkamax.ulanzi.imageslide'
$PluginVersion='0.7.2'
$BuiltIn='com.ulanzi.ulanzideck.smallwindow.window'
$KnownCodes=@('PROFILE_NOT_FOUND','PROFILE_AMBIGUOUS','SETUP_INSTANCE_NOT_FOUND','PAGE_INVALID','SLOT_UNRELATED','SETTINGS_SCHEMA_UNSUPPORTED','REQUEST_WRITE_FAILED','PROFILE_STORE_UNREADABLE','MANIFEST_INVALID','COMPATIBILITY_UNSUPPORTED','HELPER_PROCESS_FAILED','REPREPARE_REQUIRED','RESTORE_BACKUP_NOT_FOUND','RESTORE_BACKUP_INVALID','RESTORED')
$KnownPhases=@('INITIALIZING','COMPATIBILITY','COMPAT_PLUGIN_ROOT','COMPAT_MANIFEST_READ','COMPAT_EXE_PATH','COMPAT_VERSION_READ','COMPAT_HASH_READ','COMPAT_ENV_PATHS','SETTINGS_READ','SETTINGS_SCHEMA','V2_ENUMERATION','V1_FALLBACK','DEVICE_PROFILE_MATCH','PAGE_READ','TARGET_RESOLUTION','RESTORE_RESOLUTION','SLOT_VALIDATION','REQUEST_WRITE','APPLY_PRECHECK','BACKUP','PATCH_WRITE','RESTORE_WRITE','READBACK','RECEIPT','RELAUNCH')
$KnownCategories=@('NONE','SCHEMA','IO','ACCESS','INTEGRITY','AMBIGUITY','COMPATIBILITY','PROCESS','UNEXPECTED')
$CurrentPhase='INITIALIZING'
$CurrentCategory='NONE'

function Full([string]$Path){[IO.Path]::GetFullPath($Path).TrimEnd('\')}
function SetPhase([string]$Phase){if($Phase-notin$KnownPhases){throw 'Invalid internal phase'};$script:CurrentPhase=$Phase}
function Fail([string]$Code,[string]$Category='UNEXPECTED'){if($Code-notin$KnownCodes){$Code='HELPER_PROCESS_FAILED'};if($Category-notin$KnownCategories){$Category='UNEXPECTED'};$script:CurrentCategory=$Category;throw ($Code+'|'+$Category)}
function Under([string]$Path,[string]$Root,[switch]$AllowRoot){$p=Full $Path;$r=Full $Root;$ok=$p.StartsWith($r+'\',[StringComparison]::OrdinalIgnoreCase);if($AllowRoot-and$p.Equals($r,[StringComparison]::OrdinalIgnoreCase)){$ok=$true};if(-not$ok){Fail 'HELPER_PROCESS_FAILED' 'INTEGRITY'};$p}
function Hash([string]$Path){HashFileDirect $Path}
function HashFileDirect([string]$Path){
  $stream=$null;$algorithm=$null
  try{
    $stream=New-Object IO.FileStream($Path,[IO.FileMode]::Open,[IO.FileAccess]::Read,([IO.FileShare]::ReadWrite-bor[IO.FileShare]::Delete))
    $algorithm=[Security.Cryptography.SHA256]::Create();$bytes=$algorithm.ComputeHash($stream)
    ([BitConverter]::ToString($bytes)).Replace('-','').ToLowerInvariant()
  }finally{
    if($null-ne$algorithm){$algorithm.Dispose()}
    if($null-ne$stream){$stream.Dispose()}
  }
}
function ReadJson([string]$Path,[string]$Code='SETTINGS_SCHEMA_UNSUPPORTED',[string]$Category='SCHEMA'){try{Get-Content -LiteralPath $Path -Raw -Encoding UTF8|ConvertFrom-Json}catch{Fail $Code $Category}}
function Required($Object,[string]$Name,[string]$Code='SETTINGS_SCHEMA_UNSUPPORTED',[string]$Category='SCHEMA'){if($null-eq$Object-or$null-eq$Object.PSObject-or$null-eq$Object.PSObject.Properties[$Name]){Fail $Code $Category};$Object.PSObject.Properties[$Name].Value}
function Optional($Object,[string]$Name){if($null-eq$Object-or$null-eq$Object.PSObject-or$null-eq$Object.PSObject.Properties[$Name]){return $null};$Object.PSObject.Properties[$Name].Value}
function WriteUtf8([string]$Path,[string]$Text){[IO.File]::WriteAllText($Path,$Text,(New-Object Text.UTF8Encoding($false)))}
function CanonicalJson($Object){$Object|ConvertTo-Json -Depth 30 -Compress}
function RequestHash([string]$Json){$bytes=(New-Object Text.UTF8Encoding($false)).GetBytes($Json);([BitConverter]::ToString((New-Object Security.Cryptography.SHA256Managed).ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}
function ValidNormalKey([string]$Key){$Key-match'^[0-9]{1,2}_[0-9]{1,2}$'-and$Key-ne'3_2'}
function ValidUuid([string]$Value){$Value-match'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'}
function ValidSafeSegment([string]$Value){-not[string]::IsNullOrWhiteSpace($Value)-and$Value.Length-le128-and$Value-ne'.'-and$Value-ne'..'-and$Value-match'^[A-Za-z0-9][A-Za-z0-9._-]*$'-and[IO.Path]::GetFileName($Value)-eq$Value}
function ActionIdHash([string]$Value){RequestHash $Value.ToLowerInvariant()}
function IdentityHash([string]$Value){RequestHash $Value.ToLowerInvariant()}
function CanonicalPair([string]$First,[string]$Second){$a=$First.ToLowerInvariant();$b=$Second.ToLowerInvariant();('a'+$a.Length+':'+$a+'|b'+$b.Length+':'+$b)}
function TargetIdentity($Target){
  $store=([string](Required $Target 'Store')).ToLowerInvariant();$group=([string](Required $Target 'GroupId')).ToLowerInvariant();$page=([string](Required $Target 'PageId')).ToLowerInvariant();$manifest=(Full ([string](Required $Target 'Manifest'))).ToLowerInvariant()
  ('s'+$store.Length+':'+$store+'|g'+$group.Length+':'+$group+'|p'+$page.Length+':'+$page+'|m'+$manifest.Length+':'+$manifest)
}
function UniqueTargets($Targets){$seen=@{};$unique=@();foreach($target in @($Targets)){$key=TargetIdentity $target;if(-not$seen.ContainsKey($key)){$seen[$key]=$true;$unique+=,$target}};@($unique)}
function LargeDisplayControllers($Document){
  $controllers=@(Required $Document 'Controllers' 'PAGE_INVALID' 'SCHEMA');$matches=@()
  foreach($controller in $controllers){if([string](Optional $controller 'Type')-ne'Keypad'){continue};$actions=Optional $controller 'Actions';if($null-ne$actions-and$null-ne(Optional $actions '3_2')){$matches+=,$controller}}
  @($matches)
}
function SetupInstanceControllers($Document,[string]$Key){
  $controllers=@(Required $Document 'Controllers' 'PAGE_INVALID' 'SCHEMA');$matches=@()
  foreach($controller in $controllers){if([string](Optional $controller 'Type')-ne'Keypad'){continue};$actions=Optional $controller 'Actions';if($null-ne$actions-and$null-ne(Optional $actions $Key)){$matches+=,$controller}}
  @($matches)
}
function StudioRunning{@(Get-Process -Name UlanziDeck -ErrorAction SilentlyContinue).Count-gt 0}
$diagnosticPath=$null
function WriteDiagnostic([string]$Status,[string]$Code,[string]$Phase,[string]$Category='NONE'){
  if($null-eq$diagnosticPath){return}
  if($Phase-notin$KnownPhases){$Phase='INITIALIZING'};if($Category-notin$KnownCategories){$Category='UNEXPECTED'}
  $record=[ordered]@{schema='com.arkamax.ulanzi.imageslide.setup-diagnostic/v3';status=$Status;code=$Code;phase=$Phase;timestampUtc=[DateTime]::UtcNow.ToString('o');category=$Category}
  $recordBindingHash=$(if(ValidUuid $SetupActionId){ActionIdHash $SetupActionId}else{$variable=Get-Variable -Name bindingHash -Scope Script -ErrorAction SilentlyContinue;if($null-ne$variable){[string]$variable.Value}else{''}})
  if((ValidNormalKey $PressedKey)-and$recordBindingHash-match'^[0-9a-f]{64}$'){$record['setupKey']=$PressedKey;$record['setupActionIdSha256']=$recordBindingHash}
  try{WriteUtf8 $diagnosticPath ($record|ConvertTo-Json -Depth 4)}catch{}
}

function FindStoreMatches([string]$StoreName,[string]$Key,[string]$ExpectedActionIdHash){
  if($StoreName-notin@('ProfilesV2','ProfilesV1')){Fail 'SETTINGS_SCHEMA_UNSUPPORTED' 'SCHEMA'}
  SetPhase ($(if($StoreName-eq'ProfilesV2'){'V2_ENUMERATION'}else{'V1_FALLBACK'}))
  $store=Under (Join-Path $base $StoreName) $base
  if(-not(Test-Path -LiteralPath $store -PathType Container)){return @()}
  try{$groups=@(Get-ChildItem -LiteralPath $store -Directory -ErrorAction Stop)}catch{Fail 'PROFILE_STORE_UNREADABLE' 'ACCESS'}
  $matches=@()
  foreach($device in $devices){
    SetPhase 'DEVICE_PROFILE_MATCH';$profile=[string](Required $device 'CurrentProfile');$deviceId=[string](Required $device 'CurrentDevice')
    if([string]::IsNullOrWhiteSpace($profile)-or[string]::IsNullOrWhiteSpace($deviceId)){continue}
    foreach($group in $groups){
      $groupRoot=Under ([string](Required $group 'FullName' 'PROFILE_STORE_UNREADABLE' 'IO')) $store;$groupManifest=Under (Join-Path $groupRoot 'manifest.json') $groupRoot
      if(-not(Test-Path -LiteralPath $groupManifest -PathType Leaf)){continue}
      $gm=ReadJson $groupManifest 'MANIFEST_INVALID' 'SCHEMA';$name=[string](Required $gm 'Name' 'MANIFEST_INVALID' 'SCHEMA')
      if($name-ne$profile){continue}
      $deviceNode=Required $gm 'Device' 'MANIFEST_INVALID' 'SCHEMA';$uuid=[string](Required $deviceNode 'UUID' 'MANIFEST_INVALID' 'SCHEMA');$model=[string](Required $deviceNode 'Model' 'MANIFEST_INVALID' 'SCHEMA')
      if($uuid-ne$deviceId-or$model-ne'D200'){continue}
      SetPhase 'PAGE_READ';$pages=Required $gm 'Pages' 'PAGE_INVALID' 'SCHEMA';$page=[string](Required $pages 'Current' 'PAGE_INVALID' 'SCHEMA');$pageList=@(Required $pages 'Pages' 'PAGE_INVALID' 'SCHEMA');$groupId=[string](Required $group 'Name' 'PROFILE_STORE_UNREADABLE' 'IO')
      if(-not(ValidSafeSegment $groupId)-or-not(ValidSafeSegment $page)-or$page-notin$pageList){Fail 'PAGE_INVALID' 'SCHEMA'}
      $pageRoot=Under (Join-Path $groupRoot ('Profiles\'+$page)) $groupRoot;$pageManifest=Under (Join-Path $pageRoot 'manifest.json') $pageRoot
      if(-not(Test-Path -LiteralPath $pageManifest -PathType Leaf)){Fail 'PAGE_INVALID' 'IO'}
      $pm=ReadJson $pageManifest 'MANIFEST_INVALID' 'SCHEMA';$setupControllers=@(SetupInstanceControllers $pm $Key)
      if($setupControllers.Count-gt1){Fail 'PAGE_INVALID' 'SCHEMA'};if($setupControllers.Count-eq0){continue}
      $setupActions=Required $setupControllers[0] 'Actions' 'PAGE_INVALID' 'SCHEMA';$setupEntry=Required $setupActions $Key 'PAGE_INVALID' 'SCHEMA';$setupAction=[string](Required $setupEntry 'Action' 'PAGE_INVALID' 'SCHEMA');$setupId=[string](Required $setupEntry 'ActionID' 'PAGE_INVALID' 'SCHEMA')
      if($setupAction-ne'com.arkamax.ulanzi.imageslide.setup'-or-not(ValidUuid $setupId)-or(ActionIdHash $setupId)-ne$ExpectedActionIdHash){continue}
      $largeControllers=@(LargeDisplayControllers $pm)
      if($largeControllers.Count-ne1){Fail 'PAGE_INVALID' 'SCHEMA'}
      $matches+=,[pscustomobject]@{Store=$StoreName;GroupId=$groupId;PageId=$page;Manifest=$pageManifest;RootManifest=$groupManifest;ProfileName=$name;DeviceUuid=$uuid;DeviceModel=$model}
    }
  }
  @($matches)
}

function ResolveTarget([string]$Key,[string]$ExpectedActionIdHash) {
  if(-not(ValidNormalKey $Key)-or$ExpectedActionIdHash-notmatch'^[0-9a-f]{64}$'){Fail 'SETUP_INSTANCE_NOT_FOUND' 'SCHEMA'}
  SetPhase 'SETTINGS_READ';if(-not(Test-Path -LiteralPath $setting -PathType Leaf)){Fail 'SETTINGS_SCHEMA_UNSUPPORTED' 'IO'}
  $state=ReadJson $setting;SetPhase 'SETTINGS_SCHEMA';$rawDevices=@(Required $state 'Devices')
  if($rawDevices.Count-eq0){Fail 'SETTINGS_SCHEMA_UNSUPPORTED' 'SCHEMA'}
  $seenDevices=@{};$script:devices=@();foreach($device in $rawDevices){$profile=[string](Required $device 'CurrentProfile');$deviceId=[string](Required $device 'CurrentDevice');$deviceKey=CanonicalPair $deviceId $profile;if(-not$seenDevices.ContainsKey($deviceKey)){$seenDevices[$deviceKey]=$true;$script:devices+=,$device}}
  $v2=@(UniqueTargets @(FindStoreMatches 'ProfilesV2' $Key $ExpectedActionIdHash));SetPhase 'TARGET_RESOLUTION'
  if($v2.Count-gt1){Fail 'PROFILE_AMBIGUOUS' 'AMBIGUITY'}
  if($v2.Count-eq1){$target=$v2[0]}else{$v1=@(UniqueTargets @(FindStoreMatches 'ProfilesV1' $Key $ExpectedActionIdHash));SetPhase 'TARGET_RESOLUTION';if($v1.Count-gt1){Fail 'PROFILE_AMBIGUOUS' 'AMBIGUITY'};if($v1.Count-eq1){$target=$v1[0]}else{Fail 'SETUP_INSTANCE_NOT_FOUND' 'SCHEMA'}}
  SetPhase 'SLOT_VALIDATION';$selected=ReadJson $target.Manifest 'MANIFEST_INVALID' 'SCHEMA';$largeControllers=@(LargeDisplayControllers $selected);if($largeControllers.Count-ne1){Fail 'PAGE_INVALID' 'SCHEMA'}
  $actions=Required $largeControllers[0] 'Actions' 'PAGE_INVALID' 'SCHEMA';$entry=Required $actions '3_2' 'PAGE_INVALID' 'SCHEMA';$action=[string](Required $entry 'Action' 'PAGE_INVALID' 'SCHEMA')
  $kind=if($action-eq$ActionUuid){'restore'}elseif($action-eq$BuiltIn){'patch'}else{'refuse-unrelated'};if($kind-eq'refuse-unrelated'){Fail 'SLOT_UNRELATED' 'INTEGRITY'}
  $target|Add-Member -NotePropertyName 'Kind' -NotePropertyValue $kind -Force;return $target
}

function ReceiptTargetMatches($Receipt,$Target){
  $rt=Optional $Receipt 'target';if($null-eq$rt){return $false}
  ([string](Optional $rt 'store')-eq$Target.Store-and[string](Optional $rt 'groupId')-eq$Target.GroupId-and[string](Optional $rt 'pageId')-eq$Target.PageId-and[string](Optional $rt 'key')-eq'3_2')
}
function NewSlideshowEntry([string]$ActionId){
  [ordered]@{Action=$ActionUuid;ActionID=$ActionId;ActionParam=[ordered]@{SmallViewMode=2};LinkedTitle=$true;Name='Image Slideshow';Plugin=[ordered]@{Name='Image Slideshow';UUID=$PluginUuid;Version=$PluginVersion};State=0;ViewParam=@([ordered]@{Icon='';IconRel='';Name='Image Slideshow'})}
}
function CloneJson($Value){($Value|ConvertTo-Json -Depth 30)|ConvertFrom-Json}
function CenterFingerprint($Center){
  try{$copy=CloneJson $Center;$actionId=[string](Required $copy 'ActionID' 'PAGE_INVALID' 'SCHEMA');if([string](Required $copy 'Action' 'PAGE_INVALID' 'SCHEMA')-ne$ActionUuid-or-not(ValidUuid $actionId)){return $null};$expected=NewSlideshowEntry $actionId;$plugin=Optional $copy 'Plugin';if($null-eq$plugin){return $null};$pluginJson=CanonicalJson $plugin;$expectedPluginJson=CanonicalJson $expected.Plugin;if($pluginJson-ne$expectedPluginJson-and$pluginJson-ne'{}'){return $null};$copy.Plugin=[pscustomobject]@{};$expected.Plugin=[pscustomobject]@{};if((CanonicalJson $copy)-ne(CanonicalJson $expected)){return $null};RequestHash (CanonicalJson $copy)}catch{return $null}
}
function NormalizedPatchedPage($Document,[string]$SetupKey){
  try{
    $copy=CloneJson $Document;$large=@(LargeDisplayControllers $copy);if($large.Count-ne1){return $null};$actions=Required $large[0] 'Actions' 'PAGE_INVALID' 'SCHEMA';$center=Required $actions '3_2' 'PAGE_INVALID' 'SCHEMA';$actionId=[string](Required $center 'ActionID' 'PAGE_INVALID' 'SCHEMA');if([string](Required $center 'Action' 'PAGE_INVALID' 'SCHEMA')-ne$ActionUuid-or-not(ValidUuid $actionId)){return $null}
    $expected=NewSlideshowEntry $actionId;$plugin=Optional $center 'Plugin';if($null-eq$plugin){return $null};$pluginJson=CanonicalJson $plugin;$expectedPluginJson=CanonicalJson $expected.Plugin;if($pluginJson-ne$expectedPluginJson-and$pluginJson-ne'{}'){return $null};$center.Plugin=[pscustomobject]@{};$expected.Plugin=[pscustomobject]@{};if((CanonicalJson $center)-ne(CanonicalJson $expected)){return $null}
    $setupControllers=@(SetupInstanceControllers $copy $SetupKey);if($setupControllers.Count-ne1){return $null};$setupActions=Required $setupControllers[0] 'Actions' 'PAGE_INVALID' 'SCHEMA';$setupEntry=Required $setupActions $SetupKey 'PAGE_INVALID' 'SCHEMA';if([string](Required $setupEntry 'Action' 'PAGE_INVALID' 'SCHEMA')-ne'com.arkamax.ulanzi.imageslide.setup'){return $null};$params=Optional $setupEntry 'ActionParam'
    if($null-ne$params){$operation=Optional $params 'operation';if($null-ne$operation){if([string]$operation-notin@('install','repair','restore')){return $null};$params.PSObject.Properties.Remove('operation')};if(@($params.PSObject.Properties).Count-ne0){return $null};$setupEntry.PSObject.Properties.Remove('ActionParam')}
    CanonicalJson $copy
  }catch{return $null}
}
function CurrentMatchesPatchedReceipt($Receipt,[string]$BackupPath,[string]$CurrentPath,[string]$SetupKey){
  try{
    $expected=ReadJson $BackupPath 'RESTORE_BACKUP_INVALID' 'INTEGRITY';$current=ReadJson $CurrentPath 'RESTORE_BACKUP_INVALID' 'INTEGRITY';$currentPads=@(LargeDisplayControllers $current);if($currentPads.Count-ne1){return $false};$currentActions=Required $currentPads[0] 'Actions' 'PAGE_INVALID' 'SCHEMA';$currentCenter=Required $currentActions '3_2' 'PAGE_INVALID' 'SCHEMA';$actionId=[string](Required $currentCenter 'ActionID' 'PAGE_INVALID' 'SCHEMA');if(-not(ValidUuid $actionId)){return $false}
    $expectedPads=@(LargeDisplayControllers $expected);if($expectedPads.Count-ne1){return $false};$expectedActions=Required $expectedPads[0] 'Actions' 'PAGE_INVALID' 'SCHEMA';$beforeCenter=Required $expectedActions '3_2' 'PAGE_INVALID' 'SCHEMA';if([string](Required $beforeCenter 'Action' 'PAGE_INVALID' 'SCHEMA')-ne$BuiltIn){return $false};$expectedActions|Add-Member -NotePropertyName '3_2' -NotePropertyValue (NewSlideshowEntry $actionId) -Force
    $fingerprint=Optional $Receipt 'centerActionFingerprintSha256';if($null-ne$fingerprint-and([string]$fingerprint-notmatch'^[0-9a-f]{64}$'-or[string]$fingerprint-ne(CenterFingerprint $currentCenter))){return $false};$normalizedCurrent=NormalizedPatchedPage $current $SetupKey;$normalizedExpected=NormalizedPatchedPage $expected $SetupKey;$null-ne$normalizedCurrent-and$normalizedCurrent-eq$normalizedExpected
  }catch{return $false}
}
function FindRestoreCandidate($Target){
  SetPhase 'RESTORE_RESOLUTION';if(-not(Test-Path -LiteralPath $backupRoot -PathType Container)){Fail 'RESTORE_BACKUP_NOT_FOUND' 'INTEGRITY'}
  try{$runs=@(Get-ChildItem -LiteralPath $backupRoot -Directory -ErrorAction Stop)}catch{Fail 'RESTORE_BACKUP_NOT_FOUND' 'ACCESS'};$legacyCandidates=@();$fingerprintedCandidates=@()
  foreach($run in $runs){
    $runId=[string](Optional $run 'Name');if(-not(ValidSafeSegment $runId)){continue};$runRoot=Under ([string](Optional $run 'FullName')) $backupRoot;$receiptPath=Under (Join-Path $runRoot 'receipt.json') $runRoot;$backupPath=Under (Join-Path $runRoot 'manifest.before.json') $runRoot
    if(-not(Test-Path -LiteralPath $receiptPath -PathType Leaf)-or-not(Test-Path -LiteralPath $backupPath -PathType Leaf)){continue};try{$receipt=Get-Content -LiteralPath $receiptPath -Raw -Encoding UTF8|ConvertFrom-Json}catch{continue}
    if([string](Optional $receipt 'schema')-ne'com.arkamax.ulanzi.imageslide.setup-receipt/v1'-or[string](Optional $receipt 'operation')-notin@('apply-or-repair','patch')-or[string](Optional $receipt 'result')-ne'success'-or[string](Optional $receipt 'action')-ne$ActionUuid-or-not(ReceiptTargetMatches $receipt $Target)){continue}
    $before=[string](Optional $receipt 'beforeSha256');$after=[string](Optional $receipt 'afterSha256');$backupHash=[string](Optional $receipt 'backupSha256');if($before-notmatch'^[0-9a-f]{64}$'-or$after-notmatch'^[0-9a-f]{64}$'-or$backupHash-ne$before-or$before-eq$after){continue}
    if((Hash $backupPath)-ne$backupHash){continue};$currentHash=Hash $Target.Manifest;$fingerprint=Optional $receipt 'centerActionFingerprintSha256';if($null-ne$fingerprint){if(-not(CurrentMatchesPatchedReceipt $receipt $backupPath $Target.Manifest $PressedKey)){continue}}elseif($currentHash-ne$after-and-not(CurrentMatchesPatchedReceipt $receipt $backupPath $Target.Manifest $PressedKey)){continue};$candidate=[pscustomobject]@{RunId=$runId;Receipt=$receiptPath;Backup=$backupPath;ReceiptSha256=(Hash $receiptPath);BeforeSha256=$before;AfterSha256=$after;BackupSha256=$backupHash};if($null-ne$fingerprint){$fingerprintedCandidates+=,$candidate}else{$legacyCandidates+=,$candidate}
  }
  $candidates=@($legacyCandidates);if(@($fingerprintedCandidates).Count-gt0){$candidates=@($fingerprintedCandidates)};if(@($candidates).Count-eq0){Fail 'RESTORE_BACKUP_NOT_FOUND' 'INTEGRITY'};if(@($candidates).Count-gt1){Fail 'PROFILE_AMBIGUOUS' 'AMBIGUITY'};return @($candidates)[0]
}
function ResolveRequestedRestore($Target,$Restore){
  SetPhase 'RESTORE_RESOLUTION';$runId=[string](Required $Restore 'runId' 'RESTORE_BACKUP_INVALID' 'INTEGRITY');if(-not(ValidSafeSegment $runId)){Fail 'RESTORE_BACKUP_INVALID' 'INTEGRITY'}
  $runRoot=Under (Join-Path $backupRoot $runId) $backupRoot;$receiptPath=Under (Join-Path $runRoot 'receipt.json') $runRoot;$backupPath=Under (Join-Path $runRoot 'manifest.before.json') $runRoot;if(-not(Test-Path $receiptPath)-or-not(Test-Path $backupPath)){Fail 'RESTORE_BACKUP_NOT_FOUND' 'INTEGRITY'}
  $receiptSha=[string](Required $Restore 'receiptSha256' 'RESTORE_BACKUP_INVALID' 'INTEGRITY');$backupSha=[string](Required $Restore 'backupSha256' 'RESTORE_BACKUP_INVALID' 'INTEGRITY');$before=[string](Required $Restore 'beforeSha256' 'RESTORE_BACKUP_INVALID' 'INTEGRITY');$after=[string](Required $Restore 'afterSha256' 'RESTORE_BACKUP_INVALID' 'INTEGRITY');if(@($receiptSha,$backupSha,$before,$after)|Where-Object{$_-notmatch'^[0-9a-f]{64}$'}){Fail 'RESTORE_BACKUP_INVALID' 'INTEGRITY'}
  if((Hash $receiptPath)-ne$receiptSha-or(Hash $backupPath)-ne$backupSha-or$backupSha-ne$before-or$before-eq$after){Fail 'RESTORE_BACKUP_INVALID' 'INTEGRITY'}
  $receipt=ReadJson $receiptPath 'RESTORE_BACKUP_INVALID' 'INTEGRITY';if([string](Required $receipt 'schema' 'RESTORE_BACKUP_INVALID' 'INTEGRITY')-ne'com.arkamax.ulanzi.imageslide.setup-receipt/v1'-or[string](Required $receipt 'operation' 'RESTORE_BACKUP_INVALID' 'INTEGRITY')-notin@('apply-or-repair','patch')-or[string](Required $receipt 'result' 'RESTORE_BACKUP_INVALID' 'INTEGRITY')-ne'success'-or[string](Required $receipt 'action' 'RESTORE_BACKUP_INVALID' 'INTEGRITY')-ne$ActionUuid-or-not(ReceiptTargetMatches $receipt $Target)-or[string](Required $receipt 'beforeSha256' 'RESTORE_BACKUP_INVALID' 'INTEGRITY')-ne$before-or[string](Required $receipt 'afterSha256' 'RESTORE_BACKUP_INVALID' 'INTEGRITY')-ne$after-or[string](Required $receipt 'backupSha256' 'RESTORE_BACKUP_INVALID' 'INTEGRITY')-ne$backupSha){Fail 'RESTORE_BACKUP_INVALID' 'INTEGRITY'};$currentHash=Hash $Target.Manifest;$fingerprint=Optional $receipt 'centerActionFingerprintSha256';if($null-ne$fingerprint){if(-not(CurrentMatchesPatchedReceipt $receipt $backupPath $Target.Manifest $PressedKey)){Fail 'RESTORE_BACKUP_INVALID' 'INTEGRITY'}}elseif($currentHash-ne$after-and-not(CurrentMatchesPatchedReceipt $receipt $backupPath $Target.Manifest $PressedKey)){Fail 'RESTORE_BACKUP_INVALID' 'INTEGRITY'}
  [pscustomobject]@{RunId=$runId;Receipt=$receiptPath;Backup=$backupPath;BeforeSha256=$before;AfterSha256=$after;BackupSha256=$backupSha}
}

function ResolveRequestedTarget($Request,[string]$Key,[string]$ExpectedActionIdHash) {
  SetPhase 'TARGET_RESOLUTION'
  if(-not(ValidNormalKey $Key)-or$ExpectedActionIdHash-notmatch'^[0-9a-f]{64}$'){Fail 'SETUP_INSTANCE_NOT_FOUND' 'INTEGRITY'}
  $storeName=[string](Required $Request 'store' 'HELPER_PROCESS_FAILED' 'INTEGRITY');$groupId=[string](Required $Request 'groupId' 'HELPER_PROCESS_FAILED' 'INTEGRITY');$pageId=[string](Required $Request 'pageId' 'HELPER_PROCESS_FAILED' 'INTEGRITY')
  if($storeName-notin@('ProfilesV2','ProfilesV1')-or-not(ValidSafeSegment $groupId)-or-not(ValidSafeSegment $pageId)){Fail 'PROFILE_NOT_FOUND' 'INTEGRITY'}
  $store=Under (Join-Path $base $storeName) $base;$groupRoot=Under (Join-Path $store $groupId) $store
  if(-not(Test-Path -LiteralPath $groupRoot -PathType Container)){Fail 'PROFILE_NOT_FOUND' 'IO'}
  $rootManifest=Under (Join-Path $groupRoot 'manifest.json') $groupRoot;if(-not(Test-Path -LiteralPath $rootManifest -PathType Leaf)){Fail 'MANIFEST_INVALID' 'IO'}
  $expectedRootHash=[string](Required $Request 'rootManifestSha256' 'HELPER_PROCESS_FAILED' 'INTEGRITY');if($expectedRootHash-notmatch'^[0-9a-f]{64}$'-or(Hash $rootManifest)-ne$expectedRootHash){Fail 'MANIFEST_INVALID' 'INTEGRITY'}
  SetPhase 'DEVICE_PROFILE_MATCH';$root=ReadJson $rootManifest 'MANIFEST_INVALID' 'SCHEMA';$name=[string](Required $root 'Name' 'MANIFEST_INVALID' 'SCHEMA');$deviceNode=Required $root 'Device' 'MANIFEST_INVALID' 'SCHEMA';$deviceUuid=[string](Required $deviceNode 'UUID' 'MANIFEST_INVALID' 'SCHEMA');$model=[string](Required $deviceNode 'Model' 'MANIFEST_INVALID' 'SCHEMA')
  $expectedNameHash=[string](Required $Request 'profileNameSha256' 'HELPER_PROCESS_FAILED' 'INTEGRITY');$expectedDeviceHash=[string](Required $Request 'deviceUuidSha256' 'HELPER_PROCESS_FAILED' 'INTEGRITY')
  if($model-ne'D200'-or(IdentityHash $name)-ne$expectedNameHash-or(IdentityHash $deviceUuid)-ne$expectedDeviceHash){Fail 'PROFILE_NOT_FOUND' 'INTEGRITY'}
  $state=ReadJson $setting;SetPhase 'SETTINGS_SCHEMA';$currentDevices=@(Required $state 'Devices');$activeMatches=@($currentDevices|Where-Object{(IdentityHash ([string](Required $_ 'CurrentProfile')))-eq$expectedNameHash-and(IdentityHash ([string](Required $_ 'CurrentDevice')))-eq$expectedDeviceHash});if($activeMatches.Count-eq0){Fail 'PROFILE_NOT_FOUND' 'SCHEMA'}
  SetPhase 'PAGE_READ';$pages=Required $root 'Pages' 'PAGE_INVALID' 'SCHEMA';$current=[string](Required $pages 'Current' 'PAGE_INVALID' 'SCHEMA');$pageList=@(Required $pages 'Pages' 'PAGE_INVALID' 'SCHEMA');if($current-ne$pageId-or$pageId-notin$pageList){Fail 'PAGE_INVALID' 'INTEGRITY'}
  $pageRoot=Under (Join-Path $groupRoot ('Profiles\'+$pageId)) $groupRoot;$derivedManifest=Under (Join-Path $pageRoot 'manifest.json') $pageRoot;$requestedManifest=Full ([string](Required $Request 'manifestPath' 'HELPER_PROCESS_FAILED' 'INTEGRITY'));if($derivedManifest-ne$requestedManifest){Fail 'PAGE_INVALID' 'INTEGRITY'}
  if(-not(Test-Path -LiteralPath $derivedManifest -PathType Leaf)){Fail 'PAGE_INVALID' 'IO'};$expectedPageHash=[string](Required $Request 'manifestSha256' 'HELPER_PROCESS_FAILED' 'INTEGRITY');if($expectedPageHash-notmatch'^[0-9a-f]{64}$'-or(Hash $derivedManifest)-ne$expectedPageHash){Fail 'PAGE_INVALID' 'INTEGRITY'}
  $page=ReadJson $derivedManifest 'MANIFEST_INVALID' 'SCHEMA';$setupControllers=@(SetupInstanceControllers $page $Key);if($setupControllers.Count-ne1){Fail 'SETUP_INSTANCE_NOT_FOUND' 'INTEGRITY'};$setupActions=Required $setupControllers[0] 'Actions' 'PAGE_INVALID' 'SCHEMA';$setupEntry=Required $setupActions $Key 'PAGE_INVALID' 'SCHEMA';$setupAction=[string](Required $setupEntry 'Action' 'PAGE_INVALID' 'SCHEMA');$setupId=[string](Required $setupEntry 'ActionID' 'PAGE_INVALID' 'SCHEMA');if($setupAction-ne'com.arkamax.ulanzi.imageslide.setup'-or-not(ValidUuid $setupId)-or(ActionIdHash $setupId)-ne$ExpectedActionIdHash){Fail 'SETUP_INSTANCE_NOT_FOUND' 'INTEGRITY'}
  SetPhase 'SLOT_VALIDATION';$largeControllers=@(LargeDisplayControllers $page);if($largeControllers.Count-ne1){Fail 'PAGE_INVALID' 'SCHEMA'};$actions=Required $largeControllers[0] 'Actions' 'PAGE_INVALID' 'SCHEMA';$entry=Required $actions '3_2' 'PAGE_INVALID' 'SCHEMA';$action=[string](Required $entry 'Action' 'PAGE_INVALID' 'SCHEMA');$kind=if($action-eq$ActionUuid){'restore'}elseif($action-eq$BuiltIn){'patch'}else{'refuse-unrelated'};if($kind-eq'refuse-unrelated'){Fail 'SLOT_UNRELATED' 'INTEGRITY'}
  [pscustomobject]@{Store=$storeName;GroupId=$groupId;PageId=$pageId;Manifest=$derivedManifest;Kind=$kind}
}

if($Mode-eq'Assistant'){
  $scriptPath=$MyInvocation.MyCommand.Path
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $scriptPath -Mode Prepare -Operation $Operation -PluginRoot $PluginRoot -PressedKey $PressedKey -SetupActionId $SetupActionId
  if($LASTEXITCODE-ne0){exit $LASTEXITCODE}
  $deadline=[DateTime]::UtcNow.AddSeconds($WaitTimeoutSeconds)
  while(StudioRunning){
    if([DateTime]::UtcNow-ge$deadline){
      try{$stateRoot=Full (Join-Path $env:LOCALAPPDATA 'Arkamax\ImageSlidePlugin');[IO.Directory]::CreateDirectory($stateRoot)|Out-Null;$diagnosticPath=Join-Path $stateRoot 'last-diagnostic.json';WriteDiagnostic 'failed' 'HELPER_PROCESS_FAILED' 'APPLY_PRECHECK' 'PROCESS'}catch{}
      Write-Error 'IMAGESLIDE_DIAGNOSTIC:HELPER_PROCESS_FAILED:APPLY_PRECHECK:PROCESS';exit 1
    }
    Start-Sleep -Milliseconds 500
  }
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $scriptPath -Mode Apply -PluginRoot $PluginRoot
  exit $LASTEXITCODE
}

$exitCode=0
try{
  SetPhase 'INITIALIZING'
  $stateRoot=Full (Join-Path $env:LOCALAPPDATA 'Arkamax\ImageSlidePlugin')
  try{[IO.Directory]::CreateDirectory($stateRoot)|Out-Null;$diagnosticPath=Under (Join-Path $stateRoot 'last-diagnostic.json') $stateRoot;WriteDiagnostic 'started' 'PREPARING' $CurrentPhase}catch{Write-Error 'IMAGESLIDE_DIAGNOSTIC:REQUEST_WRITE_FAILED:INITIALIZING:ACCESS';exit 1}
  SetPhase 'COMPAT_PLUGIN_ROOT';WriteDiagnostic 'started' 'PREPARING' $CurrentPhase
  try{$PluginRoot=Full $PluginRoot;$HelperRoot=Under (Join-Path $PluginRoot 'helper') $PluginRoot;$compatPath=Under (Join-Path $HelperRoot 'compatibility.json') $HelperRoot}catch{Fail 'COMPATIBILITY_UNSUPPORTED' 'IO'}
  SetPhase 'COMPAT_MANIFEST_READ';WriteDiagnostic 'started' 'PREPARING' $CurrentPhase
  try{$compat=ReadJson $compatPath 'COMPATIBILITY_UNSUPPORTED' 'SCHEMA';if([string](Required $compat 'schema' 'COMPATIBILITY_UNSUPPORTED' 'SCHEMA')-ne'com.arkamax.ulanzi.imageslide.compatibility/v1'){Fail 'COMPATIBILITY_UNSUPPORTED' 'SCHEMA'};$studioNode=Required $compat 'studio' 'COMPATIBILITY_UNSUPPORTED' 'SCHEMA';$stateNode=Required $compat 'state' 'COMPATIBILITY_UNSUPPORTED' 'SCHEMA'}catch{Fail 'COMPATIBILITY_UNSUPPORTED' 'SCHEMA'}
  SetPhase 'COMPAT_EXE_PATH';WriteDiagnostic 'started' 'PREPARING' $CurrentPhase
  try{$studio=Full ([string](Required $studioNode 'path' 'COMPATIBILITY_UNSUPPORTED' 'SCHEMA'));if(-not(Test-Path -LiteralPath $studio -PathType Leaf)){Fail 'COMPATIBILITY_UNSUPPORTED' 'IO'}}catch{Fail 'COMPATIBILITY_UNSUPPORTED' 'IO'}
  SetPhase 'COMPAT_VERSION_READ';WriteDiagnostic 'started' 'PREPARING' $CurrentPhase
  try{$actualVersion=[Diagnostics.FileVersionInfo]::GetVersionInfo($studio).FileVersion;$expectedVersion=[string](Required $studioNode 'fileVersion' 'COMPATIBILITY_UNSUPPORTED' 'SCHEMA');if([string]::IsNullOrWhiteSpace($actualVersion)-or$actualVersion-ne$expectedVersion){Fail 'COMPATIBILITY_UNSUPPORTED' 'COMPATIBILITY'}}catch{Fail 'COMPATIBILITY_UNSUPPORTED' 'COMPATIBILITY'}
  SetPhase 'COMPAT_HASH_READ';WriteDiagnostic 'started' 'PREPARING' $CurrentPhase
  try{$actualHash=HashFileDirect $studio;$expectedHash=[string](Required $studioNode 'sha256' 'COMPATIBILITY_UNSUPPORTED' 'SCHEMA');if($actualHash-ne$expectedHash){Fail 'COMPATIBILITY_UNSUPPORTED' 'COMPATIBILITY'}}catch{Fail 'COMPATIBILITY_UNSUPPORTED' 'IO'}
  SetPhase 'COMPAT_ENV_PATHS';WriteDiagnostic 'started' 'PREPARING' $CurrentPhase
  try{if([string]::IsNullOrWhiteSpace($env:APPDATA)-or[string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)){Fail 'COMPATIBILITY_UNSUPPORTED' 'PROCESS'};$settingRelative=[string](Required $stateNode 'settingSource' 'COMPATIBILITY_UNSUPPORTED' 'SCHEMA');$base=Full (Join-Path $env:APPDATA 'Ulanzi\UlanziDeck');$setting=Under (Join-Path $base $settingRelative) $base;$requestRoot=Under (Join-Path $stateRoot 'requests') $stateRoot;$backupRoot=Under (Join-Path $stateRoot 'backups') $stateRoot}catch{Fail 'COMPATIBILITY_UNSUPPORTED' 'PROCESS'}
  WriteDiagnostic 'started' 'PREPARING' $CurrentPhase
  $request=$null;$bindingHash=''
  if($Mode-eq'Prepare'){
    SetPhase 'TARGET_RESOLUTION';if(-not(ValidNormalKey $PressedKey)-or-not(ValidUuid $SetupActionId)){Fail 'SETUP_INSTANCE_NOT_FOUND' 'SCHEMA'};$bindingHash=ActionIdHash $SetupActionId
  }else{
    SetPhase 'APPLY_PRECHECK';if(StudioRunning){Fail 'HELPER_PROCESS_FAILED' 'PROCESS'}
    $pointerPath=Under (Join-Path $requestRoot 'current.json') $requestRoot
    if(-not(Test-Path -LiteralPath $pointerPath -PathType Leaf)){Fail 'REPREPARE_REQUIRED' 'INTEGRITY'}
    $pointer=ReadJson $pointerPath 'REPREPARE_REQUIRED' 'INTEGRITY';$pointerSchema=[string](Required $pointer 'schema' 'REPREPARE_REQUIRED' 'INTEGRITY');$pointerFile=[string](Required $pointer 'file' 'REPREPARE_REQUIRED' 'INTEGRITY')
    if($pointerSchema-ne'com.arkamax.ulanzi.imageslide.request-pointer/v1'-or$pointerFile-notmatch'^[0-9a-fA-F]{32}\.json$'-or[IO.Path]::GetFileName($pointerFile)-ne$pointerFile){Fail 'REPREPARE_REQUIRED' 'INTEGRITY'}
    $requestPath=Under (Join-Path $requestRoot $pointerFile) $requestRoot;$hashPath=$requestPath+'.sha256';if(-not(Test-Path $requestPath)-or-not(Test-Path $hashPath)){Fail 'REPREPARE_REQUIRED' 'INTEGRITY'}
    try{$requestJson=Get-Content -LiteralPath $requestPath -Raw -Encoding UTF8;$requestDigest=RequestHash $requestJson;$stored=(Get-Content -LiteralPath $hashPath -Raw).Trim().ToLowerInvariant()}catch{Fail 'REPREPARE_REQUIRED' 'INTEGRITY'}
    if($requestDigest-ne$stored-or$requestDigest-ne[string](Required $pointer 'sha256' 'REPREPARE_REQUIRED' 'INTEGRITY')){Fail 'REPREPARE_REQUIRED' 'INTEGRITY'}
    try{$request=$requestJson|ConvertFrom-Json;$requestSchema=[string](Required $request 'schema' 'REPREPARE_REQUIRED' 'INTEGRITY');$requestVersion=[string](Required $request 'pluginVersion' 'REPREPARE_REQUIRED' 'INTEGRITY');$expires=[DateTime]::Parse([string](Required $request 'expiresUtc' 'REPREPARE_REQUIRED' 'INTEGRITY')).ToUniversalTime()}catch{Fail 'REPREPARE_REQUIRED' 'INTEGRITY'}
    if($requestSchema-ne'com.arkamax.ulanzi.imageslide.setup-request/v5'-or$requestVersion-ne$PluginVersion-or$expires-lt[DateTime]::UtcNow){Fail 'REPREPARE_REQUIRED' 'INTEGRITY'}
    if([string](Required $request 'studioSha256' 'REPREPARE_REQUIRED' 'INTEGRITY')-ne$actualHash){Fail 'REPREPARE_REQUIRED' 'INTEGRITY'}
    $PressedKey=[string](Required $request 'setupKey' 'REPREPARE_REQUIRED' 'INTEGRITY');$bindingHash=[string](Required $request 'setupActionIdSha256' 'REPREPARE_REQUIRED' 'INTEGRITY');if(-not(ValidNormalKey $PressedKey)-or$bindingHash-notmatch'^[0-9a-f]{64}$'){Fail 'REPREPARE_REQUIRED' 'INTEGRITY'}
  }
  $target=$(if($Mode-eq'Prepare'){ResolveTarget $PressedKey $bindingHash}else{ResolveRequestedTarget $request $PressedKey $bindingHash})
  if($Mode-eq'Prepare'){$expectedKind=$(if($Operation-eq'restore'){'restore'}else{'patch'});if($target.Kind-ne$expectedKind){Fail 'SLOT_UNRELATED' 'INTEGRITY'}}
  $restoreCandidate=$null;if($Mode-eq'Prepare'-and$target.Kind-eq'restore'){$restoreCandidate=FindRestoreCandidate $target}
  if($Mode-eq'Apply'){$requestedOperation=[string](Required $request 'operation' 'REPREPARE_REQUIRED' 'INTEGRITY');if($requestedOperation-notin@('patch','restore')-or$target.Kind-ne$requestedOperation){Fail 'SLOT_UNRELATED' 'INTEGRITY'};if($requestedOperation-eq'restore'){$restoreCandidate=ResolveRequestedRestore $target (Required $request 'restore' 'RESTORE_BACKUP_INVALID' 'INTEGRITY')}}

  if($Mode-eq'Prepare'){
    SetPhase 'REQUEST_WRITE'
    try{
      [IO.Directory]::CreateDirectory($requestRoot)|Out-Null;$now=[DateTime]::UtcNow
      $request=[ordered]@{schema='com.arkamax.ulanzi.imageslide.setup-request/v5';pluginVersion=$PluginVersion;createdUtc=$now.ToString('o');expiresUtc=$now.AddMinutes(30).ToString('o');studioSha256=$actualHash;setupKey=$PressedKey;setupActionIdSha256=$bindingHash;store=$target.Store;groupId=$target.GroupId;pageId=$target.PageId;manifestPath=$target.Manifest;manifestSha256=(Hash $target.Manifest);rootManifestSha256=(Hash $target.RootManifest);profileNameSha256=(IdentityHash $target.ProfileName);deviceUuidSha256=(IdentityHash $target.DeviceUuid);operation=$target.Kind;action=$ActionUuid}
      if($null-ne$restoreCandidate){$request['restore']=[ordered]@{runId=$restoreCandidate.RunId;receiptSha256=$restoreCandidate.ReceiptSha256;backupSha256=$restoreCandidate.BackupSha256;beforeSha256=$restoreCandidate.BeforeSha256;afterSha256=$restoreCandidate.AfterSha256}}
      $json=CanonicalJson $request;$digest=RequestHash $json;$id=[guid]::NewGuid().ToString('N');$requestFile=Under (Join-Path $requestRoot ($id+'.json')) $requestRoot;$hashFile=$requestFile+'.sha256';$tmp=$requestFile+'.tmp'
      WriteUtf8 $tmp $json;Move-Item -LiteralPath $tmp -Destination $requestFile;WriteUtf8 $hashFile ($digest+"`n")
      $pointer=[ordered]@{schema='com.arkamax.ulanzi.imageslide.request-pointer/v1';file=[IO.Path]::GetFileName($requestFile);sha256=$digest};WriteUtf8 (Join-Path $requestRoot 'current.json') (CanonicalJson $pointer)
    }catch{Fail 'REQUEST_WRITE_FAILED' 'IO'}
    WriteDiagnostic 'prepared' 'PREPARED' $CurrentPhase;Write-Output ('IMAGESLIDE_DIAGNOSTIC:PREPARED:'+$CurrentPhase+':NONE');exit 0
  }

  SetPhase 'APPLY_PRECHECK'
  $requestedStore=[string](Required $request 'store' 'HELPER_PROCESS_FAILED' 'INTEGRITY');$requestedGroup=[string](Required $request 'groupId' 'HELPER_PROCESS_FAILED' 'INTEGRITY');$requestedPage=[string](Required $request 'pageId' 'HELPER_PROCESS_FAILED' 'INTEGRITY');$requestedManifest=Full ([string](Required $request 'manifestPath' 'HELPER_PROCESS_FAILED' 'INTEGRITY'))
  if($target.Store-ne$requestedStore-or$target.GroupId-ne$requestedGroup-or$target.PageId-ne$requestedPage-or$target.Manifest-ne$requestedManifest){Fail 'PROFILE_AMBIGUOUS' 'AMBIGUITY'}
  $manifest=Under $requestedManifest (Join-Path $base $requestedStore)
  if((Hash $manifest)-ne[string](Required $request 'manifestSha256' 'HELPER_PROCESS_FAILED' 'INTEGRITY')){Fail 'PAGE_INVALID' 'INTEGRITY'}
  SetPhase 'BACKUP'
  [IO.Directory]::CreateDirectory($backupRoot)|Out-Null;$stamp=[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ');$runRoot=Under (Join-Path $backupRoot ($stamp+'-'+[guid]::NewGuid().ToString('N'))) $backupRoot;[IO.Directory]::CreateDirectory($runRoot)|Out-Null
  $backup=Under (Join-Path $runRoot 'manifest.before.json') $runRoot;Copy-Item -LiteralPath $manifest -Destination $backup;$beforeHash=Hash $backup
  if($beforeHash-ne[string](Required $request 'manifestSha256' 'HELPER_PROCESS_FAILED' 'INTEGRITY')){Fail 'HELPER_PROCESS_FAILED' 'INTEGRITY'}
  $result=$(if($requestedOperation-eq'restore'){'restored'}else{'success'});$changed=$false
  try{
    SetPhase 'SLOT_VALIDATION';$doc=ReadJson $manifest 'MANIFEST_INVALID' 'SCHEMA';$largeControllers=@(LargeDisplayControllers $doc);if($largeControllers.Count-ne1){Fail 'PAGE_INVALID' 'SCHEMA'}
    $actions=Required $largeControllers[0] 'Actions' 'PAGE_INVALID' 'SCHEMA';$current=Required $actions '3_2' 'PAGE_INVALID' 'SCHEMA';$currentAction=[string](Required $current 'Action' 'PAGE_INVALID' 'SCHEMA')
    if($requestedOperation-eq'restore'){
      if($currentAction-ne$ActionUuid){Fail 'SLOT_UNRELATED' 'INTEGRITY'};SetPhase 'RESTORE_WRITE';$temp=Under (Join-Path (Split-Path -Parent $manifest) ('.imageslide-'+[guid]::NewGuid().ToString('N')+'.tmp')) (Split-Path -Parent $manifest);Copy-Item -LiteralPath $restoreCandidate.Backup -Destination $temp
      SetPhase 'READBACK';$check=ReadJson $temp 'RESTORE_BACKUP_INVALID' 'INTEGRITY';$checkPads=@(LargeDisplayControllers $check);if($checkPads.Count-ne1){Fail 'RESTORE_BACKUP_INVALID' 'INTEGRITY'};$checkActions=Required $checkPads[0] 'Actions' 'RESTORE_BACKUP_INVALID' 'INTEGRITY';$checkEntry=Required $checkActions '3_2' 'RESTORE_BACKUP_INVALID' 'INTEGRITY';if([string](Required $checkEntry 'Action' 'RESTORE_BACKUP_INVALID' 'INTEGRITY')-ne$BuiltIn-or(Hash $temp)-ne$restoreCandidate.BeforeSha256){Fail 'RESTORE_BACKUP_INVALID' 'INTEGRITY'}
      SetPhase 'RESTORE_WRITE';$replaceBackup=Under (Join-Path $runRoot 'manifest.replace-backup.json') $runRoot;try{[IO.File]::Replace($temp,$manifest,$replaceBackup)}catch{Fail 'HELPER_PROCESS_FAILED' 'IO'};$changed=$true;if((Hash $replaceBackup)-ne$beforeHash){Fail 'HELPER_PROCESS_FAILED' 'INTEGRITY'}
    }else{
      if($currentAction-ne$BuiltIn){Fail 'SLOT_UNRELATED' 'INTEGRITY'}
      SetPhase 'PATCH_WRITE'
      $entry=NewSlideshowEntry ([guid]::NewGuid().ToString())
      $actions|Add-Member -NotePropertyName '3_2' -NotePropertyValue $entry -Force;$temp=Under (Join-Path (Split-Path -Parent $manifest) ('.imageslide-'+[guid]::NewGuid().ToString('N')+'.tmp')) (Split-Path -Parent $manifest)
      WriteUtf8 $temp ($doc|ConvertTo-Json -Depth 30);SetPhase 'READBACK';$check=ReadJson $temp 'MANIFEST_INVALID' 'SCHEMA';$checkPads=@(LargeDisplayControllers $check)
      if($checkPads.Count-ne1){Fail 'PAGE_INVALID' 'SCHEMA'};$checkActions=Required $checkPads[0] 'Actions' 'PAGE_INVALID' 'SCHEMA';$checkEntry=Required $checkActions '3_2' 'PAGE_INVALID' 'SCHEMA';$checkParam=Required $checkEntry 'ActionParam' 'PAGE_INVALID' 'SCHEMA';if([string](Required $checkEntry 'Action' 'PAGE_INVALID' 'SCHEMA')-ne$ActionUuid-or[int](Required $checkParam 'SmallViewMode' 'PAGE_INVALID' 'SCHEMA')-ne2){Fail 'PAGE_INVALID' 'INTEGRITY'}
      SetPhase 'PATCH_WRITE';$replaceBackup=Under (Join-Path $runRoot 'manifest.replace-backup.json') $runRoot;try{[IO.File]::Replace($temp,$manifest,$replaceBackup)}catch{Fail 'HELPER_PROCESS_FAILED' 'IO'};$changed=$true
      if((Hash $replaceBackup)-ne$beforeHash){Fail 'HELPER_PROCESS_FAILED' 'INTEGRITY'}
    }
    SetPhase 'READBACK';$after=ReadJson $manifest 'MANIFEST_INVALID' 'SCHEMA';$afterPads=@(LargeDisplayControllers $after);if($afterPads.Count-ne1){Fail 'PAGE_INVALID' 'SCHEMA'};$afterActions=Required $afterPads[0] 'Actions' 'PAGE_INVALID' 'SCHEMA';$afterEntry=Required $afterActions '3_2' 'PAGE_INVALID' 'SCHEMA';$expectedAfterAction=$(if($requestedOperation-eq'restore'){$BuiltIn}else{$ActionUuid});if([string](Required $afterEntry 'Action' 'PAGE_INVALID' 'SCHEMA')-ne$expectedAfterAction){Fail 'PAGE_INVALID' 'INTEGRITY'};if($requestedOperation-ne'restore'){$afterParam=Required $afterEntry 'ActionParam' 'PAGE_INVALID' 'SCHEMA';if([int](Required $afterParam 'SmallViewMode' 'PAGE_INVALID' 'SCHEMA')-ne2){Fail 'PAGE_INVALID' 'INTEGRITY'}}
    if($requestedOperation-eq'restore'-and(Hash $manifest)-ne$restoreCandidate.BeforeSha256){Fail 'RESTORE_BACKUP_INVALID' 'INTEGRITY'}
    SetPhase 'RECEIPT'
    $afterHash=Hash $manifest;$receipt=[ordered]@{schema='com.arkamax.ulanzi.imageslide.setup-receipt/v1';operation=$requestedOperation;result=$result;studio=[ordered]@{fileVersion=$actualVersion;sha256=$actualHash};target=[ordered]@{store=$target.Store;groupId=$target.GroupId;pageId=$target.PageId;key='3_2'};beforeSha256=$beforeHash;afterSha256=$afterHash;backupSha256=(Hash $backup);action=$ActionUuid;timestampUtc=[DateTime]::UtcNow.ToString('o')};if($requestedOperation-ne'restore'){$fingerprint=CenterFingerprint $afterEntry;if($null-eq$fingerprint){Fail 'PAGE_INVALID' 'INTEGRITY'};$receipt['centerActionFingerprintSha256']=$fingerprint}
    WriteUtf8 (Join-Path $runRoot 'receipt.json') ($receipt|ConvertTo-Json -Depth 10);SetPhase 'RELAUNCH';$successCode=$(if($result-eq'restored'){'RESTORED'}else{'SUCCESS'});WriteDiagnostic $result $successCode $CurrentPhase;Start-Process -FilePath $studio -WindowStyle Normal
    Write-Output ('IMAGESLIDE_DIAGNOSTIC:'+$successCode+':'+$CurrentPhase+':NONE');exit 0
  }catch{
    if($changed){$restoreTemp=$manifest+'.restore-'+[guid]::NewGuid().ToString('N');$failedPatched=Under (Join-Path $runRoot 'manifest.failed.json') $runRoot;try{Copy-Item -LiteralPath $backup -Destination $restoreTemp;[IO.File]::Replace($restoreTemp,$manifest,$failedPatched)}catch{Fail 'HELPER_PROCESS_FAILED' 'INTEGRITY'};if((Hash $manifest)-ne$beforeHash){Fail 'HELPER_PROCESS_FAILED' 'INTEGRITY'}}
    throw
  }
}catch{
  $message=[string]$_.Exception.Message;$code='HELPER_PROCESS_FAILED';$category='UNEXPECTED';if($message-match '^([A-Z_]+)\|([A-Z_]+)$'){$candidate=$Matches[1];$candidateCategory=$Matches[2];if($candidate-in$KnownCodes){$code=$candidate};if($candidateCategory-in$KnownCategories){$category=$candidateCategory}}
  WriteDiagnostic 'failed' $code $CurrentPhase $category;Write-Error ('IMAGESLIDE_DIAGNOSTIC:'+$code+':'+$CurrentPhase+':'+$category);$exitCode=1
}
exit $exitCode
