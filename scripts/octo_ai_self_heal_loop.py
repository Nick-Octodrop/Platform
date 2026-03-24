#!/usr/bin/env python3
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.octo_ai_curriculum import build_active_suite, update_curriculum_state

EVAL_SCRIPT = ROOT / "scripts" / "octo_ai_eval.py"
DEFAULT_CODEX = Path("/mnt/c/Users/nicwi/.vscode/extensions/openai.chatgpt-26.5311.21138-win32-x64/bin/linux-x86_64/codex")
DEFAULT_BRIEF = ROOT / "OCTO_AI_SELF_HEAL_BRIEF.md"
ARCHITECTURE_CONTRACT = ROOT / "OCTO_AI_ARCHITECTURE.md"


def _timestamp() -> str:
    return datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")


def _write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def _read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except Exception:
        return ""


def _scenario_result_paths(run_dir: Path) -> list[Path]:
    iteration_dir = run_dir / "iteration_001"
    if not iteration_dir.exists():
        return []
    return sorted(iteration_dir.glob("*.json"))


def _truncate(text: str, limit: int = 240) -> str:
    value = (text or "").strip()
    if len(value) <= limit:
        return value
    return value[: limit - 3].rstrip() + "..."


def _step_failure_message(step: dict) -> str:
    response = step.get("response") if isinstance(step.get("response"), dict) else {}
    body = response.get("body") if isinstance(response.get("body"), dict) else {}
    errors = body.get("errors") if isinstance(body.get("errors"), list) else []
    first_error = errors[0] if errors and isinstance(errors[0], dict) else {}
    message = first_error.get("message") if isinstance(first_error.get("message"), str) else ""
    if not message and isinstance(body.get("message"), str):
        message = body.get("message")
    if not message and isinstance(step.get("error"), str):
        message = step.get("error")
    return _truncate(message or "unknown failure")


def _assistant_preview_from_result(result: dict) -> str:
    final_body = result.get("final_session", {}).get("body") if isinstance(result.get("final_session"), dict) else {}
    if isinstance(final_body, dict):
        assistant_text = final_body.get("assistant_text")
        if isinstance(assistant_text, str) and assistant_text.strip():
            return _truncate(" ".join(assistant_text.split()), 320)
    steps = result.get("steps") if isinstance(result.get("steps"), list) else []
    for step in reversed(steps):
        response = step.get("response") if isinstance(step.get("response"), dict) else {}
        body = response.get("body") if isinstance(response.get("body"), dict) else {}
        assistant_text = body.get("assistant_text")
        if isinstance(assistant_text, str) and assistant_text.strip():
            return _truncate(" ".join(assistant_text.split()), 320)
    return ""


def _read_scenario_specs(path: Path | None) -> list[dict]:
    if path is None or not path.exists():
        return []
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []
    return [item for item in raw if isinstance(item, dict)] if isinstance(raw, list) else []


def _build_failure_digest(run_dir: Path, summary: dict) -> dict:
    scenario_files = _scenario_result_paths(run_dir)
    failed_results: list[dict] = []
    for path in scenario_files:
        result = _read_json(path)
        if result.get("status") == "passed":
            continue
        steps = result.get("steps") if isinstance(result.get("steps"), list) else []
        first_failed = next((step for step in steps if step.get("status") == "failed"), None) or {}
        failed_results.append(
            {
                "name": result.get("name") or path.stem,
                "path": str(path),
                "failure_stage": result.get("failure_stage") or first_failed.get("step") or "unknown",
                "failure_reason": result.get("failure_reason") or _step_failure_message(first_failed),
                "assistant_preview": _assistant_preview_from_result(result),
                "patchset_id": result.get("patchset_id"),
            }
        )

    clusters: dict[tuple[str, str], dict] = {}
    for item in failed_results:
        key = (str(item.get("failure_stage") or "unknown"), str(item.get("failure_reason") or "unknown"))
        cluster = clusters.setdefault(
            key,
            {
                "failure_stage": key[0],
                "failure_reason": key[1],
                "count": 0,
                "example_scenarios": [],
            },
        )
        cluster["count"] += 1
        if len(cluster["example_scenarios"]) < 5:
            cluster["example_scenarios"].append(
                {
                    "name": item.get("name"),
                    "path": item.get("path"),
                    "assistant_preview": item.get("assistant_preview"),
                }
            )

    top_failures = sorted(clusters.values(), key=lambda item: (-item["count"], item["failure_stage"], item["failure_reason"]))
    return {
        "run_dir": str(run_dir),
        "scenario_total": int(summary.get("scenario_total") or 0),
        "scenario_successes": int(summary.get("scenario_successes") or 0),
        "scenario_failures": int(summary.get("scenario_failures") or 0),
        "top_failure_clusters": top_failures[:12],
        "failed_scenarios": failed_results,
    }


