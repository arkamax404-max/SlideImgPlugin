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

### T2 — Commit A, purely syntactic (`7c99b03`)

The file was round-tripped through `ast.parse` -> `ast.unparse`, then the
collateral that the round trip introduced was normalized with ruff:

- `Q000` bad quotes: **855** single-quoted strings restored to double quotes.
  This was a real regression I introduced and initially missed, because `Q` is not
  in ruff's default rule set. Caught by probing a wider rule selection.
- `I001` unsorted imports: **1**. Not an ordering problem; `ast.unparse` drops the
  blank line after the import block.
- `UP034` extraneous parentheses: **4**.

The equivalence proof, re-run after every one of those normalizations:

```text
ast.dump(parse(new)) == ast.dump(parse(old)): True
sha256 old 0d057c7c41e46719eec1b89d296870a5ba6655062989b9411e550fe4dfc04099
sha256 new 316a67a2c33aa6ce5984967bb3d724ac5111b101a5ecc9ecb3dca980ea2698f6
372 lines -> 582 lines
```

`I001` and `UP034` do not change the AST, and `Q000` changes only quote syntax, so
all three preserve the proof. `I001` was fixed with ruff rather than by sorting
imports by hand, because sorting imports would have changed statement order and
broken the proof.

Committing an intermediate state has a consequence worth stating: commit A alone
still reports the `E731` and None-narrowing findings, because those are semantic
and deliberately deferred to commit B. Only the branch tip is clean.

### T3 — Commit B, the semantic remainder

1. **Six `E731` sites** converted from `name = lambda arg: body` to a two-line
   `def`. All six were local helper closures called from their own scope, five
   `quoted` and one `identity`, so `__name__` and `__qualname__` are never
   observed. Applied by a script that asserts the exact expected source text at
   each line number and fails closed on any mismatch, rather than by hand at six
   locations.
2. **Three `spec_from_file_location` guards**. The function legitimately returns
   `None`, and `spec.loader.exec_module(...)` would have raised an opaque
   `AttributeError`. Each site now raises a `RuntimeError` naming the module it
   could not load. Same defect class as the `extractfile` guard in
   `tools/build_release.py`.
3. **One `B905`**: `zip(positions, positions[1:] + [X])` gained `strict=True`.
   `len(positions[1:] + [X]) == len(positions)` by construction, so behaviour is
   unchanged, and a future edit that broke that equality now fails loudly instead
   of silently skipping the last boundary check.

No `noqa` suppression was added anywhere.

### T4 — Final verification

Finding counts against the original, over a deliberately wide rule selection
(`E7,Q,I,UP,B,PLR,RUF,S`), to catch any regression I introduced rather than only
the rules I was targeting:

| Rule | Original | Final |
| --- | --- | --- |
| `E702` semicolon statements | 205 | 0 |
| `E701` colon statements | 16 | 0 |
| `E731` lambda assignment | 6 | 0 |
| `Q001` / `Q003` / `Q000` | 2 / 2 / 1 | 0 / 0 / 0 |
| `B905` zip without strict | 1 | 0 |
| `S603` subprocess without shell=True | 6 | 6 |
| `S607` partial path | 6 | 6 |
| `PLR2004` magic value | 1 | 1 |
| `RUF005` concatenation | 1 | 1 |
| **Total** | **247** | **15** |

232 findings cleared, and **zero new ones**: every one of the 15 remaining existed
before with an identical count.

The editor gate for the file went from **237 blocking findings to clean**:
`No issues across 1 file diagnosed this session.`

The three survivors were left deliberately:

- `S603` / `S607` on the `subprocess.run(["powershell.exe", ...])` calls. These are
  pre-existing and not gate rules. `S607` is the same class as the npm defect just
  fixed: a partial path resolved through PATH. It is not a live bug here because
  `powershell.exe` is a real executable, and it is mitigated in places by
  `POWERSHELL = shutil.which("powershell.exe")`.
- `PLR2004` suggesting the literal `3` in a test assertion become a constant.
  Rejected on purpose: extracting a named constant for a literal used once in a
  test makes the assertion harder to read, not easier.
- `RUF005` suggesting iterable unpacking instead of `positions[1:] + [X]`.
  Stylistic only.

Suite, before and after, unchanged: `python -m pytest tests/ -q` ->
**31 passed, 2 skipped**. The two skips are the Windows profile fixture tests that
require `IMAGESLIDE_WINDOWS_PROFILE_FIXTURE` and `IMAGESLIDE_WINDOWS_PROFILE_ID`.

Line endings: the repository requires LF (`.gitattributes`: `* text=auto eol=lf`).
`Path.write_text` under `core.autocrlf=true` on Windows rewrote the working tree as
CRLF; the committed blobs were always normalized to LF, and the working tree was
normalized back to LF. Final state: 594 lines, 0 CRLF.

### Residual observation, reported rather than hidden

`ruff --select E501` goes from 87 to 142 on this file. That metric got worse while
the file got less dense, which looks contradictory, so here are both measurements:

| Metric | Original | Final |
| --- | --- | --- |
| mean line length | 115.5 | 79.1 |
| lines longer than 88 chars | 193 | 142 |
| longest line | 1480 | 2017 |
| `E501` reported by ruff | 87 | 142 |

The file is objectively less dense (mean line length down 36, fewer overlong lines
in total), yet ruff reports more `E501`. The counts disagree because ruff's `E501`
skips overlong lines it cannot usefully split, and splitting the dense lines changed
which lines fall into that exemption. `E501` is not in the gate's rule set, and
wrapping 142 lines would be more churn on a file whose content is unchanged, so it
was left. Worth wrapping later if the maintainer wants a conventional line width.
