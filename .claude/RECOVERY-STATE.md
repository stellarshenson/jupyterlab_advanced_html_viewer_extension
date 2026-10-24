# Recovery state

## BRACE 2026-10-24 22:55 CEST

### Horizon

- **LIMIT**. `brace-horizon` printed: `LIMIT 96% seven_day resets 2:00am (7444m)`
- The machine stays up. The same session returns after the reset, about 5 days and 4 hours later, at 02:00
- Resume in this project with `claude --continue`
- Session id: `0270e5f4-f057-47f8-84dc-01ef629f465f`

### Active goal, suspended by the brace (its clauses still open)

"All functionality done per acceptance criteria. Acceptance criteria updated via /project-management:project-management. Unit and Galata tests updated, all green. No open defects in docs/defects-advanced-html-viewer.md other than those the owner ruled deferred. All root causes addressed: fixed on a closed defect or ruled by the owner. Architecture sound: every row the adjudicator kept from the last /ponytail-review of the whole change before the adversarial review applied or ruled by the owner. Survived /devils-advocate:adversarial-review with a panel of architect, bug-hunter and ux-designer, last round SHIP"

Open clauses:

- Galata is not green. The last full run on 1.0.67 was 153 of 154, and the failure is DEF-VIEW-63
- Open defects remain
- The last review round returned PLAN, not SHIP

### Stopped workflows

| Workflow | Run id | Script | Args | Phase reached |
|---|---|---|---|---|
| untick-probe (DEF-VIEW-63 probe) | `wf_6b0add97-c17`, task `wkhf7h3cy`, stopped 22:55 | `tmp/workflows/untick-probe/workflow.js` | none | single agent `probe:untick`, in flight. No checkpoint `10-probe.md` yet. 1 failure captured, `records/fail-1792873202274-r4.json` (22:20) |
| adv-fix-r3 | `wf_27a69bb4-57a` (completed, not running) | `tmp/workflows/adv-fix-r3/workflow.js` | none | Fix stage done (C1, Z1, Z2, Z3, O3 applied, `10-fix.md`). The Untick stage, then Build, Galata and Verify, stopped because the probe checkpoint does not exist. The script has been edited (anchored `done()`, Untick prompt changed), so a resume reruns Untick and every stage after it |

- Transcript dirs: `~/.claude/projects/-home-lab-workspace-private-jupyterlab-jupyterlab-advanced-html-viewer-extension/0270e5f4-f057-47f8-84dc-01ef629f465f/subagents/workflows/<run id>/journal.jsonl`
- Same-session resume, which uses the cache: `Workflow({scriptPath: "<repo>/tmp/workflows/untick-probe/workflow.js", resumeFromRunId: "wf_6b0add97-c17"})`
- The probe agent is the only agent, so a resume reruns it. It is idempotent on `10-probe.md`, and its earlier records under `tmp/workflows/untick-probe/records*/` and `logs/untick-*.log` stay on disk. Tell it to read those records first rather than repeat the runs
- If nothing is cached: relaunch from the script path. There are no args

### Running (detached, survives the limit)

- PID `3678764`, ppid 1, started about 22:37: `jlpm playwright test --reporter=list --output=tmp/workflows/untick-probe/results tests/trust-race.spec.ts tests/zz-untick.spec.ts --repeat-each=20`, cwd `ui-tests/`
  - Its log is probably `logs/untick-zz2-in-race-20.log`
  - Its records go to `tmp/workflows/untick-probe/records/`
  - Let it finish, and harvest it on resume
- PID `3746687` belongs to `jupyterlab_ai_code_assistants_extension`. It is not ours; never touch it

### Working tree

- The stop changed nothing in the tree: `git status --porcelain` showed the same 38 lines before and after
- `ui-tests/tests/zz-untick.spec.ts` is the probe's scratch spec, untracked
  - It must go (`trash-put`) before any full Galata run or commit, once the probe has written `10-probe.md`
  - It writes to an absolute workstation path
- Installed build: 1.0.67. Its source is older than C1, Z2 and O3, which are applied in the tree but not built
- Uncommitted change: everything since HEAD `dfaab6d`. It is not committed and needs the Star Colonel's approval for each commit

### Valid results on disk

- `tmp/workflows/store-readback-fix/50-verify.md`: pass
  - DEF-STORE-62 fixed: the route answers the hash of the bytes written. pytest red, then green. Galata red 5 of 5, then green 20 of 20. ACC-LIVE-107 30 of 30
  - DEF-LIVE-60 and DEF-LIVE-61 test fixes: 25 of 25 each
  - Full Galata on 1.0.67: 153 of 154
- `tmp/workflows/adv-review/r3-return.json`: round 3 PLAN, converging, 5 MINOR, 1 change (C1)
- `tmp/workflows/adv-review/slop-return.json`: slop-hunter round PLAN, 7 MINOR, 3 changes (Z1-Z3)
- `tmp/workflows/adv-fix-r3/10-fix.md`:
  - C1, Z1, Z2, Z3, O3 applied, with `patch-<id>.diff` and `before-<id>/` copies
  - Jest 403 of 403
  - The O3 Galata case is red on 1.0.67 (`marks.spec.ts:658`, selected "" and 0 clicks)
- Trackers: 0 open criteria of 118. 11 open defects of 64:
  - DEF-VIEW-53, 54, 57, 59
  - DEF-MARK-55
  - DEF-LIVE-56, 58, 60, 61
  - DEF-STORE-62
  - DEF-VIEW-63
- `pm-tools check docs/`: 0 errors, 140 warnings (the baseline)

### Invalid or stale

- `tmp/workflows/adv-fix-r3/15-untick.md`, `20-build.md`, `30-galata.md`, `40-verify.md` all say STATUS: failed, because no probe verdict existed. The resume replaces them

### Decisions recorded

- DEF-MARK-55: the owner ruled, in review round 3, to land on pointerup and contextmenu. It was applied as O3
- DEF-VIEW-59: the owner ruled to keep the write-back and state the limit in the README (applied in round 2). Close or reject it after SHIP

### FIRST ACTION for the next session

1. Check PID 3678764 (`ps -p 3678764`), tail `logs/untick-zz2-in-race-20.log`, and list `tmp/workflows/untick-probe/records/`
2. Resume the probe: `Workflow({scriptPath: ".../tmp/workflows/untick-probe/workflow.js", resumeFromRunId: "wf_6b0add97-c17"})`. If it is not cached, relaunch with the script path. It must end with `10-probe.md` STATUS: done
3. Resume adv-fix-r3: `Workflow({scriptPath: ".../tmp/workflows/adv-fix-r3/workflow.js", resumeFromRunId: "wf_27a69bb4-57a"})`. Fix replays from the cache. Untick (U1), Build (1.0.68, make install approved for this campaign), Galata and Verify run
4. On a verify pass: review round 4 with `tmp/workflows/adv-review/workflow.js`
   - `args.state` from `r3-return.json`
   - `args.appliedFixes`: C1, Z1, Z2, Z3, O3, U1 (patches under `tmp/workflows/adv-fix-r3/`)
   - Target "Built and installed as 1.0.68"
   - The rest as in `args-r3.json`
5. On SHIP: ask the owner whether to run one confirmation round. Then close the fixed defects through pm-tools with evidence, decide DEF-VIEW-59 per the ruling, run graphify update and write a journal entry
