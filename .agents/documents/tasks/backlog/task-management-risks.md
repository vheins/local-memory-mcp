# Risk Register: Task Management

| Risk | Likelihood | Impact | Mitigation Strategy |
|---|---|---|---|
| Over-reliance on cached `task-list` results | Low | Medium | Enforce a 'status=in_progress,pending' default to keep agent views fresh. |
| Interactive task creation hangs if client drops | High | Medium | Implement abort controllers and timeout for elicitation responses. |
| Deleted tasks reappear if caching is aggressive | Low | Low | Enforce hard delete or strict "archived" boolean checks on query level. |