def _representative_failure_names(digest: dict, limit: int = 6) -> list[str]:
    names: list[str] = []
    clusters = digest.get("top_failure_clusters") if isinstance(digest.get("top_failure_clusters"), list) else []
    for cluster in clusters:
        examples = cluster.get("example_scenarios") if isinstance(cluster.get("example_scenarios"), list) else []
        for example in examples:
            name = example.get("name")
            if isinstance(name, str) and name and name not in names:
                names.append(name)
                break
        if len(names) >= limit:
            return names[:limit]
    failed = digest.get("failed_scenarios") if isinstance(digest.get("failed_scenarios"), list) else []
    for item in failed:
        name = item.get("name")
        if isinstance(name, str) and name and name not in names:
            names.append(name)
        if len(names) >= limit:
            break
    return names[:limit]


def _build_replay_suite(source_suite_path: Path | None, scenario_names: list[str], output_path: Path) -> list[dict]:
    specs = _read_scenario_specs(source_suite_path)
    wanted = set(scenario_names)
    replay_suite = [item for item in specs if isinstance(item.get("name"), str) and item.get("name") in wanted]
    if replay_suite:
        _write_text(output_path, json.dumps(replay_suite, indent=2))
    return replay_suite


def _scoreboard_summary(scoreboard: dict) -> str:
    total = int(scoreboard.get("scenario_total") or 0)
    passed = int(scoreboard.get("scenario_successes") or 0)
    failed = int(scoreboard.get("scenario_failures") or 0)
    pass_rate = scoreboard.get("overall_pass_rate")
    by_level = scoreboard.get("by_level") if isinstance(scoreboard.get("by_level"), dict) else {}
    level_bits = []
    for level, stats in sorted(by_level.items(), key=lambda item: int(item[0])):
        level_bits.append(f"level {level}: {stats.get('passed')}/{stats.get('total')} ({stats.get('pass_rate')}%)")
    base = f"total={total}, passed={passed}, failed={failed}, pass_rate={pass_rate}%"
    if level_bits:
        return base + "; " + "; ".join(level_bits[:4])
    return base


def _curriculum_summary(curriculum_status: dict) -> str:
    if not curriculum_status:
        return ""
    parts = [
        f"evaluated_level={curriculum_status.get('evaluated_level')}",
        f"current_level_after_run={curriculum_status.get('current_level_after_run')}",
        f"pass_rate={curriculum_status.get('current_level_pass_rate')}%",
        f"streak={curriculum_status.get('streak')}/{curriculum_status.get('required_streak')}",
    ]
    if curriculum_status.get("unlocked_level"):
        parts.append(f"unlocked_level={curriculum_status.get('unlocked_level')}")
    promotions = curriculum_status.get("promotions") if isinstance(curriculum_status.get("promotions"), list) else []
    if promotions:
        parts.append("promotions=" + ", ".join(str(item) for item in promotions[:5]))
    return "; ".join(parts)


