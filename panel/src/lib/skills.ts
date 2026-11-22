import type { SkillAgent, SkillSummary } from '../types.ts';

/** Etiquetas de una skill o un MCP: una por agente u origen distinto, en el orden de sus copias. */
export function skillTags(skill: { copies: readonly { label: string; agent: SkillAgent }[] }): { label: string; agent: SkillAgent }[] {
  const vistas = new Set<string>();
  const etiquetas: { label: string; agent: SkillAgent }[] = [];
  for (const c of skill.copies) {
    if (vistas.has(c.label)) continue;
    vistas.add(c.label);
    etiquetas.push({ label: c.label, agent: c.agent });
  }
  return etiquetas;
}

/** Texto accesible del recuento de la barra lateral: «1 skill», «3 skills». */
export const skillCountLabel = (n: number): string => `${n} ${n === 1 ? 'skill' : 'skills'}`;

export type SkillSection = { key: 'own' | 'third'; title: string; skills: SkillSummary[] };

/** Secciones de la lista: «Propias» y «De terceros», en ese orden y sin las vacías; dentro, el orden recibido. */
export function skillSections(skills: readonly SkillSummary[]): SkillSection[] {
  const secciones: SkillSection[] = [
    { key: 'own', title: 'Propias', skills: skills.filter((s) => s.own) },
    { key: 'third', title: 'De terceros', skills: skills.filter((s) => !s.own) },
  ];
  return secciones.filter((s) => s.skills.length > 0);
}
