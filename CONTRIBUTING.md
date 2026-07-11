# Contributing to Agentshire

Thank you for your interest in Agentshire! We welcome contributions of all kinds — code, art, game design, soul files, documentation, and bug reports.

## Getting Started

### Prerequisites

- **Node.js** >= 18
- **npm** (comes with Node.js)
- **OpenClaw** >= 2026.3.7 (for full runtime testing; frontend can be developed independently)

### Setup

```bash
git clone https://github.com/Agentshire/Agentshire.git
cd Agentshire

# Install root dependencies (plugin layer)
npm install

# Build the town frontend
cd town-frontend && npm install && npm run build
```

### Development

```bash
# Frontend hot-reload dev server
cd town-frontend && npm run dev

# Visit http://localhost:20009?ws=ws://localhost:20008
# Visit http://localhost:20009/editor.html
# Visit http://localhost:20009/citizen-editor.html
```

### Running Tests

```bash
# Plugin + bridge layer tests
npm test

# Frontend tests
cd town-frontend && npx vitest run
```

## Project Structure

The codebase has three layers. See [AGENTS.md](./AGENTS.md) for the full architecture guide.

| Layer | Directory | Runtime | Description |
|-------|-----------|---------|-------------|
| Plugin | `src/plugin/` | Node.js | Hook translation, WebSocket server, AI tools, editor API |
| Bridge | `src/bridge/` | Browser | AgentEvent → GameEvent translation, Phase state machine |
| Frontend | `town-frontend/src/` | Browser | 3D rendering, NPC system, UI, editor, audio |

## How to Contribute

1. **Fork** the repository
2. **Create a branch** (`git checkout -b feature/my-feature`)
3. **Make your changes** and add tests if applicable
4. **Run tests** to make sure nothing breaks
5. **Commit** with a clear message describing what and why
6. **Open a Pull Request** against `main`

### What We're Looking For

- **Game Design**: game loops, growth systems, event systems, town pacing
- **Game Art**: buildings, characters, props, animations, UI, world atmosphere
- **Code**: Three.js frontend, Node.js backend, editor integration, mini-games, protocols
- **AI Engineering**: soul mode, NPC brain, long-term memory, multi-agent orchestration
- **Content**: NPC personas, soul files, dialogue, town narrative

See [ROADMAP.md](./ROADMAP.md) for current priorities.

### Code Conventions

- TypeScript with `strict: true`
- 2-space indentation
- No unnecessary comments that just narrate what the code does
- Bridge emits high-level intent events, not micro-operations (see [architecture rules](.cursor/rules/architecture.mdc))
- NPC animation is driven via `transitionTo(state)`, not direct `playAnim()` calls

### Soul Files

NPC personality files live in `town-souls/*.md`. To create a new character:

1. Copy `town-souls/SOUL_tpl.md` as a template
2. Define the character's name, personality, expertise, and speaking style
3. Place it in `town-souls/` or `~/.openclaw/town-souls/`

## Reporting Issues

- Use [GitHub Issues](https://github.com/Agentshire/Agentshire/issues)
- Include steps to reproduce, expected vs actual behavior, and browser/Node version
- Screenshots or screen recordings are very helpful for visual bugs

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
