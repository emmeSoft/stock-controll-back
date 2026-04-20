# Skill Registry

**Delegator use only.** Any agent that launches sub-agents reads this registry to resolve compact rules, then injects them directly into sub-agent prompts. Sub-agents do NOT read this registry or individual SKILL.md files.

## User Skills

| Trigger | Skill | Path |
|---------|-------|------|
| When creating a pull request, opening a PR, or preparing changes for review | branch-pr | file:///C:/Users/PODER%20JUDICIAL/.gemini/antigravity/skills/branch-pr/SKILL.md |
| When writing Go tests, using teatest, or adding test coverage | go-testing | file:///C:/Users/PODER%20JUDICIAL/.gemini/antigravity/skills/go-testing/SKILL.md |
| When creating a GitHub issue, reporting a bug, or requesting a feature | issue-creation | file:///C:/Users/PODER%20JUDICIAL/.gemini/antigravity/skills/issue-creation/SKILL.md |
| When user says "judgment day", "judgment-day", "review adversarial", "dual review", "doble review", "juzgar", "que lo juzguen" | judgment-day | file:///C:/Users/PODER%20JUDICIAL/.gemini/antigravity/skills/judgment-day/SKILL.md |
| When user asks to create a new skill, add agent instructions, or document patterns for AI | skill-creator | file:///C:/Users/PODER%20JUDICIAL/.gemini/antigravity/skills/skill-creator/SKILL.md |
| When user says "update skills", "skill registry", "actualizar skills", "update registry", or after installing/removing skills | skill-registry | file:///C:/Users/PODER%20JUDICIAL/.gemini/antigravity/skills/skill-registry/SKILL.md |

## Compact Rules

### branch-pr
- Follow the issue-first enforcement system
- All PRs must reference an issue number in title or body
- Use conventional commit format for commits within the PR

### go-testing
- Use teatest for Bubbletea TUI testing patterns
- Follow Go testing conventions from skill

### issue-creation
- Follow the issue-first enforcement system
- Include labels and project references

### judgment-day
- Launch two independent blind judge sub-agents simultaneously
- Synthesize findings and apply fixes
- Re-judge until both pass or escalate after 2 iterations

### skill-creator
- Follow the Agent Skills spec when creating new skills
- Include proper frontmatter and documentation

### skill-registry
- Scan user skills and project conventions
- Write .atl/skill-registry.md
- Save to engram if available

## Project Conventions

| File | Path | Notes |
|------|------|-------|
| CONTEXT-HANDOVER.md | c:\Users\PODER JUDICIAL\Desktop\controll\stock-controll-back\CONTEXT-HANDOVER.md | Project context handover |
| openspec/config.yaml | c:\Users\PODER JUDICIAL\Desktop\controll\stock-controll-back\openspec\config.yaml | SDD configuration |
| .atl/skill-registry.md | c:\Users\PODER JUDICIAL\Desktop\controll\stock-controll-back\.atl\skill-registry.md | This registry |

## Project Standards (auto-resolved)

### Global Agent Rules
- Never add "Co-Authored-By" or AI attribution to commits
- Never build after changes
- When asking a question, STOP and wait for response
- Never agree with user claims without verification
- If user is wrong, explain WHY with evidence
- Always propose alternatives with tradeoffs when relevant
- Verify technical claims before stating them

### Language & Tone
- Spanish input → Rioplatense Spanish (voseo)
- English input → same warm energy
- Passionate and direct, but from a place of caring
- CAPS for emphasis

### Testing
- No formal test framework installed in package.json
- Tests run manually via `node tests/...`
- Strict TDD disabled — Strict TDD Mode unavailable (no test runner detected)
