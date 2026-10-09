# Clear the pre-existing analyzer findings in tests/test_delivery.py

Goal: make `tests/test_delivery.py` pass the repository gate, so that touching the
delivery suite no longer reports 237 unrelated blocking findings, without changing
what any test asserts.

## Context

Touching this file for a three-line pin fix surfaced 237 blocking findings that are
all pre-existing, none of them on the added lines:

| Rule | Count (ruff) | Kind |
|---|---|---|
| `E702` multiple statements on one line (semicolon) | 205 | formatting |
| `E701` multiple statements on one line (colon) | 16 | formatting |
| `E731` lambda assignment | 6 | PEP 8 refactor |
| `reportArgumentType` / `reportOptionalMemberAccess` on `spec_from_file_location` | 9 | real narrowing gap |

The maintainer explicitly chose the full reformat, accepting the large diff.

Useful facts established before writing anything:

- The file contains **zero comments** (0 comment tokens), so an AST round trip loses
  nothing.
- `ruff check --select E701,E702,E731` finds 227 errors and offers **no safe fix**:
  splitting `if x: a;b` changes the indentation of the suite, so ruff marks those
  fixes unsafe. `black` and `autopep8` are not installed. `libcst` is not installed.
- `pyright` is not available as a CLI; the typing findings come from the bundled
  analyzer behind the editor gate.

## Locked decisions

1. **Split the change into two commits by nature**, because a whole-file rewrite is
   otherwise unreviewable:
   - Commit A: pure syntax. `ast.parse` -> `ast.unparse` over the whole file. This
     splits every one-line statement and normalizes formatting. It is provably
     behavior-preserving, and the proof is mechanical: `ast.dump` of the parse tree
     must be byte-identical before and after. That single fact is what makes the
     large diff reviewable.
   - Commit B: the small semantic part. The 6 `E731` lambdas become `def`s, and the
     3 `spec_from_file_location` sites get a None guard.
2. **The `E731` conversions are safe here**: all six are local helper closures
   (`quoted=lambda value:...`, `identity=lambda value:...`) assigned to a local name
   and called from that same scope, so `__name__` and `__qualname__` are not
   observed. They are not attributes, not class members, and not conditionally
   rebound.
3. **The typing guard is a real improvement, not a cast**: `spec_from_file_location`
   legitimately returns `None`, and `spec.loader.exec_module(...)` would raise an
   opaque `AttributeError`. The guard raises a clear `RuntimeError` naming the file.
   Same defect class as the `extractfile` guard already added in
   `tools/build_release.py`.
4. No behavior change is intended anywhere in this file.
5. This goes on its own branch `style/reformat-test-delivery`, stacked on the two
   fixes so it applies to the current file state and merges cleanly after them.
6. No push, no PR, no merge.

## Invariants that must not regress

- Every test keeps asserting what it asserted. The AST-equality proof in commit A
  is the mechanism; commit B's deltas are enumerated and reviewable one by one.
- `python -m pytest tests/` stays green with the same counts. Before this change:
  31 passed, 2 skipped.
- No `noqa` suppression is added anywhere. The findings must genuinely disappear.
- Test method names, the `SETUP_ID` / `OTHER_SETUP_ID` constants, and the skip
  conditions for the Windows profile fixtures are unchanged.

## Tasks

### T1 — Branch and tracking

Create `style/reformat-test-delivery` and this document.

### T2 — Commit A: pure syntax

Round-trip the file through `ast.parse` / `ast.unparse`, then prove
`ast.dump(ast.parse(new)) == ast.dump(ast.parse(old))` and record that the two
digests match. Record the ruff count before (227 E7 errors) and after (expect only
the 6 `E731`). Run the full suite.

### T3 — Commit B: lambdas and spec guards

Convert the 6 `E731` sites and add the 3 None guards. Verify 0 `E7` findings from
ruff and green tests.

### T4 — Final verification and commits

Confirm the file reports no blocking findings through the editor gate, the suite is
green on the same counts, and no `noqa` was introduced. Commit and record evidence.

## Evidence

_(filled in as the tasks close)_
