' Opens the NetEventPro dashboard in the default browser.
' The service writes its address to ProgramData\NetEventPro\ui\web.json (readable by every user); config.json is a fallback.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
port = "8514"
scheme = "http"
base = sh.ExpandEnvironmentStrings("%ProgramData%") & "\NetEventPro\"
If Not fso.FolderExists(base) Then base = sh.ExpandEnvironmentStrings("%ProgramData%") & "\SyslogPro\"
For Each name In Array("ui\web.json", "config.json")
  If fso.FileExists(base & name) Then
    On Error Resume Next
    Set f = fso.OpenTextFile(base & name, 1)
    txt = f.ReadAll
    f.Close
    Set re = New RegExp
    re.Pattern = """(?:web)?[Pp]ort""\s*:\s*(\d+)"
    Set m = re.Execute(txt)
    If Err.Number = 0 Then
      If m.Count > 0 Then
        port = m(0).SubMatches(0)
        If InStr(txt, """scheme"":""https""") > 0 Then scheme = "https"
        On Error GoTo 0
        Exit For
      End If
    End If
    Err.Clear
    On Error GoTo 0
  End If
Next
host = "localhost"
If scheme = "http" Then host = "127.0.0.1"   ' Chrome may remember "localhost" as https-only (HSTS from an earlier https dashboard); the address 127.0.0.1 is never affected
sh.Run scheme & "://" & host & ":" & port & "/"
