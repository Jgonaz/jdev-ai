import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SkillError, discoverSkills, isOwnCopy, launchVSCode, readSkillCopy, resolveSkill, splitFrontmatter, summarize } from './skills.ts';

const skill = (nombre: string, descripcion: string, cuerpo = 'Cuerpo.\n') => `---\nname: ${nombre}\ndescription: ${descripcion}\n---\n${cuerpo}`;

describe('splitFrontmatter', () => {
  it('separa el YAML del cuerpo', () => {
    expect(splitFrontmatter('---\nname: a\ndescription: >\n  Una\n  dos\nallowed-tools: [x, y]\n---\n# T\n')).toEqual({
      frontmatter: { name: 'a', description: 'Una dos\n', 'allowed-tools': ['x', 'y'] },
      body: '# T\n',
    });
  });

  it('sin frontmatter, o con uno roto o que no es un objeto, todo es cuerpo o datos vacíos', () => {
    expect(splitFrontmatter('# Solo cuerpo\n')).toEqual({ frontmatter: {}, body: '# Solo cuerpo\n' });
    expect(splitFrontmatter('---\n: : [\n---\nhola\n')).toEqual({ frontmatter: {}, body: 'hola\n' });
    // YAML no estricto: una descripción con «: » sin comillas, como las que aceptan los agentes.
    expect(splitFrontmatter('---\nname: r\ndescription: Busca en cascada: fabricante y tienda.\nmetadata:\n  author: smashadvisor\n  version: "1.1"\n---\nC\n')).toEqual({
      frontmatter: { name: 'r', description: 'Busca en cascada: fabricante y tienda.', metadata: { author: 'smashadvisor', version: '1.1' } },
      body: 'C\n',
    });
    expect(splitFrontmatter('---\n- a\n- b\n---\nhola\n')).toEqual({ frontmatter: {}, body: 'hola\n' });
    expect(splitFrontmatter('---\n---\nhola\n')).toEqual({ frontmatter: {}, body: 'hola\n' });
    expect(splitFrontmatter('---\r\nname: a\r\n---\r\nhola')).toEqual({ frontmatter: { name: 'a' }, body: 'hola' });
  });
});

