#!/usr/bin/env python3
import argparse
import json
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EVAL_SCRIPT = ROOT / "scripts" / "octo_ai_eval.py"


def _timestamp() -> str:
    return datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")


def _read_summary(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run Octo AI eval suites in repeated cycles until completion or Ctrl+C.")
    parser.add_argument("--runs-dir", default="", help="Parent directory for per-cycle outputs.")
    parser.add_argument("--sleep-seconds", type=float, default=0.0, help="Delay between completed cycles.")
    parser.add_argument("--cycles", type=int, default=0, help="Number of cycles to run. Use 0 to run until stopped.")
    parser.add_argument("--label", default="eval_loop", help="Prefix for generated run directories.")
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

    runs_dir = Path(args.runs_dir).expanduser() if args.runs_dir else ROOT / "storage" / "octo_ai_eval_loops"
    runs_dir.mkdir(parents=True, exist_ok=True)

    cycle = 0
    while args.cycles <= 0 or cycle < args.cycles:
        cycle += 1
        output_dir = runs_dir / f"{args.label}_{cycle:03d}_{_timestamp()}"
        cmd = [sys.executable, str(EVAL_SCRIPT), *eval_args, "--output-dir", str(output_dir)]
        print(f"[octo-ai-loop] cycle={cycle} output_dir={output_dir}")
        try:
            result = subprocess.run(cmd, cwd=str(ROOT))
        except KeyboardInterrupt:
            print("\n[octo-ai-loop] stopped by user")
            return 130

        summary_path = output_dir / "summary.json"
        summary = _read_summary(summary_path)
        if summary:
            print(
                "[octo-ai-loop] cycle_complete"
                f" exit={result.returncode}"
                f" scenarios={summary.get('scenario_count')}"
                f" passed={summary.get('scenario_successes')}"
                f" failed={summary.get('scenario_failures')}"
            )
        else:
            written = len(list((output_dir / "iteration_001").glob("*.json"))) if (output_dir / "iteration_001").exists() else 0
            print(f"[octo-ai-loop] cycle_complete exit={result.returncode} summary=missing artifacts={written}")

        if result.returncode != 0:
            print("[octo-ai-loop] eval exited non-zero; stopping loop.")
            return result.returncode
        if args.sleep_seconds > 0:
            try:
                time.sleep(args.sleep_seconds)
            except KeyboardInterrupt:
                print("\n[octo-ai-loop] stopped by user")
                return 130
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
