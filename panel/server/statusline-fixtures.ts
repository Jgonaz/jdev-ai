/** Muestra con la forma del JSON que Claude Code 2.1.316 pasa a la statusline. */
export const statuslineMuestra = (extra: Record<string, unknown> = {}) => ({
  session_id: 'abc-1',
  session_name: 'teclado',
  transcript_path: '/home/u/.claude/projects/x/abc-1.jsonl',
  cwd: '/home/u/proyectos/jdev-ai/projects/fitnessia',
  model: { id: 'claude-opus-5-5', display_name: 'Opus 5.5' },
  workspace: { current_dir: '/p', project_dir: '/p', added_dirs: [] },
  version: '2.1.316',
  output_style: { name: 'default' },
  context_window: {
    total_input_tokens: 500000,
    total_output_tokens: 20000,
    context_window_size: 1000000,
    current_usage: { input_tokens: 4000, output_tokens: 900, cache_creation_input_tokens: 10000, cache_read_input_tokens: 180000 },
    used_percentage: 19,
    remaining_percentage: 81,
  },
  effort: { level: 'medium' },
  thinking: { enabled: true },
  rate_limits: {
    five_hour: { used_percentage: 3.4, resets_at: 1_790_000_000 },
    seven_day: { used_percentage: 22, resets_at: 1_790_500_000 },
  },
  cost: { total_cost_usd: 8.58 },
  ...extra,
});