def _failure_digest_markdown(digest: dict) -> str:
    lines = [
        "# Octo AI Failure Digest",
        "",
        f"- Run dir: `{digest.get('run_dir')}`",
        f"- Scenarios: `{digest.get('scenario_total')}`",
        f"- Passed: `{digest.get('scenario_successes')}`",
        f"- Failed: `{digest.get('scenario_failures')}`",
        "",
        "## Top Clusters",
    ]
    clusters = digest.get("top_failure_clusters") if isinstance(digest.get("top_failure_clusters"), list) else []
    if not clusters:
        lines.append("- No failed scenarios found.")
        return "\n".join(lines) + "\n"
    for idx, cluster in enumerate(clusters, start=1):
        lines.append(
            f"{idx}. `{cluster.get('failure_stage')}` x{cluster.get('count')}: {cluster.get('failure_reason')}"
        )
        for example in cluster.get("example_scenarios") if isinstance(cluster.get("example_scenarios"), list) else []:
            preview = example.get("assistant_preview")
            lines.append(f"   - {example.get('name')}: `{example.get('path')}`")
            if isinstance(preview, str) and preview:
                lines.append(f"     assistant preview: {preview}")
    return "\n".join(lines) + "\n"


def _git_status_snapshot() -> str:
    result = subprocess.run(
        ["git", "status", "--porcelain"],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        check=False,
    )
    return result.stdout


def _architecture_audit(root: Path, before_status: str, after_status: str) -> dict:
    changed_paths: list[str] = []
    before = {line[3:] for line in (before_status or "").splitlines() if len(line) > 3}
    after = {line[3:] for line in (after_status or "").splitlines() if len(line) > 3}
    changed_paths = sorted(after | before)
    findings: list[str] = []

    if "app/main.py" in changed_paths:
        diff = _run_capture(["git", "diff", "--unified=0", "--", "app/main.py"])
        added_lines = [
            line[1:]
            for line in (diff.stdout or "").splitlines()
            if line.startswith("+") and not line.startswith("+++")
        ]
        suspicious_patterns: list[str] = []
        for line in added_lines:
            if "token in lower" in line or " in lower for token in " in line:
                suspicious_patterns.append(line.strip())
                continue
            literals = re.findall(r"['\"]([a-z][a-z0-9_ -]{11,})['\"]", line)
            for literal in literals:
                literal = literal.strip()
                if "{" in literal or "}" in literal or "." in literal:
                    continue
                suspicious_patterns.append(literal)
        unique_patterns: list[str] = []
        for item in suspicious_patterns:
            if item not in unique_patterns:
                unique_patterns.append(item)
        if unique_patterns:
            findings.append(
                "Core planner file gained prompt/domain-specific literal logic; move domain knowledge into declarative specs or generic compiler code: "
                + ", ".join(unique_patterns[:6])
            )
    if not ARCHITECTURE_CONTRACT.exists():
        findings.append("Missing architecture contract file: OCTO_AI_ARCHITECTURE.md")

    return {
        "changed_paths": changed_paths,
        "findings": findings,
        "ok": not findings,
    }


def _run(cmd: list[str], *, stdin_text: str | None = None) -> int:
    return subprocess.run(
        cmd,
        cwd=str(ROOT),
        input=stdin_text,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    ).returncode


def _run_shell(cmd: str) -> int:
    return subprocess.run(
        ["/bin/bash", "-lc", cmd],
        cwd=str(ROOT),
        check=False,
    ).returncode


def _run_capture(cmd: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        cmd,
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )


