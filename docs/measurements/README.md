# Measurements

Raw output of `node scripts/measure-sync.js --clients 5 --edits 200`, three consecutive runs on 2026-10-12. Each file records the environment it ran in.

| Field | Meaning |
|---|---|
| `propagationToAllCollaboratorsMs` | From a local edit until every other connected client has it (one edit at a time, writers rotating) |
| `storedOnServerAckMs` | From a local edit until the server acknowledges it is written to MongoDB |
| `concurrentTyping` | Every client appends 100 paragraphs, 5 ms apart, each waiting for its acknowledgement; then all replicas must be identical |
| `reconnectCatchUp` | A client offline while another makes 200 edits and it makes 20 of its own; time from reconnecting until converged and stored |
| `coldOpenMs` | A new client connecting and receiving the full document |
| `serverMetrics.latencyMs.persistMs` | Duration of each `insertMany` batch in the server's write queue |

All runs use loopback networking on one machine, so they measure server and database work, not network latency.
