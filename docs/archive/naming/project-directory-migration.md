# Project directory migration

Before updating a checkout that used the old shell defaults (including `apps/lab/.local-projects`), stop the local
stack. Set the canonical Frige setting in the shell that launches the stack.
Use the absolute path of the existing directory. For example, from PowerShell:

```powershell
$env:STEX_FRIGE_PROJECTS_DIR = 'C:\path\to\existing\.local-projects'
$env:STEX_PANTHEON_PORT = '4300'
corepack pnpm dev:alpha
```

Open an existing synthetic or otherwise approved project to confirm the path.
The setting continues to use the existing directory in place. Keep it set
on subsequent launches until you choose to move your data. If you have more
than one project directory, select the intended one explicitly and keep both
intact. The default is `apps/pantheon/.local-projects`.

The retired port setting was `STEX_LAB_PORT`. The retired development and test
commands were `dev:lab` and `test:lab`. Use `dev:pantheon` and `test:pantheon`.
