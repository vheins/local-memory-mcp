# User Stories: Task Management

**Feature:** Stateful Task Lifecycle Management via MCP

### 1. Goal Tracking
- **As an** AI agent, **I want** to use `task.manage` to register a new development objective, **so that** my work is explicitly tracked on the global Kanban board.

### 2. Safeguarded Progress
- **As a** Lead Developer, **I want** the system to prevent an agent from moving a task directly from `pending` to `completed`, **so that** it is forced to acknowledge the `in_progress` state during execution.

### 3. Transparent Delivery
- **As a** Project Manager, **I want** every completed task to include an estimate of actual tokens used, **so that** I can monitor the resource impact of different features.

### 4. Guided Creation
- **As a** Developer, **I want** the agent to use `task.manage` with elicitation when I provide vague directives, **so that** my tasks always have the necessary metadata (priority/phase) before starting.

### 5. Audit Visibility
- **As a** System Auditor, **I want** all status transitions to include a mandatory comment, **so that** there is a logged reason for every change in task state.