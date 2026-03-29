Octo AI Architecture Contract

Purpose:
- Keep Octo AI generic, scalable, and aligned with the OCTO kernel.
- Prevent drift into prompt-specific hacks, hardcoded business logic, or ad hoc manifest generation.
- Give humans, Codex, and overnight loops one source of truth for how Octo AI is supposed to work.

Canonical usage:
- This is the primary architecture reference for Octo AI work.
- Every future Octo AI change should be checked against this document before implementation.
- If a proposed change conflicts with this document, update this document deliberately first or explicitly document the exception.

Working protocol:
1. Read this file before changing Octo AI behavior.
2. Frame the request in terms of planner, compiler, validator, sandbox, release, or eval architecture.
3. Prefer changes to declarative specs, normalization, validation, and plan structure before adding new branching logic.
4. After the change, verify the behavior still matches this contract.
5. If the contract needs to evolve, update this file in the same stream of work.

Primary system shape:
- `user request -> planner -> structured operations -> deterministic compiler -> validator -> sandbox apply -> release`
- The planner may ask clarifying questions.
- The planner may produce multiple operations for one request.
- The compiler and validator must remain deterministic and schema-aware.

What Octo AI is:
- A workspace-aware change planner and safe builder for OCTO.
- It is not a raw prompt-to-manifest generator.
- It is not a collection of domain-specific prompt hacks.
- It is not a single-intent wizard that forces every request into one bucket.

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
- Do not hardcode business keywords as routing logic just to make one eval or one customer request pass.
- Do not encode “if prompt contains X, create Y module” style behavior unless X is part of a stable product grammar.

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
- One user request may legitimately require several operation types at once.
- Example: a request can require module creation, workflow setup, and automation wiring in one plan.
- The planner must support multi-operation requests instead of forcing a single category too early.

10. Templates and integrations are downstream capabilities
- First priority is robust modules, workflows, actions, conditions, and automations.
- Templates, PDFs, email, and integrations should build on that foundation, not replace it.

11. Clarification is allowed, but only when it adds real safety or precision
- Do not force the user through a rigid first-step category picker for every request.
- Optional shortcuts are acceptable.
- Mandatory clarification should only happen when:
  - scope is materially ambiguous
  - the request has multiple valid interpretations with different outcomes
  - destructive behavior is implied
  - required business inputs are missing

12. Intent taxonomy must stay small and composable
- Do not try to train or branch for every request wording.
- Maintain a compact set of operation families, for example:
  - `create_module`
  - `edit_module`
  - `cross_module_change`
  - `workflow_change`
  - `automation_change`
  - `template_change`
  - `integration_change`
  - `data_model_change`
  - `ui_layout_change`
- A plan can contain more than one operation family.

Planner contract:
- The planner should return a structured plan, not just prose.
- The structured plan should be able to express:
  - overall intent
  - requested scope
  - target artifacts
  - one or more operations
  - assumptions
  - clarifications
  - risks
  - user-facing summary
- The planner should not assume a single artifact type when the request clearly spans several.

UX policy:
- Freeform natural language should remain the default entry point.
- Optional “what are you trying to change?” chips are acceptable as accelerators, not as a hard gate.
- Suggested chips can include:
  - `Create module`
  - `Edit module`
  - `Cross-module`
  - `Automation`
  - `Template`
  - `Not sure`
- If chips are added, the freeform request must still support mixed requests without forcing one label.

Validation policy:
- Guardrails belong in validation and compilation, not only in prompting.
- The system must reject or question:
  - undeclared dependencies
  - invalid manifest structures
  - invalid field mappings
  - unsupported workflow transitions
  - automations with incomplete trigger/action definitions
  - previews that promise behavior the compiler cannot produce

Where domain knowledge belongs:
- `specs/octo_ai_design_families.json` for reusable family defaults
- `specs/octo_ai_real_world_prompt_bank.json` for real examples
- `specs/octo_ai_eval_*.json` for measurable regression suites
- `tests/` for deterministic behavior coverage
- Not inside scattered keyword branches in planner/compiler core

When to add a clarifying question:
- Good examples:
  - “Should this be a new module or an extension of Jobs?”
  - “Which status should trigger the email?”
  - “Who should receive the notification?”
- Bad examples:
  - asking the user to classify the request when the system can infer it safely
  - forcing a single category for a mixed request
  - asking for information the compiler does not actually need

Evaluation policy:
- Improvement should be measured by capability, not by memorizing prompt phrasings.
- Core eval dimensions should include:
  - intent extraction quality
  - operation decomposition quality
  - clarification quality
  - compiler validity
  - sandbox validation pass rate
  - truthfulness of preview/plan text
  - resistance to prompt-specific overfitting

Architecture review questions for every Octo AI change:
1. Does this make the planner/compiler more generic or more brittle?
2. Is this knowledge better expressed in `specs/` than in code?
3. Does this support mixed-operation requests?
4. Does this improve validation or only prompt behavior?
5. Would this still make sense for a different customer/domain?
6. Are we improving the system, or only patching a wording-specific failure?

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
- Introducing structured multi-operation plans instead of single-bucket routing
- Adding targeted clarifying questions only where confidence or safety demands them

Definition of success:
- A business user can ask for a realistic app/module in plain English.
- The model designs it well.
- OCTO compiles it safely and truthfully.
- Overnight loops improve the system without turning core code into a pile of hardcoded heuristics.
- Mixed requests like “create a module and add an automation” work without the user needing to understand internal categories.

Target request examples:
- “Take this requirements document and build a CRM, quoting, job tracking, and invoicing system from it.”
- “Create a new quote PDF template using our company logo, brand colours, pricing table, terms, and signature section.”
- “Create me a new module to track equipment servicing, including service dates, technician notes, customer history, and automatic reminders.”
- “When a quote is accepted, create a job, assign it to the technician based on location, and send them an email with the job details.”
- “When a job is marked as completed, send the customer an email with a summary of the work completed and attach the service report as a PDF.”
