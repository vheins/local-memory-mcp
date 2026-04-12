# Risk Register: Task Management

| Risk | Likelihood | Impact | Mitigation Strategy |
|---|---|---|---|
| Race conditions when setting `task-active` | Low | Medium | Use atomic database transactions when toggling the active boolean flag. |
| Interactive task creation hangs if client drops | High | Medium | Implement abort controllers and timeout for elicitation responses. |
| Deleted tasks reappear if caching is aggressive | Low | Low | Enforce hard delete or strict "archived" boolean checks on query level. |
