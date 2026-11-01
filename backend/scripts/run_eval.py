"""Print the offline evaluation report. Run from the repo root."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.eval import run_eval  # noqa: E402
from app.eval_data import PAIRS  # noqa: E402


def main() -> int:
    first = run_eval()
    second = run_eval()
    print(f"pairs: {first.total_pairs} (fixed, offline)")
    print(f"field extraction accuracy: {first.field_accuracy:.2%}")
    print(f"mismatch detection rate:   {first.mismatch_detection_rate:.2%}")
    print(f"uncertainty gate rate:     {first.gate_rate:.2%}")
    print(f"false warnings:            {first.false_warnings}")
    print(f"scenario resolution:       {first.resolved_scenarios}/{first.total_scenarios}")
    print(f"execution time:            {first.eval_ms:.1f} ms")
    print(f"signature:                 {first.signature}")
    print(f"deterministic:             {first.signature == second.signature}")
    if first.failures:
        print("failures:")
        for failure in first.failures:
            print(f"  - {failure}")
        return 1
    print("EVAL-PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
