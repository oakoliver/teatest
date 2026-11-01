# Render from the repo root: vhs assets/tapes/suite.tape
Output "/Users/oliveiraantoniocc/Documents/projects/teatest/assets/suite.gif"

Set Shell bash
Set FontSize 16
Set Width 1000
Set Height 480
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "export PS1='> ' && clear"
Enter
Show

Type "ls tests examples"
Sleep 400ms
Enter
Sleep 2s
Type "bun test --dots"
Sleep 400ms
Enter
Sleep 22s
