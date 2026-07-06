' Launches Trading Dashboard via the .bat wrapper (minimized window, errors visible).
Option Explicit

Dim shell, fso, batPath, projectRoot

Set fso = CreateObject("Scripting.FileSystemObject")
projectRoot = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
batPath = projectRoot & "\scripts\Launch-Trading-Dashboard.bat"

Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = projectRoot
' WindowStyle 1 = normal (visible launcher console while starting)
shell.Run "cmd.exe /c """ & batPath & """", 1, False