def _build_fix_prompt(
    run_dir: Path,
    summary: dict,
    cycle: int,
    brief_text: str,
    digest: dict | None = None,
    scoreboard: dict | None = None,
    curriculum_status: dict | None = None,
    representative_names: list[str] | None = None,
) -> str:
    failures = summary.get("scenario_failures")
    successes = summary.get("scenario_successes")
    scenario_count = summary.get("scenario_total")
    digest_path = run_dir / "failure_digest.md"
    digest_json_path = run_dir / "failure_digest.json"
    scoreboard_path = run_dir / "scoreboard.md"
    curriculum_path = run_dir / "curriculum_status.md"
    brief_section = ""
    if isinstance(brief_text, str) and brief_text.strip():
        brief_section = f"\nPersistent brief:\n{brief_text.strip()}\n"
    cluster_lines: list[str] = []
    top_clusters = digest.get("top_failure_clusters") if isinstance(digest, dict) and isinstance(digest.get("top_failure_clusters"), list) else []
    for cluster in top_clusters[:3]:
        cluster_lines.append(
            f"- {cluster.get('failure_stage')} x{cluster.get('count')}: {cluster.get('failure_reason')}"
        )
    cluster_section = "\n".join(cluster_lines) if cluster_lines else "- none"
    scoreboard_section = _scoreboard_summary(scoreboard or {})
    curriculum_section = _curriculum_summary(curriculum_status or {})
    representative_section = ", ".join(representative_names or []) if representative_names else "none"
    architecture_path = ARCHITECTURE_CONTRACT
    return f"""You are working in the OCTO repo.

Latest Octo AI eval cycle:
- cycle: {cycle}
- run_dir: {run_dir}
- scenarios: {scenario_count}
- passed: {successes}
- failed: {failures}
{brief_section}
Architecture contract to follow first:
- {architecture_path}

Run artifacts to inspect first:
- {scoreboard_path}
- {curriculum_path}
- {digest_path}
- {digest_json_path}

Current scoreboard summary:
- {scoreboard_section}

Current curriculum summary:
- {curriculum_section or 'not available'}

Top failure clusters:
{cluster_section}

Representative failed scenarios to rerun mentally and in code:
- {representative_section}

Quality rubric for this fix pass:
- Follow `OCTO_AI_ARCHITECTURE.md` first. If a local fix conflicts with it, the architecture contract wins.
- Prefer one systemic fix per cluster over prompt-specific hacks.
- Preserve generic architecture. Do not solve eval failures by stuffing more prompt-specific business token checks, field bundles, or one-off domain branches into `app/main.py` when the fix belongs in declarative data or generic compiler/planner logic.
- Prefer updating declarative specs under `specs/` and reusable config structures over enlarging hardcoded planner conditionals.
- Improve the plain-English preview contract first, then planner correctness, then patch generation.
- Avoid technical jargon in assistant replies unless the user asked for it.
- If the user intent is mostly understood, preview the planned changes and ask for confirmation instead of generic module/field questions.
- Multi-request and cross-module prompts should be decomposed explicitly in the preview.

Task:
1. Inspect {scoreboard_path}, {curriculum_path}, {digest_path}, then only the representative failed scenario JSON files you actually need under {run_dir}/iteration_001.
2. Fix as many real Octo AI issues as possible in code, with strong focus on:
   - conversational quality
   - planner correctness
   - clarification flow
   - valid patchset generation
   - truthful assistant messaging
3. Prefer broad systemic fixes over one-off hacks.
4. Run targeted verification locally before finishing, especially for the representative failed scenarios above.
5. Do not ask the user questions. Just make the best fixes you can.

Constraints:
- Use apply_patch for edits.
- Do not revert unrelated user changes.
- Keep the focus on Octo AI quality.
- Preserve the architecture contract in `OCTO_AI_ARCHITECTURE.md`.
- Prefer compact inspection. Do not dump huge JSON files unless needed.
- If `rg` is unavailable in the shell, use a fallback like `git ls-files`, `find`, or PowerShell equivalents.

When done, leave the repo ready for the next eval cycle.
"""


