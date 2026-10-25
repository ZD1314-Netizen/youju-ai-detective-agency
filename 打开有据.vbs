Option Explicit
Dim fso, shell, folder, scriptPath, command
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
folder = fso.GetParentFolderName(WScript.ScriptFullName)
scriptPath = fso.BuildPath(folder, "start.ps1")
command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File " & Chr(34) & scriptPath & Chr(34)
shell.Run command, 0, False
