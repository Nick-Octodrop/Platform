#!/usr/bin/env python3
import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any


JARGON_TERMS = ("candidate_operations", "artifact_id", "manifest")
CAPABILITY_TAGS = {
    "create_module",
    "complete_module",
    "edit_existing",
    "remove",
    "scope_switch",
    "cross_module",
    "automation",
    "workflow",
    "conditions",
    "template",
    "email_template",
    "pdf_template",
    "jinja_template",
    "documents",
    "transformation",
    "real_world",
    "multi_entity",
    "business_flow",
}


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _scenario_index(path: Path | None) -> dict[str, dict]:
    if path is None or not path.exists():
        return {}
    raw = _read_json(path)
    if not isinstance(raw, list):
        return {}
    return {str(item.get("name")): item for item in raw if isinstance(item, dict) and isinstance(item.get("name"), str)}


def _assistant_texts(result: dict) -> list[str]:
    texts: list[str] = []
    final_body = result.get("final_session", {}).get("body") if isinstance(result.get("final_session"), dict) else {}
    if isinstance(final_body, dict) and isinstance(final_body.get("assistant_text"), str):
        texts.append(final_body.get("assistant_text"))
    for step in result.get("steps") if isinstance(result.get("steps"), list) else []:
        response = step.get("response") if isinstance(step.get("response"), dict) else {}
        body = response.get("body") if isinstance(response.get("body"), dict) else {}
        if isinstance(body.get("assistant_text"), str):
            texts.append(body.get("assistant_text"))
    return texts


def _jargon_hits(result: dict) -> list[str]:
    texts = "\n".join(_assistant_texts(result)).lower()
    return [term for term in JARGON_TERMS if term in texts]


def _capability_tags(tags: list[str]) -> list[str]:
    return [tag for tag in tags if isinstance(tag, str) and tag in CAPABILITY_TAGS]


def build_scoreboard(run_dir: Path, scenario_file: Path | None = None) -> dict[str, Any]:
    summary = _read_json(run_dir / "summary.json")
    scenario_lookup = _scenario_index(scenario_file)
    iteration_dir = run_dir / "iteration_001"
    results: list[dict[str, Any]] = []
    if iteration_dir.exists():
        for path in sorted(iteration_dir.glob("*.json")):
            raw = _read_json(path)
            if not isinstance(raw, dict):
                continue
            name = raw.get("name") or path.stem
            spec = scenario_lookup.get(str(name), {})
            tags = spec.get("tags") if isinstance(spec.get("tags"), list) else []
            result = {
                "name": str(name),
                "status": raw.get("status"),
                "passed": bool(raw.get("passed") if "passed" in raw else raw.get("status") == "passed"),
                "failure_stage": raw.get("failure_stage") or "none",
                "failure_reason": raw.get("failure_reason") or raw.get("error") or "",
                "tags": [tag for tag in tags if isinstance(tag, str)],
                "jargon_hits": _jargon_hits(raw),
            }
            results.append(result)

    by_tag: dict[str, dict[str, int | float]] = {}
    tag_counter: dict[str, list[dict[str, Any]]] = {}
    by_level: dict[str, dict[str, int | float]] = {}
    by_capability: dict[str, dict[str, int | float]] = {}
    level_counter: dict[str, list[dict[str, Any]]] = {}
    capability_counter: dict[str, list[dict[str, Any]]] = {}
    for result in results:
        for tag in result["tags"] or ["untagged"]:
            tag_counter.setdefault(tag, []).append(result)
        for capability in _capability_tags(result["tags"]):
            capability_counter.setdefault(capability, []).append(result)
        spec = scenario_lookup.get(result["name"], {})
        level = int(spec.get("level") or 0) if isinstance(spec, dict) else 0
        if level > 0:
            level_counter.setdefault(str(level), []).append(result)
    for tag, items in tag_counter.items():
        total = len(items)
        passed = sum(1 for item in items if item["passed"])
        by_tag[tag] = {
            "total": total,
            "passed": passed,
            "failed": total - passed,
            "pass_rate": round((passed / total) * 100, 1) if total else 0.0,
        }
    for level, items in level_counter.items():
        total = len(items)
        passed = sum(1 for item in items if item["passed"])
        by_level[level] = {
            "total": total,
            "passed": passed,
            "failed": total - passed,
            "pass_rate": round((passed / total) * 100, 1) if total else 0.0,
        }
    for capability, items in capability_counter.items():
        total = len(items)
        passed = sum(1 for item in items if item["passed"])
        by_capability[capability] = {
            "total": total,
            "passed": passed,
            "failed": total - passed,
            "pass_rate": round((passed / total) * 100, 1) if total else 0.0,
        }

    failed_items = [item for item in results if not item["passed"]]
    failure_stages = Counter(item["failure_stage"] or "unknown" for item in failed_items)
    failure_reasons = Counter((item["failure_reason"] or "unknown").splitlines()[0] for item in failed_items)
    jargon_examples = [item for item in results if item["jargon_hits"]]

    return {
        "run_dir": str(run_dir),
        "scenario_total": int(summary.get("scenario_total") or len(results)),
        "scenario_successes": int(summary.get("scenario_successes") or sum(1 for item in results if item["passed"])),
        "scenario_failures": int(summary.get("scenario_failures") or len(failed_items)),
        "overall_pass_rate": round(
            (
                int(summary.get("scenario_successes") or sum(1 for item in results if item["passed"]))
                / max(1, int(summary.get("scenario_total") or len(results)))
            )
            * 100,
            1,
        ),
        "by_capability": by_capability,
        "by_tag": by_tag,
        "by_level": by_level,
        "failure_stages": dict(failure_stages.most_common()),
        "top_failure_reasons": [
            {"reason": reason, "count": count}
            for reason, count in failure_reasons.most_common(10)
        ],
        "assistant_jargon_leaks": [
            {"name": item["name"], "terms": item["jargon_hits"]}
            for item in jargon_examples[:20]
        ],
    }


