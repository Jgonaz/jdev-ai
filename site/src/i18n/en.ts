import type { Dictionary } from './es';

// Textos de la landing en inglés. Misma forma que el diccionario en castellano.
export const en: Dictionary = {
  meta: {
    title: 'jdev-ai · A harness for working with AI coding agents',
    description:
      'A lightweight, stack-agnostic harness of shared rules and workflows for working with AI coding agents across several independent projects.',
  },
  nav: {
    label: 'Sections',
    what: 'What it is',
    features: 'Features',
    panel: 'Panel',
    flow: 'Flow',
    start: 'Get started',
    language: 'Language',
  },
  hero: {
    eyebrow: 'Open source harness · MIT License',
    title: ['One set of rules.', 'Several agents.', 'All your projects.'],
    lead: 'jdev-ai is a lightweight, stack-agnostic harness: shared rules and workflows for working with coding agents across several independent projects, without copying them into every repository or depending on one vendor’s CLI.',
    start: 'Get started',
    github: 'View on GitHub',
    worksWith: 'Works with',
  },
  mock: {
    label:
      'Illustrative mock-up of the jdev-ai graphical panel: sessions grouped by project and a terminal with an agent',
    tabs: ['Home', 'Terminals', 'Projects', 'History'],
    projects: ['my-project', 'another-app'],
    sessions: [
      { title: 'Passkey login', state: 'Waiting for you' },
      { title: 'Styles migration', state: 'Working' },
      { title: 'Export reports to PDF', state: 'Idle' },
      { title: 'Cart fix', state: 'Done' },
    ],
    view: 'Terminal / Chat',
    lines: [
      'Implement passkey login',
      'This is a large change: I propose OpenSpec and a “login” worktree. Shall I start?',
      'Go ahead',
      'Delegating to implementer: form and credential registration',
      'Delegating to validator: project validations',
      '✓ no failures',
      'Ready to integrate. Shall I open the Pull Request?',
    ],
  },
  what: {
    eyebrow: '// what it is',
    title: 'The same questions, answered once',
    lead: 'When should the agent delegate? How do you resume a project after a week away? When does a change deserve a spec? How do parallel sessions avoid overwriting each other? The answers live in the harness, not copied into every repository.',
    cards: [
      {
        title: 'The harness defines how agents work',
        text: 'Each repository in <code>projects/</code> defines its own domain, code, dependencies and validations.',
      },
      {
        title: 'Not a monorepo or a workspace',
        text: 'Every project keeps its own <code>.git</code> and keeps working if the harness disappears.',
      },
      {
        title: 'No imposed stack or architecture',
        text: 'No package manager either. Each project’s <code>AGENTS.md</code> takes precedence over the global instructions.',
      },
    ],
  },
  features: {
    eyebrow: '// features',
    title: 'The whole cycle, with your approval at every step that matters',
    cards: [
      {
        title: 'Multi-agent launcher',
        text: '<code>bin/agent</code> opens a project with Claude Code, Codex, Copilot or OpenCode and tells you where you left off. It adds no configuration files to your projects.',
      },
      {
        title: 'Orchestration and delegation',
        text: 'The main agent orchestrates and delegates bounded work to subagents. The policy is provider-agnostic.',
      },
      {
        title: 'Context and token economy',
        text: 'The orchestrator keeps the conversation and the decisions; cheaper models read and implement, and return only conclusions.',
      },
      {
        title: 'Project continuity',
        text: 'A local iteration history and an optional per-project memory let you resume work days later.',
      },
      {
        title: 'Worktrees per feature',
        text: 'Large changes are isolated in a worktree with its own branch. Several sessions work on one project without colliding.',
      },
      {
        title: 'Optional OpenSpec',
        text: 'The agent decides whether a change deserves a spec and proposes it. It creates no artifact without your explicit approval.',
      },
      {
        title: 'Design first',
        text: 'For non-trivial interface changes, it proposes closing the design first; that design becomes the reference for implementation and QA.',
      },
      {
        title: 'Autonomous close',
        text: '<code>/goal Close</code> makes the agent work without asking until everything is validated, integrated and cleaned up. It still asks before destructive actions.',
      },
      {
        title: 'Backlog, guides and images',
        text: 'Future work is recorded only after you confirm, didactic guides live in the project, and missing images are proposed before they are generated.',
      },
    ],
  },
  subagents: {
    title: 'Each subagent, one bounded role',
    columns: ['Subagent', 'Model', 'Role'],
    rows: [
      { name: 'Explore', model: 'Haiku', role: 'Read-only search and reading across the repository' },
      { name: 'implementer', model: 'Sonnet', role: 'The only one allowed to write; one bounded task at a time' },
      {
        name: 'validator',
        model: 'Haiku',
        role: 'Runs the project’s validations and reports only failures and their cause',
      },
      {
        name: 'qa',
        model: 'Sonnet',
        role: 'End-to-end QA in the browser with Playwright, before a feature is closed',
      },
    ],
    note: 'Roles defined for Claude Code. If a tool has no compatible subagents, the main agent plays the roles sequentially.',
  },
  panel: {
    eyebrow: '// graphical panel',
    title: 'All your sessions in a single window',
    lead: '<code>bin/panel</code> serves a local web panel that gathers the agent terminals of every project and tells you which one is waiting for you.',
    cards: [
      {
        title: 'Home',
        text: 'What needs your attention: sessions waiting for you, finished conversations, each project’s pending items and your activity.',
      },
      {
        title: 'Terminals that survive',
        text: 'They live in a dedicated tmux server: close the browser and they are still there. In one, two or four columns.',
      },
      {
        title: 'Chat view',
        text: 'The same session as a conversation: your messages, replies in Markdown and grouped tool calls, with search.',
      },
      {
        title: 'Backlog',
        text: 'A board by state with each project’s backlog and a “Work on this” shortcut that opens a new session.',
      },
      {
        title: 'Changes',
        text: 'The diff of the main checkout and of each worktree, with a file tree and a side-by-side or unified view.',
      },
      {
        title: 'History',
        text: 'The iterations of every project by day, with their pending items and a “Resume from here” shortcut.',
      },
    ],
    note: 'Local and private: served on 127.0.0.1 behind a token, and installable as an app (PWA).',
  },
  flow: {
    eyebrow: '// typical flow',
    title: 'From request to merge, without losing control',
    steps: [
      {
        title: 'Request',
        text: 'You say what you want and the orchestrator reads the project’s AGENTS.md.',
        approval: false,
      },
      {
        title: 'Proposal',
        text: 'If the change is large, it proposes OpenSpec, a worktree or a design and waits for your approval.',
        approval: true,
      },
      {
        title: 'Plan and exploration',
        text: 'Explore searches and reads the repository, read-only.',
        approval: false,
      },
      { title: 'Implementation', text: 'implementer carries out one bounded task at a time.', approval: false },
      {
        title: 'Validation',
        text: 'validator runs the validations the project defines.',
        approval: false,
      },
      {
        title: 'QA and review',
        text: 'With an interface, QA with Playwright after your OK. Then the orchestrator’s final review.',
        approval: true,
      },
      {
        title: 'Publishing',
        text: 'Commit, push, Pull Request and merge, only after your confirmation.',
        approval: true,
      },
      { title: 'History', text: 'The iteration is recorded so you can resume it another day.', approval: false },
    ],
    note: 'In amber, the steps that wait for your approval. Delegation is skipped for trivial tasks.',
  },
  start: {
    eyebrow: '// get started',
    title: 'Clone, add a project and launch an agent',
    lead: 'You need a POSIX shell, Git and the CLI of the agent you want to use. Add <code>gh</code> for the Pull Request flow of worktrees.',
    note: 'The rules are written in Spanish and agents reply in Spanish by default, unless the project says otherwise.',
    repo: 'View the repository',
    docs: 'Read the documentation',
    docsUrl: 'https://github.com/Jgonaz/jdev-ai/blob/main/README.en.md',
    terminal: 'terminal',
    comments: [
      '# 1. Clone the harness and add a project with its .git',
      '# 2. Launch an agent (Claude Code by default)',
      '# 3. Or open the graphical panel',
    ],
    repoPlaceholder: '<your-repo-url>',
    project: 'my-project',
  },
  footer: {
    by: 'Built by',
    role: ', a senior front-end developer focused on agent-driven development.',
    license: 'MIT License',
  },
};