describe('descubrimiento de skills', () => {
  let tmp: string;
  let proy: string;
  let home: string;
  const crear = (base: string, ruta: string, contenido: string) => {
    mkdirSync(join(base, ruta, '..'), { recursive: true });
    writeFileSync(join(base, ruta), contenido);
  };

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'jdev-skills-'));
    proy = join(tmp, 'proy');
    home = join(tmp, 'home');
    mkdirSync(proy);
    mkdirSync(home);
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it('agrupa por nombre las copias de varios agentes y marca las iguales y las distintas', async () => {
    crear(proy, '.claude/skills/uno/SKILL.md', skill('uno', 'Hace uno'));
    crear(proy, '.agents/skills/uno/SKILL.md', skill('uno', 'Hace uno'));
    crear(proy, '.github/skills/uno/SKILL.md', skill('uno', 'Hace uno'));
    crear(proy, '.claude/skills/dos/SKILL.md', skill('dos', 'Hace dos'));
    crear(proy, '.opencode/skills/dos/SKILL.md', skill('dos', 'Hace dos', 'Otro cuerpo.\n'));
    crear(proy, '.codex/skills/tres/SKILL.md', '# Sin frontmatter\n');

    const lista = summarize(await discoverSkills({ kind: 'project', path: proy }));
    expect(lista.map((s) => [s.name, s.description, s.diverges, s.copies.map((c) => c.agent)])).toEqual([
      ['dos', 'Hace dos', true, ['claude', 'opencode']],
      ['tres', null, false, ['codex']],
      ['uno', 'Hace uno', false, ['claude', 'codex', 'copilot']],
    ]);
    expect(lista[2]!.copies.map((c) => [c.label, c.path])).toEqual([
      ['Claude', '.claude/skills/uno'],
      ['Codex', '.agents/skills/uno'],
      ['Copilot', '.github/skills/uno'],
    ]);
    expect(new Set(lista[2]!.copies.map((c) => c.hash)).size).toBe(1);
    expect(new Set(lista[0]!.copies.map((c) => c.hash)).size).toBe(2);
    // El nombre sale de la carpeta si el frontmatter no lo trae.
    expect(lista[1]!.name).toBe('tres');
  });

  it('solo mira la raíz del proyecto, un nivel, sin carpetas sin SKILL.md ni enlaces simbólicos', async () => {
    crear(proy, '.claude/skills/real/SKILL.md', skill('real', 'r'));
    crear(proy, '.claude/skills/anidada/sub/SKILL.md', skill('anidada', 'a'));
    crear(proy, '.claude/skills/vacia/leeme.md', 'x');
    crear(proy, 'tmp/otro/.claude/skills/ajena/SKILL.md', skill('ajena', 'x'));
    crear(tmp, 'fuera/enlazada/SKILL.md', skill('enlazada', 'x'));
    symlinkSync(join(tmp, 'fuera', 'enlazada'), join(proy, '.claude', 'skills', 'enlazada'));
    crear(tmp, 'fuera2/skills/otra/SKILL.md', skill('otra', 'x'));
    symlinkSync(join(tmp, 'fuera2'), join(proy, '.agents'));
    mkdirSync(join(proy, '.github'));
    symlinkSync(join(tmp, 'fuera2', 'skills'), join(proy, '.github', 'skills'));
    // Un SKILL.md que es un enlace tampoco cuenta.
    mkdirSync(join(proy, '.claude', 'skills', 'conenlace'));
    symlinkSync(join(tmp, 'fuera', 'enlazada', 'SKILL.md'), join(proy, '.claude', 'skills', 'conenlace', 'SKILL.md'));

    const lista = summarize(await discoverSkills({ kind: 'project', path: proy }));
    expect(lista.map((s) => s.name)).toEqual(['real']);
  });

  it('sin carpetas de skills, o con límites rotos, devuelve una lista vacía', async () => {
    expect(await discoverSkills({ kind: 'project', path: proy })).toEqual([]);
    expect(await discoverSkills({ kind: 'project', path: join(tmp, 'no-existe') })).toEqual([]);
    expect(await discoverSkills({ kind: 'user', home })).toEqual([]);
  });

  it('lee las skills de usuario: .claude hasta 3 niveles, .agents, .codex con .system y plugins', async () => {
    crear(home, '.claude/skills/synced/bucket-1/sincronizada/SKILL.md', skill('sincronizada', 'De claude.ai'));
    crear(home, '.claude/skills/propia/SKILL.md', skill('propia', 'Mía'));
    crear(home, '.claude/skills/a/b/c/profunda/SKILL.md', skill('profunda', 'Demasiado hondo'));
    crear(home, '.agents/skills/propia/SKILL.md', skill('propia', 'Mía'));
    crear(home, '.codex/skills/.system/imagegen/SKILL.md', skill('imagegen', 'Imágenes'));
    crear(home, '.codex/skills/emil/SKILL.md', skill('emil', 'Diseño'));
    crear(home, '.github/skills/nolee/SKILL.md', skill('nolee', 'x'));
    const instalado = join(home, '.claude', 'plugins', 'cache', 'm', 'vercel', '1.0');
    crear(instalado, 'skills/deploy/SKILL.md', skill('deploy', 'Despliega'));
    crear(instalado, 'skills/deploy/ref/guia.md', 'x');
    crear(home, '.claude/plugins/installed_plugins.json', JSON.stringify({
      version: 2,
      plugins: {
        'vercel@m': [{ scope: 'user', installPath: instalado }, { installPath: instalado }],
        'roto@m': 'no es una lista',
        'sin-ruta@m': [{ scope: 'user' }, { installPath: 'relativa' }],
      },
    }));

    const lista = summarize(await discoverSkills({ kind: 'user', home }));
    expect(lista.map((s) => s.name)).toEqual(['deploy', 'emil', 'imagegen', 'propia', 'sincronizada']);
    const porNombre = Object.fromEntries(lista.map((s) => [s.name, s.copies.map((c) => `${c.label}|${c.path}`)]));
    expect(porNombre.sincronizada).toEqual(['Claude (claude.ai)|~/.claude/skills/synced/bucket-1/sincronizada']);
    expect(porNombre.propia).toEqual(['Claude|~/.claude/skills/propia', 'Codex|~/.agents/skills/propia']);
    expect(porNombre.imagegen).toEqual(['Codex|~/.codex/skills/.system/imagegen']);
    expect(porNombre.deploy).toEqual([`plugin vercel|~/.claude/plugins/cache/m/vercel/1.0/skills/deploy`]);
    expect(lista.find((s) => s.name === 'propia')!.diverges).toBe(false);
  });

  it('distingue las skills propias de un proyecto (author del proyecto) de las de terceros', async () => {
    const conMeta = (nombre: string, meta: string) => `---\nname: ${nombre}\ndescription: x\nmetadata:\n${meta}\n---\nC.\n`;
    crear(proy, '.claude/skills/audit/SKILL.md', conMeta('audit', '  author: MiProy\n  version: "1.0"'));
    crear(proy, '.agents/skills/audit/SKILL.md', skill('audit', 'x'));
    crear(proy, '.claude/skills/openspec-propose/SKILL.md', conMeta('openspec-propose', '  author: openspec\n  generatedBy: "1.8.0"'));
    crear(proy, '.claude/skills/generada/SKILL.md', conMeta('generada', '  author: mi-proy\n  generatedBy: "1.0"'));
    crear(proy, '.agents/skills/impeccable/SKILL.md', '---\nname: impeccable\nversion: 4.1.2\n---\nC.\n');
    const lista = summarize(await discoverSkills({ kind: 'project', path: proy, id: 'mi-proy' }));
    expect(Object.fromEntries(lista.map((s) => [s.name, s.own]))).toEqual({ audit: true, generada: false, impeccable: false, 'openspec-propose': false });
    // Sin id, el proyecto es el nombre de su carpeta («proy»): MiProy ya no coincide.
    expect(summarize(await discoverSkills({ kind: 'project', path: proy })).some((s) => s.own)).toBe(false);
  });

  it('de usuario, solo son propias las subidas a claude.ai por la cuenta', async () => {
    crear(home, '.claude/skills/synced/b1/mia/SKILL.md', skill('mia', 'x'));
    crear(home, '.claude/skills/synced/b1/docx/SKILL.md', skill('docx', 'x'));
    crear(home, '.claude/skills/synced/b1/ejemplo/SKILL.md', skill('ejemplo', 'x'));
    crear(home, '.claude/skills/synced/b1/manifest.json', JSON.stringify({
      skills: [
        { name: 'mia', source: 'plugin' },
        { name: 'docx', source: 'anthropic' },
        { name: 'ejemplo', source: 'anthropic-example' },
      ],
    }));
    crear(home, '.claude/skills/synced/b2/sinmanifiesto/SKILL.md', skill('sinmanifiesto', 'x'));
    crear(home, '.claude/skills/local/SKILL.md', `---\nname: local\nmetadata:\n  author: yo\n---\nC.\n`);
    const lista = summarize(await discoverSkills({ kind: 'user', home }));
    expect(Object.fromEntries(lista.map((s) => [s.name, s.own]))).toEqual({ docx: false, ejemplo: false, local: false, mia: true, sinmanifiesto: false });
  });

  it('ignora un installed_plugins.json que no se puede interpretar', async () => {
    crear(home, '.claude/plugins/installed_plugins.json', '{ no es json');
    expect(await discoverSkills({ kind: 'user', home })).toEqual([]);
    crear(home, '.claude/plugins/installed_plugins.json', '[1,2]');
    expect(await discoverSkills({ kind: 'user', home })).toEqual([]);
  });

  it('resuelve por nombre y copia y lee frontmatter, cuerpo y archivos', async () => {
    crear(proy, '.claude/skills/uno/SKILL.md', skill('uno', 'Hace uno', '# Uno\n\nTexto.\n'));
    crear(proy, '.claude/skills/uno/scripts/run.sh', 'x');
    crear(proy, '.claude/skills/uno/scripts/hondo/otro.sh', 'x');
    crear(proy, '.claude/skills/uno/notas.md', 'x');
    crear(proy, '.agents/skills/uno/SKILL.md', skill('uno', 'Hace uno', 'Distinta.\n'));
    const grupos = await discoverSkills({ kind: 'project', path: proy });

    const { found, index } = resolveSkill(grupos, 'uno', 0);
    const c = await readSkillCopy(found, index);
    expect(c).toMatchObject({
      name: 'uno',
      copy: 0,
      agent: 'claude',
      label: 'Claude',
      path: '.claude/skills/uno',
      frontmatter: { name: 'uno', description: 'Hace uno' },
      body: '# Uno\n\nTexto.\n',
      // Un nivel más: las carpetas de la subcarpeta se nombran, sin entrar en ellas.
      files: ['notas.md', 'scripts/', 'scripts/hondo/', 'scripts/run.sh'],
    });
    const otra = resolveSkill(grupos, 'uno', 1);
    expect((await readSkillCopy(otra.found, otra.index)).body).toBe('Distinta.\n');

    for (const [n, k, estado] of [
      ['falta', 0, 404],
      ['uno', 5, 404],
      ['uno', -1, 400],
      ['uno', 1.5, 400],
      ['uno', '0', 400],
      ['', 0, 400],
      [undefined, 0, 400],
      ['../../etc', 0, 404],
    ] as const) {
      expect(() => resolveSkill(grupos, n, k), `${String(n)}/${String(k)}`).toThrowError(expect.objectContaining({ status: estado }));
    }
  });

  it('una skill con SKILL.md demasiado grande no se lista', async () => {
    crear(proy, '.claude/skills/grande/SKILL.md', skill('grande', 'x', 'a'.repeat(1024 * 1024 + 1)));
    expect(await discoverSkills({ kind: 'project', path: proy })).toEqual([]);
  });

  it('lanzar un editor que no existe da un 501 claro', async () => {
    const previo = process.env.PATH;
    process.env.PATH = join(tmp, 'sin-nada');
    try {
      await expect(launchVSCode(proy)).rejects.toSatisfy((e) => e instanceof SkillError && e.status === 501 && /code/.test(e.message));
    } finally {
      process.env.PATH = previo;
    }
  });
});

describe('isOwnCopy', () => {
  it('compara el autor con el proyecto sin mayúsculas ni separadores y descarta las generadas', () => {
    expect(isOwnCopy({ metadata: { author: 'smashadvisor' } }, 'SmashAdvisor')).toBe(true);
    expect(isOwnCopy({ metadata: { author: 'jgonaz_portfolio' } }, 'jgonaz-portfolio')).toBe(true);
    expect(isOwnCopy({ metadata: { author: 'smashadvisor', generatedBy: '1.0' } }, 'SmashAdvisor')).toBe(false);
    expect(isOwnCopy({ metadata: { author: 'openspec' } }, 'SmashAdvisor')).toBe(false);
    expect(isOwnCopy({ author: 'smashadvisor' }, 'SmashAdvisor')).toBe(false);
    expect(isOwnCopy({ metadata: { author: '' } }, '')).toBe(false);
    expect(isOwnCopy({}, 'x')).toBe(false);
  });
});
