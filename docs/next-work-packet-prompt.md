# Next work packet prompt

```text
Continue StockControl development by identifying the next eligible work packet in
docs/implementation-playbook.md.

Read the packet's dependencies, requirements, ADRs, relevant README files, existing
code and tests. Choose the next packet based on the repository's actual completed
work; do not assume its ID.

Implement only that packet, including its required tests. Preserve unrelated changes,
run the focused checks and completion gate, and update documentation or traceability
where appropriate.

Finish with the playbook handoff format:

- Packet
- Status
- Outcome
- Files changed
- Migrations/contracts changed
- Tests added
- Commands run and results
- Commands not run and why
- Security/data/permission considerations
- Known limitations or follow-up
- Recommended next packet

If a prerequisite is missing or the packet is genuinely blocked, stop and report it
instead of inventing a solution.
```
