import { describe, expect, it } from 'vitest';
import type { SkillCopy, SkillSummary } from '../types.ts';
import { skillCountLabel, skillSections, skillTags } from './skills.ts';

const copia = (agent: SkillCopy['agent'], label: string): SkillCopy => ({ agent, label, path: `${label}/x`, hash: label });

describe('skillTags', () => {
  it('una etiqueta por agente u origen, sin repetir y en el orden de las copias', () => {
    expect(skillTags({ copies: [copia('claude', 'Claude'), copia('codex', 'Codex'), copia('codex', 'Codex'), copia('copilot', 'Copilot')] })).toEqual([
      { label: 'Claude', agent: 'claude' },
      { label: 'Codex', agent: 'codex' },
      { label: 'Copilot', agent: 'copilot' },
    ]);
  });

  it('distingue los plugins entre sí aunque todos sean de Claude', () => {
    expect(skillTags({ copies: [copia('claude', 'plugin a'), copia('claude', 'plugin b')] }).map((t) => t.label)).toEqual(['plugin a', 'plugin b']);
  });
});

describe('skillCountLabel', () => {
  it('singular y plural', () => {
    expect([0, 1, 2].map(skillCountLabel)).toEqual(['0 skills', '1 skill', '2 skills']);
  });
});

describe('skillSections', () => {
  const sk = (name: string, own: boolean): SkillSummary => ({ name, description: null, own, diverges: false, copies: [] });

  it('propias primero y de terceros después, conservando el orden', () => {
    expect(skillSections([sk('b', false), sk('a', true), sk('c', false)]).map((s) => [s.title, s.skills.map((x) => x.name)])).toEqual([
      ['Propias', ['a']],
      ['De terceros', ['b', 'c']],
    ]);
  });

  it('no muestra las secciones vacías', () => {
    expect(skillSections([sk('a', false)]).map((s) => s.key)).toEqual(['third']);
    expect(skillSections([])).toEqual([]);
  });
});