def _run_postfix_verification(
    *,
    run_dir: Path,
    eval_args: list[str],
    scenario_file: Path | None,
    representative_names: list[str],
    score_script: Path | None,
) -> dict:
    if not representative_names or scenario_file is None:
        return {}
    replay_suite_path = run_dir / "postfix_verification_suite.json"
    replay_suite = _build_replay_suite(scenario_file, representative_names, replay_suite_path)
    if not replay_suite:
        return {}
    postfix_dir = run_dir / "postfix_verification"
    replay_eval_args = list(eval_args)
    if "--scenario-file" in replay_eval_args:
        idx = replay_eval_args.index("--scenario-file")
        if idx + 1 < len(replay_eval_args):
            replay_eval_args[idx + 1] = str(replay_suite_path)
        else:
            replay_eval_args.append(str(replay_suite_path))
    else:
        replay_eval_args.extend(["--scenario-file", str(replay_suite_path)])
    eval_cmd = [sys.executable, str(EVAL_SCRIPT), *replay_eval_args, "--output-dir", str(postfix_dir)]
    postfix_rc = _run(eval_cmd)
    postfix_summary = _read_json(postfix_dir / "summary.json")
    payload = {
        "scenario_names": representative_names,
        "suite_size": len(replay_suite),
        "return_code": postfix_rc,
        "summary": postfix_summary,
    }
    if score_script and postfix_summary:
        score_cmd = [sys.executable, str(score_script), "--run-dir", str(postfix_dir), "--scenario-file", str(replay_suite_path)]
        score_result = _run_capture(score_cmd)
        payload["score_return_code"] = score_result.returncode
        if score_result.returncode == 0:
            payload["score_stdout"] = (score_result.stdout or "").strip()
    _write_text(run_dir / "postfix_verification_summary.json", json.dumps(payload, indent=2))
    return payload


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run Octo AI eval -> Codex fix -> optional deploy in repeated cycles.")
    parser.add_argument("--runs-dir", default="", help="Parent directory for per-cycle outputs.")
    parser.add_argument("--cycles", type=int, default=0, help="Number of cycles to run. Use 0 to loop until stopped.")
    parser.add_argument("--sleep-seconds", type=float, default=0.0, help="Delay between completed cycles.")
    parser.add_argument("--label", default="self_heal", help="Prefix for generated run directories.")
    parser.add_argument("--codex-bin", default=str(DEFAULT_CODEX if DEFAULT_CODEX.exists() else "codex"), help="Path to Codex CLI.")
    parser.add_argument("--codex-model", default="", help="Optional model override for codex exec.")
    parser.add_argument("--instruction-file", default=str(DEFAULT_BRIEF), help="Persistent brief/instructions file passed into each Codex fix cycle.")
    parser.add_argument("--score-script", default="", help="Optional script run after each eval cycle to produce a scoreboard.")
    parser.add_argument("--score-scenario-file", default="", help="Optional scenario file passed into the score script.")
    parser.add_argument("--curriculum-base-scenario-file", default="", help="Optional base scenario file used to build an active curriculum suite before each cycle.")
    parser.add_argument("--curriculum-state-file", default="", help="Optional curriculum state file persisted across cycles.")
    parser.add_argument("--curriculum-max-provisional", type=int, default=4, help="Maximum provisional curriculum scenarios added per cycle.")
    parser.add_argument("--deploy-cmd", default="", help="Optional shell command to deploy after Codex makes changes.")
    parser.add_argument("--stop-on-clean", action="store_true", help="Stop automatically once a cycle has zero failures.")
    parser.add_argument("eval_args", nargs=argparse.REMAINDER, help="Arguments forwarded to scripts/octo_ai_eval.py after '--'.")
    return parser


