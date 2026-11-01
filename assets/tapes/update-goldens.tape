# Render from the repo root: vhs assets/tapes/update-goldens.tape
Output "/Users/oliveiraantoniocc/Documents/projects/teatest/assets/update-goldens.gif"

Set Shell bash
Set FontSize 16
Set Width 1240
Set Height 560
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "export PS1='> ' && clear"
Enter
Type `sed -i '' "s/name: 'In progress'/name: 'Doing'/" examples/apps/kanban.ts`
Enter
Type "clear"
Enter
Show

# The change is wanted: write the new golden files, then check that the suite passes with them.
Type "UPDATE_GOLDEN=1 bun test examples/kanban"
Sleep 400ms
Enter
Sleep 5s
Type "clear"
Enter
Type "git diff --stat examples/testdata"
Sleep 400ms
Enter
Sleep 2s
Type "bun test examples/kanban"
Sleep 400ms
Enter
Sleep 5s

Hide
Type "git checkout -q examples/apps/kanban.ts examples/testdata"
Enter
Sleep 500ms
Show