def _markdown(scoreboard: dict[str, Any]) -> str:
    lines = [
        "# Octo AI Scoreboard",
        "",
        f"- Run dir: `{scoreboard.get('run_dir')}`",
        f"- Total: `{scoreboard.get('scenario_total')}`",
        f"- Passed: `{scoreboard.get('scenario_successes')}`",
        f"- Failed: `{scoreboard.get('scenario_failures')}`",
        f"- Pass rate: `{scoreboard.get('overall_pass_rate')}%`",
        "",
        "## By Tag",
    ]
    by_tag = scoreboard.get("by_tag") if isinstance(scoreboard.get("by_tag"), dict) else {}
    for tag, stats in sorted(by_tag.items()):
        lines.append(
            f"- `{tag}`: {stats.get('passed')}/{stats.get('total')} passed ({stats.get('pass_rate')}%)"
        )
    lines.extend(["", "## By Level"])
    by_level = scoreboard.get("by_level") if isinstance(scoreboard.get("by_level"), dict) else {}
    if by_level:
        for level, stats in sorted(by_level.items(), key=lambda item: int(item[0])):
            lines.append(
                f"- `level {level}`: {stats.get('passed')}/{stats.get('total')} passed ({stats.get('pass_rate')}%)"
            )
    else:
        lines.append("- none")
    lines.extend(["", "## By Capability"])
    by_capability = scoreboard.get("by_capability") if isinstance(scoreboard.get("by_capability"), dict) else {}
    if by_capability:
        for capability, stats in sorted(by_capability.items()):
            lines.append(
                f"- `{capability}`: {stats.get('passed')}/{stats.get('total')} passed ({stats.get('pass_rate')}%)"
            )
    else:
        lines.append("- none")
    lines.extend(["", "## Failure Stages"])
    stages = scoreboard.get("failure_stages") if isinstance(scoreboard.get("failure_stages"), dict) else {}
    if stages:
        for stage, count in stages.items():
            lines.append(f"- `{stage}`: {count}")
    else:
        lines.append("- none")
    lines.extend(["", "## Top Failure Reasons"])
    reasons = scoreboard.get("top_failure_reasons") if isinstance(scoreboard.get("top_failure_reasons"), list) else []
    if reasons:
        for item in reasons:
            lines.append(f"- {item.get('count')}: {item.get('reason')}")
    else:
        lines.append("- none")
    lines.extend(["", "## Jargon Leaks"])
    leaks = scoreboard.get("assistant_jargon_leaks") if isinstance(scoreboard.get("assistant_jargon_leaks"), list) else []
    if leaks:
        for leak in leaks:
            lines.append(f"- `{leak.get('name')}`: {', '.join(leak.get('terms') or [])}")
    else:
        lines.append("- none")
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="Summarize an Octo AI eval run into a scoreboard.")
    parser.add_argument("--run-dir", required=True)
    parser.add_argument("--scenario-file", default="")
    parser.add_argument("--stdout-json", action="store_true")
    args = parser.parse_args()

    run_dir = Path(args.run_dir).resolve()
    scenario_file = Path(args.scenario_file).resolve() if args.scenario_file else None
    scoreboard = build_scoreboard(run_dir, scenario_file)
    (run_dir / "scoreboard.json").write_text(json.dumps(scoreboard, indent=2) + "\n", encoding="utf-8")
    (run_dir / "scoreboard.md").write_text(_markdown(scoreboard), encoding="utf-8")

    if args.stdout_json:
        print(json.dumps(scoreboard, indent=2))
    else:
        print(
            f"[scoreboard] total={scoreboard['scenario_total']} passed={scoreboard['scenario_successes']} "
            f"failed={scoreboard['scenario_failures']} pass_rate={scoreboard['overall_pass_rate']}%"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