def main() -> int:
    args = _build_parser().parse_args()
    eval_args = list(args.eval_args or [])
    if eval_args and eval_args[0] == "--":
        eval_args = eval_args[1:]
    if not eval_args:
        print("No eval arguments supplied. Pass octo_ai_eval.py args after '--'.", file=sys.stderr)
        return 2

    codex_bin = shutil.which(args.codex_bin) if not Path(args.codex_bin).exists() else args.codex_bin
    if not codex_bin:
        print(f"Codex CLI not found: {args.codex_bin}", file=sys.stderr)
        return 2
    instruction_file = Path(args.instruction_file).expanduser()
    brief_text = _read_text(instruction_file)
    if not brief_text.strip():
        print(f"Instruction file not found or empty: {instruction_file}", file=sys.stderr)
        return 2
    score_script = Path(args.score_script).expanduser() if args.score_script else None
    if score_script and not score_script.exists():
        print(f"Score script not found: {score_script}", file=sys.stderr)
        return 2
    score_scenario_file = Path(args.score_scenario_file).expanduser() if args.score_scenario_file else None
    curriculum_base = Path(args.curriculum_base_scenario_file).expanduser() if args.curriculum_base_scenario_file else None
    curriculum_state = Path(args.curriculum_state_file).expanduser() if args.curriculum_state_file else None
    if curriculum_base and not curriculum_base.exists():
        print(f"Curriculum base scenario file not found: {curriculum_base}", file=sys.stderr)
        return 2

    runs_dir = Path(args.runs_dir).expanduser() if args.runs_dir else ROOT / "storage" / "octo_ai_self_heal"
    runs_dir.mkdir(parents=True, exist_ok=True)
    if curriculum_base and curriculum_state is None:
        curriculum_state = runs_dir / "curriculum_state.json"

    cycle = 0
    while args.cycles <= 0 or cycle < args.cycles:
        cycle += 1
        run_dir = runs_dir / f"{args.label}_{cycle:03d}_{_timestamp()}"
        cycle_eval_args = list(eval_args)
        active_score_scenario_file = score_scenario_file
        if curriculum_base and curriculum_state:
            active_suite_path = run_dir / "active_scenarios.json"
            curriculum_status = build_active_suite(
                curriculum_base.resolve(),
                curriculum_state.resolve(),
                active_suite_path.resolve(),
                max_provisional=args.curriculum_max_provisional,
            )
            active_score_scenario_file = active_suite_path
            if "--scenario-file" in cycle_eval_args:
                idx = cycle_eval_args.index("--scenario-file")
                if idx + 1 < len(cycle_eval_args):
                    cycle_eval_args[idx + 1] = str(active_suite_path)
                else:
                    cycle_eval_args.append(str(active_suite_path))
            else:
                cycle_eval_args.extend(["--scenario-file", str(active_suite_path)])
            print(
                "[self-heal] cycle="
                f"{cycle} curriculum_level={curriculum_status['current_level']} "
                f"name={curriculum_status['level_name']} "
                f"active={curriculum_status['active_count']} "
                f"provisional={curriculum_status['provisional_count']}"
            )
        eval_cmd = [sys.executable, str(EVAL_SCRIPT), *cycle_eval_args, "--output-dir", str(run_dir)]
        print(f"[self-heal] cycle={cycle} eval_start output_dir={run_dir}")
        eval_rc = _run(eval_cmd)
        summary = _read_json(run_dir / "summary.json")
        if not summary:
            artifact_count = len(list((run_dir / "iteration_001").glob("*.json"))) if (run_dir / "iteration_001").exists() else 0
            print(f"[self-heal] cycle={cycle} eval_incomplete rc={eval_rc} artifacts={artifact_count}")
            return eval_rc or 1

        failures = int(summary.get("scenario_failures") or 0)
        successes = int(summary.get("scenario_successes") or 0)
        total = int(summary.get("scenario_total") or 0)
        print(f"[self-heal] cycle={cycle} eval_complete rc={eval_rc} passed={successes} failed={failures} total={total}")
        if eval_rc not in (0, 1):
            print("[self-heal] eval exited non-zero; stopping loop.")
            return eval_rc

        digest = _build_failure_digest(run_dir, summary)
        _write_text(run_dir / "failure_digest.json", json.dumps(digest, indent=2))
        _write_text(run_dir / "failure_digest.md", _failure_digest_markdown(digest))
        representative_names = _representative_failure_names(digest)
        scoreboard_payload: dict = {}
        if score_script:
            score_cmd = [sys.executable, str(score_script), "--run-dir", str(run_dir)]
            if active_score_scenario_file:
                score_cmd.extend(["--scenario-file", str(active_score_scenario_file)])
            score_result = _run_capture(score_cmd)
            if score_result.returncode == 0:
                output = (score_result.stdout or "").strip()
                if output:
                    print(output)
                scoreboard_payload = _read_json(run_dir / "scoreboard.json")
            else:
                err = (score_result.stderr or score_result.stdout or "").strip()
                print(f"[self-heal] cycle={cycle} score_failed rc={score_result.returncode} {err}")
        curriculum_result: dict = {}
        if curriculum_base and curriculum_state and active_score_scenario_file:
            curriculum_result = update_curriculum_state(
                run_dir.resolve(),
                active_score_scenario_file.resolve(),
                curriculum_state.resolve(),
            )
            print(
                "[self-heal] cycle="
                f"{cycle} curriculum_pass_rate={curriculum_result['current_level_pass_rate']} "
                f"level_after={curriculum_result['current_level_after_run']}"
            )
            if curriculum_result.get("unlocked_level"):
                print(f"[self-heal] cycle={cycle} curriculum_unlocked_level={curriculum_result['unlocked_level']}")
        if failures == 0 and args.stop_on_clean:
            print("[self-heal] clean cycle reached; stopping loop.")
            return 0

        before_status = _git_status_snapshot()
        fix_prompt = _build_fix_prompt(
            run_dir,
            summary,
            cycle,
            brief_text,
            digest=digest,
            scoreboard=scoreboard_payload,
            curriculum_status=curriculum_result,
            representative_names=representative_names,
        )
        prompt_path = run_dir / "codex_fix_prompt.txt"
        last_message_path = run_dir / "codex_last_message.txt"
        _write_text(prompt_path, fix_prompt)

        codex_cmd = [
            str(codex_bin),
            "exec",
            "--dangerously-bypass-approvals-and-sandbox",
            "-C",
            str(ROOT),
            "--output-last-message",
            str(last_message_path),
        ]
        if args.codex_model:
            codex_cmd.extend(["-m", args.codex_model])
        codex_cmd.append("-")

        print(f"[self-heal] cycle={cycle} codex_fix_start")
        codex_rc = _run(codex_cmd, stdin_text=fix_prompt)
        print(f"[self-heal] cycle={cycle} codex_fix_done rc={codex_rc}")
        if codex_rc != 0:
            print("[self-heal] codex fix pass failed; stopping loop.")
            return codex_rc

        after_status = _git_status_snapshot()
        repo_changed = before_status != after_status
        print(f"[self-heal] cycle={cycle} repo_changed={str(repo_changed).lower()}")
        architecture_audit = _architecture_audit(ROOT, before_status, after_status) if repo_changed else {}
        if architecture_audit:
            _write_text(run_dir / "architecture_audit.json", json.dumps(architecture_audit, indent=2))
            if not architecture_audit.get("ok"):
                print("[self-heal] cycle=" f"{cycle} architecture_audit_findings={len(architecture_audit.get('findings') or [])}")
                for finding in (architecture_audit.get("findings") or [])[:5]:
                    print(f"[self-heal] architecture_warning: {finding}")
        if repo_changed and representative_names:
            postfix_summary = _run_postfix_verification(
                run_dir=run_dir,
                eval_args=cycle_eval_args,
                scenario_file=active_score_scenario_file,
                representative_names=representative_names,
                score_script=score_script,
            )
            if postfix_summary:
                summary_payload = postfix_summary.get("summary") if isinstance(postfix_summary.get("summary"), dict) else {}
                print(
                    "[self-heal] cycle="
                    f"{cycle} postfix_verification rc={postfix_summary.get('return_code')} "
                    f"passed={summary_payload.get('scenario_successes')} "
                    f"failed={summary_payload.get('scenario_failures')} "
                    f"total={summary_payload.get('scenario_total')}"
                )

        if repo_changed and args.deploy_cmd:
            print(f"[self-heal] cycle={cycle} deploy_start")
            deploy_rc = _run_shell(args.deploy_cmd)
            print(f"[self-heal] cycle={cycle} deploy_done rc={deploy_rc}")
            if deploy_rc != 0:
                print("[self-heal] deploy failed; stopping loop.")
                return deploy_rc

        if args.sleep_seconds > 0:
            try:
                time.sleep(args.sleep_seconds)
            except KeyboardInterrupt:
                print("\n[self-heal] stopped by user")
                return 130
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
