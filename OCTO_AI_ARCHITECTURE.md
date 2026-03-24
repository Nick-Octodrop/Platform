Octo AI Architecture Contract

Purpose:
- Keep Octo AI generic, scalable, and aligned with the OCTO kernel.
- Prevent drift into prompt-specific hacks, hardcoded business logic, or ad hoc manifest generation.
- Give humans, Codex, and overnight loops one source of truth for how Octo AI is supposed to work.

Non-negotiables:
1. ChatGPT/OpenAI is the designer
- The model should interpret the user’s business intent.
- The model should propose rich app/module structure in a strict design schema.
- The model is responsible for semantic design quality, not direct manifest generation.

2. OCTO is the deterministic compiler
- OCTO owns normalization, validation, dependency resolution, manifest compilation, sandbox promotion, and safety.
- OCTO must never blindly apply raw model output.
- The kernel manifest contract in `MANIFEST_CONTRACT.md` is the product truth.

3. Core planner/compiler logic must stay generic
- Do not add prompt-specific token checks, business-domain field bundles, or one-off family branches inline in `app/main.py` unless the logic is truly generic.
- If a fix introduces domain presets, they belong in declarative files under `specs/`, not scattered conditionals in planner/compiler core.
- `app/main.py` should orchestrate and compile. It should not become a growing library of business-specific heuristics.

4. Declarative domain knowledge beats inline conditionals
- Family defaults, naming hints, icons, statuses, and similar presets belong in data files such as `specs/octo_ai_design_families.json`.
- Real-world examples should live in eval/spec assets, not inside planner conditionals.

5. Design spec is the interface between model and compiler
- The model should produce a structured design spec.
- OCTO should normalize that design spec into safe internal structures.
- The compiler should consume the design spec, not implicit prompt heuristics.

6. Richness matters
- Good outputs are not thin CRUD scaffolds.
- Good outputs should cover relevant kernel surfaces when appropriate:
  - fields
  - workflows
  - actions/status buttons
  - conditions (`visible_when`, `enabled_when`, `required_when`)
  - views/pages/layout
  - automations/triggers/transformations
  - interfaces
  - dependencies/cross-module relationships

7. Eval-driven development must reward architecture, not hacks
- Overnight loops should prefer systemic fixes over one-off pass-the-test patches.
- If an eval failure can be fixed by improving declarative data, normalization, or compiler logic, do that instead of adding prompt-specific branching.
- Clean pass rates are not enough; the architecture must remain generic.

8. Preview truthfulness is mandatory
- The first assistant reply must describe planned changes in plain English.
- Preview text must match what OCTO can really compile/apply.
- Avoid internal jargon unless the user explicitly asks for it.

9. Multi-entity and cross-module planning are first-class
- New-module requests may imply multiple entities.
- Edit requests may imply workspace context and cross-module consequences.
- Create-module and workspace-change flows must remain distinct planning modes.

10. Templates and integrations are downstream capabilities
- First priority is robust modules, workflows, actions, conditions, and automations.
- Templates, PDFs, email, and integrations should build on that foundation, not replace it.

Preferred implementation order:
1. Generic planner/scope correctness
2. Generic compiler/manifest correctness
3. Workflow completeness
4. Conditions
5. Automations
6. Multi-entity design
7. Cross-module orchestration
8. Templates/integrations

Preferred places for change:
- `app/main.py`: generic planning/compiler/normalization behavior
- `specs/`: declarative presets, prompt banks, architecture data
- `tests/`: regression coverage for recurring failures
- `scripts/`: loop behavior, scoreboards, enforcement, orchestration

Bad changes:
- Adding `"vendor compliance"` or similar business strings to core planner code to fix one scenario
- Adding one-off field bundles in `app/main.py` for a single prompt class
- Making previews claim behavior the compiler does not support
- Solving eval failures by narrowing behavior to the exact scenario wording

Good changes:
- Moving family/domain defaults into `specs/`
- Making compiler logic derive workflow actions generically from statuses/transitions
- Improving design-spec normalization so richer model output survives compilation
- Adding realistic eval scenarios that pressure generic capabilities

Definition of success:
- A business user can ask for a realistic app/module in plain English.
- The model designs it well.
- OCTO compiles it safely and truthfully.
- Overnight loops improve the system without turning core code into a pile of hardcoded heuristics.
