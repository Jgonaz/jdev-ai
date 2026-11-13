import { describe, expect, it } from 'vitest';
import { STATIONS, classifyTool } from '../shared/stations.ts';
import type { Station } from '../shared/stations.ts';

const bash = (command: string): Station => classifyTool('Bash', { command });

describe('classifyTool', () => {
  it('las estaciones son las del mapa, sin Hooks', () => {
    expect([...STATIONS]).toEqual(['tu', 'modelo', 'memoria', 'archivos', 'shell', 'red', 'navegador', 'agentes', 'skills']);
  });

  it('las herramientas de archivos van a Archivos', () => {
    expect(classifyTool('Read', { file_path: '/home/u/p/src/App.tsx' })).toBe('archivos');
    expect(classifyTool('Write', { file_path: '/home/u/p/a.md' })).toBe('archivos');
    expect(classifyTool('Edit', { file_path: '/home/u/p/a.md' })).toBe('archivos');
    expect(classifyTool('MultiEdit', { file_path: '/home/u/p/a.md' })).toBe('archivos');
    expect(classifyTool('NotebookEdit', { notebook_path: '/home/u/p/n.ipynb' })).toBe('archivos');
    expect(classifyTool('Grep', { pattern: 'x' })).toBe('archivos');
    expect(classifyTool('Glob', { pattern: '**/*.ts' })).toBe('archivos');
  });

  it('la memoria de Claude y la del harness van a Memoria, también con Grep y Glob', () => {
    expect(classifyTool('Read', { file_path: '/home/u/.claude/projects/-home-u-p/memory/MEMORY.md' })).toBe('memoria');
    expect(classifyTool('Edit', { file_path: '/home/u/p/.agent/memory/notas.md' })).toBe('memoria');
    expect(classifyTool('Write', { file_path: '.agent/memory/notas.md' })).toBe('memoria');
    expect(classifyTool('Grep', { pattern: 'x', path: '/home/u/.claude/projects/-home-u-p/memory' })).toBe('memoria');
    expect(classifyTool('Read', { file_path: 'C:\\Users\\u\\.claude\\projects\\p\\memory\\a.md' })).toBe('memoria');
  });

  it('una ruta parecida a la de la memoria sigue siendo Archivos', () => {
    expect(classifyTool('Read', { file_path: '/home/u/.claude/projects/-home-u-p/memoria/a.md' })).toBe('archivos');
    expect(classifyTool('Read', { file_path: '/home/u/p/memory/a.md' })).toBe('archivos');
    expect(classifyTool('Read', { file_path: '/home/u/p/.agent/memory-old/a.md' })).toBe('archivos');
    expect(classifyTool('Read', { file_path: '/home/u/.claude/projects/p/sub/memory/a.md' })).toBe('archivos');
  });

  it('un comando que solo toca archivos va a Archivos, o a Memoria si es de su carpeta', () => {
    expect(bash('cat src/a.ts | grep foo | wc -l')).toBe('archivos');
    expect(bash('cd /tmp && ls -la && echo hecho')).toBe('archivos');
    expect(bash('find . -name "*.ts" -exec rm {} \;')).toBe('archivos');
    expect(bash('cat /home/u/.claude/projects/-home-u-p/memory/MEMORY.md')).toBe('memoria');
    expect(bash('tee .agent/memory/notas.md')).toBe('memoria');
  });

  it('el resto de comandos va a Shell, incluido lo mezclado y lo desconocido', () => {
    expect(bash('pnpm test')).toBe('shell');
    expect(bash('git status')).toBe('shell');
    expect(bash('cat a.txt && pnpm build')).toBe('shell');
    expect(bash('')).toBe('shell');
    expect(classifyTool('Bash', {})).toBe('shell');
    expect(classifyTool('Monitor', { description: 'x' })).toBe('shell');
    expect(classifyTool('HerramientaNueva', {})).toBe('shell');
  });

  it('los comandos de red van a Red por su nombre o por su subcomando', () => {
    expect(bash('curl -s https://example.com')).toBe('red');
    expect(bash('gh pr view 12')).toBe('red');
    expect(bash('ssh host ls')).toBe('red');
    expect(bash('git push origin main')).toBe('red');
    expect(bash('git -C /tmp/x fetch --all')).toBe('red');
    expect(bash('npm install left-pad')).toBe('red');
    expect(bash('pnpm dlx cowsay')).toBe('red');
    expect(bash('python3 -m pip install requests')).toBe('red');
    expect(bash('docker compose pull')).toBe('red');
    expect(bash('npx -y create-foo')).toBe('red');
  });

  it('lo que solo parece de red sigue siendo Shell', () => {
    expect(bash('npx vitest run')).toBe('shell');
    expect(bash('npm test')).toBe('shell');
    expect(bash('git commit -m "curl https://x"')).toBe('shell');
    expect(bash('echo curl')).toBe('shell');
  });

  it('los envoltorios no esconden el comando que ejecutan', () => {
    expect(bash('sudo curl https://example.com')).toBe('red');
    expect(bash('sudo -u root gh auth status')).toBe('red');
    expect(bash('env A=1 B=2 curl x')).toBe('red');
    expect(bash('timeout 5 curl x')).toBe('red');
    expect(bash('timeout -s KILL 5 git push')).toBe('red');
    expect(bash('nohup wget x')).toBe('red');
    expect(bash('echo https://x | xargs curl')).toBe('red');
    expect(bash('A=1 curl x')).toBe('red');
    expect(bash('sudo cat /etc/hosts')).toBe('archivos');
    expect(bash('timeout 5 cat a.txt')).toBe('archivos');
    expect(bash('find . -name x -exec curl {} \;')).toBe('red');
    expect(bash('echo $(curl -s x)')).toBe('red');
    expect(bash('echo `wget x`')).toBe('red');
    expect(bash('/usr/bin/curl x')).toBe('red');
  });

  it('PowerShell usa sus propios nombres, sin distinguir mayúsculas', () => {
    expect(classifyTool('PowerShell', { command: 'Invoke-WebRequest https://x' })).toBe('red');
    expect(classifyTool('PowerShell', { command: '& "C:\\Program Files\\Git\\cmd\\git.exe" push' })).toBe('red');
    expect(classifyTool('PowerShell', { command: 'Get-Content a.txt | Select-Object -First 3' })).toBe('archivos');
    expect(classifyTool('PowerShell', { command: 'Get-Process' })).toBe('shell');
    expect(classifyTool('PowerShell', { command: '$x = CURL.EXE https://x' })).toBe('red');
  });

  it('las herramientas web y las de servidores MCP van a Red', () => {
    expect(classifyTool('WebFetch', { url: 'https://example.com' })).toBe('red');
    expect(classifyTool('WebSearch', { query: 'x' })).toBe('red');
    expect(classifyTool('mcp__plugin_vercel_vercel__list_projects', {})).toBe('red');
    expect(classifyTool('mcp__github__get_issue', {})).toBe('red');
  });

  it('Playwright y los navegadores van a Navegador', () => {
    expect(classifyTool('mcp__playwright__browser_navigate', { url: 'http://localhost:5173' })).toBe('navegador');
    expect(classifyTool('mcp__Claude_Browser__navigate', {})).toBe('navegador');
    expect(classifyTool('mcp__chrome-browser__click', {})).toBe('navegador');
    expect(classifyTool('mcp__claude-in-chrome__tabs_context', {})).toBe('navegador');
  });

  it('subagentes, tareas y mensajes van a Agentes', () => {
    for (const t of ['Agent', 'Task', 'Workflow', 'SendMessage', 'TaskStop']) expect(classifyTool(t, {})).toBe('agentes');
  });

  it('Skill y ToolSearch van a Skills', () => {
    expect(classifyTool('Skill', { skill: 'x' })).toBe('skills');
    expect(classifyTool('ToolSearch', { query: 'x' })).toBe('skills');
  });

  it('las preguntas a la persona van a Tú', () => {
    expect(classifyTool('AskUserQuestion', {})).toBe('tu');
  });

  it('sin entrada se clasifica por el nombre', () => {
    expect(classifyTool('Read', {})).toBe('archivos');
    expect(classifyTool('Edit', {})).toBe('archivos');
  });
});
