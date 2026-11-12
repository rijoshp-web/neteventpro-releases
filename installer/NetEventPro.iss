; NetEventPro installer. New installs use the folder NetEventPro everywhere (program folder, ProgramData folder, service id, firewall rule). An installation made by an older version (named SyslogPro) is converted by this setup: the old service and firewall rule are removed and the ProgramData folder is renamed. Same AppId, so it installs over the old folder.
; Build with:  build.ps1   (it stages the files and calls ISCC for you)

#ifndef AppVersion
  #define AppVersion "0.0.0"   ; build.ps1 always passes the real version from package.json
#endif
#ifndef StageDir
  #define StageDir "..\build\stage"
#endif

[Setup]
AppId={{B6C1E2C4-7D1A-4E55-9B6B-5C2D1E7A9F31}
AppName=NetEventPro
AppVersion={#AppVersion}
AppPublisher=NetEventPro
DefaultDirName={code:GetDefaultDir}
; an old installation in a folder called SyslogPro is moved to NetEventPro (see GetDefaultDir); any other folder chosen earlier is kept
UsePreviousAppDir=no
DefaultGroupName=NetEventPro
DisableProgramGroupPage=yes
OutputDir=..\dist
OutputBaseFilename=NetEventPro-Setup-{#AppVersion}
SetupIconFile=..\assets\neteventpro.ico
UninstallDisplayIcon={app}\assets\neteventpro.ico
Compression=lzma2/ultra64
SolidCompression=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
WizardStyle=modern
MinVersion=10.0

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "firewall"; Description: "Allow NetEventPro through Windows Firewall (needed to receive syslog and SNMP traps from other devices)"; GroupDescription: "Network:"
Name: "autotray"; Description: "Show the NetEventPro status icon in the notification area when I sign in"; GroupDescription: "Convenience:"
Name: "desktopicon"; Description: "Create a desktop shortcut to the dashboard"; GroupDescription: "Convenience:"; Flags: unchecked
Name: "lockdata"; Description: "Only allow administrators to open the data folder (stored messages and settings)"; GroupDescription: "Security:"; Flags: unchecked

[Files]
Source: "{#StageDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{autoprograms}\NetEventPro Dashboard"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\tray\open-dashboard.vbs"""; IconFilename: "{app}\assets\neteventpro.ico"
Name: "{autoprograms}\NetEventPro Status Icon"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\tray\launch-tray.vbs"""; IconFilename: "{app}\assets\neteventpro.ico"
; the database (syslog.db), settings and optional plain-text logs live here; ProgramData is a hidden folder, so this shortcut is the easy way in
Name: "{autoprograms}\NetEventPro Data Folder"; Filename: "{commonappdata}\NetEventPro"
Name: "{autodesktop}\NetEventPro"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\tray\open-dashboard.vbs"""; IconFilename: "{app}\assets\neteventpro.ico"; Tasks: desktopicon

[InstallDelete]
; shortcuts made by versions before 1.8.0 (the product was called SyslogPro)
Type: files; Name: "{autoprograms}\SyslogPro Dashboard.lnk"
Type: files; Name: "{autoprograms}\SyslogPro Status Icon.lnk"
Type: files; Name: "{autoprograms}\SyslogPro Data Folder.lnk"
Type: files; Name: "{autodesktop}\SyslogPro.lnk"

[InstallDelete]
Type: files; Name: "{app}\service\SyslogProService.exe"
Type: files; Name: "{app}\service\SyslogProService.xml"
Type: files; Name: "{app}\tray\SyslogPro-Tray.ps1"
Type: files; Name: "{app}\assets\syslogpro.ico"

[Registry]
Root: HKLM; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueName: "SyslogProTray"; Flags: deletevalue
Root: HKLM; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "NetEventProTray"; ValueData: """{sys}\wscript.exe"" ""{app}\tray\launch-tray.vbs"""; Flags: uninsdeletevalue; Tasks: autotray

[Run]
; install + start the Windows service (runs at boot, before anyone signs in)
Filename: "{app}\service\NetEventProService.exe"; Parameters: "install"; Flags: runhidden waituntilterminated; StatusMsg: "Installing the NetEventPro service..."
Filename: "{app}\service\NetEventProService.exe"; Parameters: "start"; Flags: runhidden waituntilterminated; StatusMsg: "Starting the NetEventPro service..."
; firewall: a program rule so it keeps working if you change ports later
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""NetEventPro"""; Flags: runhidden waituntilterminated; Tasks: firewall
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""NetEventPro"" dir=in action=allow program=""{app}\node\node.exe"" enable=yes profile=any"; Flags: runhidden waituntilterminated; Tasks: firewall; StatusMsg: "Configuring Windows Firewall..."
; optional: remove the "Users" permission from the data folder (SYSTEM and Administrators keep full access; Explorer asks for permission when you open it)
Filename: "{sys}\icacls.exe"; Parameters: """{commonappdata}\NetEventPro"" /inheritance:r /grant:r *S-1-5-18:(OI)(CI)F *S-1-5-32-544:(OI)(CI)F"; Flags: runhidden waituntilterminated; Tasks: lockdata; StatusMsg: "Restricting access to the data folder..."
; offer to open things when the wizard finishes (runs as the signed-in user)
Filename: "{sys}\wscript.exe"; Parameters: """{app}\tray\launch-tray.vbs"""; Flags: nowait runasoriginaluser skipifsilent; Tasks: autotray
Filename: "{sys}\wscript.exe"; Parameters: """{app}\tray\open-dashboard.vbs"""; Flags: nowait postinstall runasoriginaluser skipifsilent; Description: "Open the dashboard now"

[UninstallRun]
Filename: "{app}\service\NetEventProService.exe"; Parameters: "stop"; Flags: runhidden waituntilterminated; RunOnceId: "StopSvc"
Filename: "{app}\service\NetEventProService.exe"; Parameters: "uninstall"; Flags: runhidden waituntilterminated; RunOnceId: "RemoveSvc"
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""NetEventPro"""; Flags: runhidden waituntilterminated; RunOnceId: "RemoveFw"

[Code]
var
  PortPage: TInputQueryWizardPage;
  ModePage: TInputOptionWizardPage;
  ProbePage: TInputQueryWizardPage;
  MovedFrom: String;   // old program folder (...\SyslogPro) that is removed after the files are installed in the new one

// folder of the installation that is already on this computer ('' when none)
function PreviousAppDir: String;
var
  P: String;
begin
  Result := '';
  if RegQueryStringValue(HKLM, 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{B6C1E2C4-7D1A-4E55-9B6B-5C2D1E7A9F31}_is1', 'Inno Setup: App Path', P) then
  begin
    while (Length(P) > 3) and (P[Length(P)] = '\') do Delete(P, Length(P), 1);
    Result := P;
  end;
end;

// New installation: ...\NetEventPro. Upgrade: an old folder named SyslogPro becomes NetEventPro next to it; a folder with any other
// name (chosen by hand earlier) is kept because it may hold other things.
function GetDefaultDir(Param: String): String;
var
  P: String;
begin
  P := PreviousAppDir;
  if (P <> '') and (CompareText(ExtractFileName(P), 'SyslogPro') = 0) then
    Result := ExtractFilePath(P) + 'NetEventPro'
  else if P <> '' then
    Result := P
  else
    Result := ExpandConstant('{autopf}\NetEventPro');
end;

// stop and remove a service (old id SyslogPro / new id NetEventPro) whose wrapper is in the given program folder
procedure RemoveServiceIn(const Dir: String);
var
  Code: Integer;
  Names: array[0..1] of String;
  I: Integer;
  Exe: String;
begin
  Names[0] := 'SyslogProService.exe';
  Names[1] := 'NetEventProService.exe';
  for I := 0 to 1 do
  begin
    Exe := Dir + '\service\' + Names[I];
    if FileExists(Exe) then
    begin
      Exec(Exe, 'stop', '', SW_HIDE, ewWaitUntilTerminated, Code);
      Sleep(2000);
      Exec(Exe, 'uninstall', '', SW_HIDE, ewWaitUntilTerminated, Code);
    end;
  end;
end;

function OldDataDir: String;
begin
  Result := ExpandConstant('{commonappdata}\SyslogPro');
end;

function DataDir: String;
begin
  Result := ExpandConstant('{commonappdata}\NetEventPro');
end;

function IsValidPort(const S: String): Boolean;
var
  N: Integer;
begin
  N := StrToIntDef(S, -1);
  Result := (N >= 1) and (N <= 65535);
end;

function HasConfig: Boolean;
begin
  Result := FileExists(DataDir + '\config.json') or FileExists(OldDataDir + '\config.json');
end;

function IsProbeInstall: Boolean;
begin
  Result := ModePage.SelectedValueIndex = 1;
end;

// 0 = full, 1 = probe, 2 = keep what this computer already is (upgrade only)
function KeepsCurrentType: Boolean;
begin
  Result := ModePage.SelectedValueIndex = 2;
end;

// text for a JSON string value
function JsonText(const S: String): String;
begin
  Result := S;
  StringChangeEx(Result, '\', '\\', True);
  StringChangeEx(Result, '"', '\"', True);
  Result := Trim(Result);
end;

procedure InitializeWizard;
begin
  ModePage := CreateInputOptionPage(wpSelectTasks, 'Type of installation',
    'What will this computer do?',
    'Choose "Full" for the main NetEventPro (database, dashboard, rules, alarms, reports). Choose "Probe" for a small computer in another network that only receives syslog and SNMP traps and forwards them to the main NetEventPro. A probe stores nothing and has no dashboard, only a small status page.',
    True, False);
  ModePage.Add('Full NetEventPro (main server)');
  ModePage.Add('Probe only (forwards to the main NetEventPro)');
  if HasConfig then
  begin
    // upgrade: keep the current type unless the person chooses another one
    ModePage.Add('Keep this computer as it is now (recommended for an update)');
    ModePage.SelectedValueIndex := 2;
  end
  else
    ModePage.SelectedValueIndex := 0;
  if ExpandConstant('{param:PROBE|0}') = '1' then ModePage.SelectedValueIndex := 1;

  PortPage := CreateInputQueryPage(ModePage.ID, 'Network ports',
    'Which ports should NetEventPro use?',
    'The standard syslog port is 514 (UDP and TCP). Your devices must send to this port. SNMP traps use UDP 162. You can change these later in Settings. The second port is the web address of the dashboard (for a probe: of its small status page, which opens on this computer only).');
  PortPage.Add('Syslog port (UDP and TCP):', False);
  PortPage.Add('Dashboard / status page web port:', False);
  PortPage.Values[0] := '514';
  PortPage.Values[1] := '8514';

  ProbePage := CreateInputQueryPage(PortPage.ID, 'Main NetEventPro',
    'Where should this probe send what it receives?',
    'Create the probe on the main NetEventPro first (Settings, Remote probes, Add probe) and copy the token. You can also fill this in later on the probe status page.');
  ProbePage.Add('Main server address (for example https://nms.example.com:8514):', False);
  ProbePage.Add('Probe token:', False);
  ProbePage.Add('Probe name (for example the site):', False);
  ProbePage.Values[0] := ExpandConstant('{param:SERVER|}');
  ProbePage.Values[1] := ExpandConstant('{param:TOKEN|}');
  ProbePage.Values[2] := ExpandConstant('{param:NAME|}');
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := False;
  // an existing installation keeps its ports; the probe questions are only asked when a probe is chosen
  if PageID = PortPage.ID then Result := HasConfig or KeepsCurrentType
  else if PageID = ProbePage.ID then Result := not IsProbeInstall;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if (CurPageID = ProbePage.ID) and (Trim(ProbePage.Values[0]) = '') then
  begin
    MsgBox('Enter the address of the main NetEventPro. (You can leave the token for later, but the address is needed.)', mbError, MB_OK);
    Result := False;
  end;
  if CurPageID = PortPage.ID then
  begin
    if not IsValidPort(PortPage.Values[0]) or not IsValidPort(PortPage.Values[1]) then
    begin
      MsgBox('Enter port numbers between 1 and 65535.', mbError, MB_OK);
      Result := False;
    end
    else if PortPage.Values[0] = PortPage.Values[1] then
    begin
      MsgBox('The syslog port and the dashboard port must be different.', mbError, MB_OK);
      Result := False;
    end;
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Code: Integer;
begin
  Result := '';
  // upgrade: stop and remove the old service so files can be replaced (it may be in the old SyslogPro folder or in this one)
  RemoveServiceIn(PreviousAppDir);
  RemoveServiceIn(ExpandConstant('{app}'));
  Exec(ExpandConstant('{sys}\netsh.exe'), 'advfirewall firewall delete rule name="SyslogPro"', '', SW_HIDE, ewWaitUntilTerminated, Code);
  if (PreviousAppDir <> '') and (CompareText(PreviousAppDir, ExpandConstant('{app}')) <> 0) and (CompareText(ExtractFileName(PreviousAppDir), 'SyslogPro') = 0) then
    MovedFrom := PreviousAppDir;
  // the service is stopped now: rename the data folder of an older installation (messages, settings, backups are kept as they are)
  if DirExists(OldDataDir) and (not DirExists(DataDir)) then
    if not RenameFile(OldDataDir, DataDir) then
      Result := 'The data folder ' + OldDataDir + ' could not be renamed to ' + DataDir + '. Close programs that use it (Explorer, an editor) and run the setup again.';
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Json: String;
begin
  // the program is installed in the new folder: remove the old SyslogPro program folder (data is in ProgramData, not here)
  if (CurStep = ssPostInstall) and (MovedFrom <> '') then
    DelTree(MovedFrom, True, True, True);
  // ssInstall = just BEFORE the files are copied. The [Run] entries that install and start the service run as part of the
  // installation, i.e. before ssPostInstall, so the ports chosen in the wizard must be written now or the service would
  // start with the defaults.
  if CurStep = ssInstall then
  begin
    ForceDirectories(DataDir);
    if HasConfig and (not KeepsCurrentType) then
    begin
      // existing installation, type changed in the wizard: the program applies this file when it starts and then deletes it
      if IsProbeInstall then
        SaveStringToFile(DataDir + '\apply-setup.json', '{ "mode": "probe", "probe": { "server": "' + JsonText(ProbePage.Values[0]) + '", "token": "' + JsonText(ProbePage.Values[1]) + '", "name": "' + JsonText(ProbePage.Values[2]) + '", "allowSelfSigned": false } }', False)
      else
        SaveStringToFile(DataDir + '\apply-setup.json', '{ "mode": "central" }', False);
    end;
    if not FileExists(DataDir + '\config.json') then
    begin
      Json := '{' + #13#10 +
              '  "udpPort": ' + PortPage.Values[0] + ',' + #13#10 +
              '  "tcpPort": ' + PortPage.Values[0] + ',' + #13#10 +
              '  "webPort": ' + PortPage.Values[1];
      if IsProbeInstall then
        Json := Json + ',' + #13#10 +
              '  "mode": "probe",' + #13#10 +
              '  "probe": { "server": "' + JsonText(ProbePage.Values[0]) + '", "token": "' + JsonText(ProbePage.Values[1]) + '", "name": "' + JsonText(ProbePage.Values[2]) + '", "allowSelfSigned": false }';
      Json := Json + #13#10 + '}' + #13#10;
      SaveStringToFile(DataDir + '\config.json', Json, False);
    end;
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usPostUninstall then
  begin
    if DirExists(DataDir) then
      if MsgBox('Also delete all stored syslog messages and settings in ' + DataDir + '?' + #13#10 + 'Choose No to keep them for a future reinstall.',
                mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
        DelTree(DataDir, True, True, True);
  end;
end;
