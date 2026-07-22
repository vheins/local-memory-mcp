# Risk Register: Task Management

| Risk                                            | Likelihood | Impact | Mitigation Strategy                                                                               | Status       |
| :---------------------------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------------------- | ------------ |
| Over-reliance on cached `task-list` results     | Low        | Medium | Default filter shows `in_progress,pending,backlog,blocked` to keep agent views fresh.             | ✅ Mitigated |
| Interactive task creation hangs if client drops | High       | Medium | Abort controllers and timeout for elicitation responses.                                          | ✅ Mitigated |
| Deleted tasks reappear if caching is aggressive | Low        | Low    | Hard delete with CASCADE on task_comments.                                                        | ✅ Mitigated |
| Task transition validation bypassed via API     | Medium     | High   | Server-side transition validation enforced in `TaskEntity`. `force` flag available for admin use. | ✅ Mitigated |
| Concurrent task updates cause state conflicts   | Low        | Medium | Write lock via `WriteLock.withLock()` prevents concurrent mutations.                              | ✅ Mitigated |

All risks have been addressed.
