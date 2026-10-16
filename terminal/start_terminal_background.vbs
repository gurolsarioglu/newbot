Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "Y:\takip\B-5\NewBot\terminal"
WshShell.Run "cmd /c node terminal-server.js", 0, False
Set WshShell = Nothing
