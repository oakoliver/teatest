# Render from the repo root: vhs assets/tapes/golden-diff.tape
Output "/Users/oliveiraantoniocc/Documents/projects/teatest/assets/golden-diff.gif"

Set Shell bash
Set FontSize 16
Set Width 1240
Set Height 640
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "export PS1='> ' && clear"
Enter
Show

# Rename a column in the program, then run the test that has the first screen as a golden file.
Type `sed -i '' "s/name: 'In progress'/name: 'Doing'/" examples/apps/kanban.ts`
Sleep 400ms
Enter
Sleep 600ms
Type `bun test examples/kanban -t "first screen"`
Sleep 400ms
Enter
Sleep 7s

Hide
Type "git checkout -q examples/apps/kanban.ts"
Enter
Sleep 500ms
Show
