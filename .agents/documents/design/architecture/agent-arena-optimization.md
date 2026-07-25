# Agent Arena: Optimization & Architecture Review

> **Version**: 1.0  
> **Scope**: Agent Arena — the real-time AI agent operations visualization in the Glassy Dashboard  
> **Architecture Constraint**: Pure presentation layer. All authoritative state from `local-memory-mcp`. Event-driven architecture.

---

## 1. Executive Summary

Agent Arena is a **genuine differentiator**. It visualizes AI agents working on tasks in real time using a pixel-art, RTS-inspired interface. This is not a gimmick — it solves a real operational need: _what are my agents doing right now?_

However, the current implementation has **six critical gaps**:

| #   | Gap                                                                                                 | Impact                                      | Priority |
| --- | --------------------------------------------------------------------------------------------------- | ------------------------------------------- | -------- |
| 1   | **No real telemetry** — agents show no health, confidence, cost, or context usage                   | Operators cannot diagnose problems visually | Critical |
| 2   | **Zones are static buckets** — no queue health, ETA, priority distribution, or bottleneck detection | Bottlenecks invisible until they break      | Critical |
| 3   | **Repositories are not first-class** — no repo health, active branches, or merge queue status       | Cannot correlate agent activity to repo     | High     |
| 4   | **No event timeline** — no history of task state changes, failures, or retries                      | Cannot audit or replay what happened        | High     |
| 5   | **No scalability layer** — at 500 agents / 5,000 tasks, the current canvas approach will degrade    | Unusable at scale                           | High     |
| 6   | **State model lacks event sourcing** — UI polls or recomputes rather than reacting to domain events | Inefficient, stale, hard to debug           | Critical |

**Recommendation**: Preserve the game-inspired aesthetic and the zone concept. Overhaul the data model, add telemetry/observability layers, introduce progressive disclosure for scale, and adopt an event-driven architecture that mirrors `local-memory-mcp`'s domain events.

---

## 2. UX Audit

### 2.1 Current State Analysis

From the codebase, Agent Arena currently comprises:

- **Canvas renderer** (`arenaRenderer.ts`): Draws pixel-art agents with walking/wandering animations, task cards, handoff vehicles
- **Transform layer** (`arenaTransform.ts`): Maps task status → zones, computes layout positions
- **Type system** (`arenaTypes.ts`): `VisualAgent`, `VisualTask`, `VisualHandoff`, `ArenaScene`
- **Composable** (`useAgentArena.ts`): Data fetching and handler creation
- **Svelte stores** (`stores.ts`): Reactive state containers
- **Zones**: Pending, In Progress, Backlog, Blocked, Therapy Room
- **Agents**: Pixel characters with hair/skin/pant variety, walking animation, wandering idle behavior

### 2.2 Identified Problems

#### P1: Information Density Inversion (Critical)

**Problem**: The visual is rich (animated agents, zones) but the _information_ is shallow. An operator sees agents walking but cannot tell what any agent is _doing right now_ — thinking, coding, testing, reviewing, blocked, waiting for memory sync, etc.

**Why**: The `VisualAgent` type has no `currentAction`, `status`, `confidence`, or `progress` fields. The renderer draws agents with visual variety (hair, skin, pants) but no operational state indicators.

**Evidence**: `arenaTypes.ts` `VisualAgent` interface — contains position/animation data but no telemetry.

#### P2: No Health Signals (Critical)

**Problem**: An agent could be stuck, spinning, erroring, or silently failing and the UI shows the same walking animation.

**Why**: No health indicators, no status icons, no color-coded states. All agents look equally "alive."

#### P3: Static Zones with No Queue Intelligence (High)

**Problem**: The "Pending" zone shows tasks but not _how many_, _how long they've waited_, _ETA_, or _priority distribution_. "Blocked" shows which tasks are blocked but not _why_ (dependency conflict, rate limit, token exhausted, human approval needed).

**Why**: Zone computation (`computeZones`, `placeTasksInZones`) only distributes tasks spatially. No zone-level metadata or aggregation.

#### P4: Task Cards Are Information-Poor (High)

**Problem**: `VisualTask` has position, size, and type — but no visible priority, owner, duration, retry count, token cost, or failure reason.

**Why**: The task visualization is a colored rectangle with a label. No progressive disclosure, no badges, no tooltip depth.

#### P5: No Repository Context (High)

**Problem**: Agents operate on repositories, but the Arena does not group agents or tasks by repository. There's no repository health, branch activity, or lock state visible.

**Why**: The data model has no `Repository` entity in the Arena scene. Repositories are a sidebar concept, not an Arena concept.

#### P6: No Event History / Timeline (Medium)

**Problem**: When something changes — a task fails, an agent picks up work, a dependency blocks — the operator sees the current state but not _what led to it_.

**Why**: No event log, no animation replay, no audit trail within the Arena.

#### P7: Therapy Room Concept Underdeveloped (Medium)

**Problem**: "Therapy Room" is a clever name but its purpose is ambiguous. Is it for failed agents? Idle agents? Under-performing agents? What happens to an agent in therapy? Does it come back?

**Why**: The concept has no defined state machine. The `therapySlotPosition` function suggests visual placement exists but no semantics around recovery/retry/cooldown.

#### P8: No Gamification Feedback (Low)

**Problem**: Agents complete tasks but there's no celebration, no streak indicator, no "mission complete" animation. The joy of watching work get done is muted.

**Why**: Completion is just a task disappearing or moving zones. No particle effects, no sound cues, no XP-like feedback.

#### P9: Cognitive Load from Homogeneous Agents (Medium)

**Problem**: Agents are visually distinct (hair color, skin tone, pants) but these attributes are _random_ — they don't encode meaningful information. An operator cannot tell at a glance which agent is which.

**Why**: `AGENT_COLORS`, `HAIR_COLORS`, `SKIN_TONES`, `PANT_COLORS` are randomized per agent name hash (`nameHash()`), not assigned by role, model, or team.

#### P10: No Keyboard or Screen Reader Support (High)

**Problem**: The canvas is likely a single interactive element with no accessibility tree, no focus management, no keyboard navigation for selecting/reading task/agent info.

**Why**: Canvas-based rendering is inherently inaccessible without ARIA fallthrough or DOM overlay.

---

## 3. Architecture Review

### 3.1 Current Architecture

```
local-memory-mcp (MCP server)
    ↓ HTTP/WebSocket
Dashboard API Controllers
    ↓ JSON
Svelte 5 Stores (reactive state)
    ↓ subscribe
Arena Composable (useAgentArena.ts)
    ↓ transform
arenaTransform.ts (computeZones → placeTasksInZones → buildArenaScene)
    ↓ scene graph
arenaRenderer.ts (Canvas 2D / PixiJS)
    ↓ draw
drawAgent, drawTask, drawZone, etc.
```

### 3.2 Problems

#### A1: Polling Instead of Streaming (Critical)

**Problem**: The UI likely polls the MCP server for task/agent state rather than subscribing to an event stream. This creates latency, wasted bandwidth, and race conditions.

**Evidence**: `createArenaHandler` in `useAgentArena.ts` suggests a handler pattern typical of request-response, not event subscription.

#### A2: Transform Layer Is Stateless (Medium)

**Problem**: `buildArenaScene` recomputes the entire scene graph on every data change. At 500 agents and 5,000 tasks, this will be expensive — recalculating positions for every entity when only one changed.

**Evidence**: `computeZones` and `placeTasksInZones` are pure functions that process the full set.

#### A3: No Differential Updates (High)

**Problem**: When a single task changes status, the entire scene rebuilds. This means the renderer redraws everything, causing unnecessary Canvas repaints.

#### A4: Animation and Logic Are Coupled (Medium)

**Problem**: `ArenaRenderer` handles both animation ticking (`requestAnimationFrame` loop with walking, wandering, handoff animations) and data rendering. This makes it hard to add new agent behaviors without touching the renderer.

**Evidence**: The renderer manages `WanderState`, idle behavior, handoff phases — all in one class.

#### A5: No Event Buffer / Coordinator (Critical)

**Problem**: Without an event coordinator layer, rapid state changes (many tasks completing simultaneously) cause visual jitter, animation conflicts, and dropped transitions.

### 3.3 Target Architecture

```
local-memory-mcp (MCP server)
    ↓ Event Stream (SSE / WebSocket)
┌──────────────────────────────────┐
│  Event Coordinator (new)          │  ← Buffers, deduplicates, orders events
│    → EventBus (typed)             │     Emits: TaskStarted, TaskFailed, AgentConnected, etc.
└──────┬───────────────────────────┘
       │ subscribe
┌──────▼───────────────────────────┐
│  Arena State Manager (new)        │  ← Pure, deterministic, testable
│    → Differential Patch Engine    │     Produces deltas, not full recompute
│    → Zone Aggregator              │     Computes zone health, ETA, bottlenecks
└──────┬───────────────────────────┘
       │ patches
┌──────▼───────────────────────────┐
│  Arena Renderer (refactored)      │  ← Receives patches, animates transitions
│    → Scene Graph (entity-based)   │     Each agent/task is a scene node
│    → Animation Controller         │     Manages tweens, easing, sequences
│    → Input Layer (DOM overlay)    │     Handles hover, click, keyboard
└──────────────────────────────────┘
```

### 3.3 Event-Driven Architecture (Mandatory Constraint)

Per the architecture constraint:

**The Arena MUST be a pure presentation layer — it never owns business state.**

The frontend subscribes to domain events from `local-memory-mcp`:

```
TaskCreated          → New task card appears in Pending zone
TaskAssigned         → Agent walks toward task
TaskStarted          → Agent status → "coding" / "testing" etc.
TaskPaused           → Agent status → "waiting", Pause icon
TaskBlocked          → Task moves to Blocked zone, Agent walks away
TaskRetryScheduled   → Task shows retry badge, countdown
TaskCompleted        → Celebration animation, task removed
TaskFailed           → Task moves to Recovery, error badge
AgentConnected       → Agent enters Arena
AgentDisconnected    → Agent fades out
MemoryCreated        → Agent shows "memory synced" speech bubble
MemoryUpdated        → Agent shows "memory updated" icon
RepositoryLocked     → Repository zone shows lock icon
RepositoryUnlocked   → Lock icon removed
```

**Every visual change is a reaction to a domain event — nothing polls.**

---

## 4. Information Hierarchy

### 4.1 Current Hierarchy

```
Top Bar
  ├── Live Status (green dot)
  ├── Agent Count
  ├── Task Count
  └── Repository Count
Arena Canvas
  ├── Zone 1: Pending
  │   └── Task cards (color-coded rectangles)
  ├── Zone 2: In Progress
  │   ├── Agents (walking/wandering)
  │   └── Task cards (attached to agents or zones)
  ├── Zone 3: Backlog
  │   └── Task cards
  ├── Zone 4: Blocked
  │   └── Task cards
  └── Zone 5: Therapy Room
      └── Idle/off agents
```

### 4.2 Target Hierarchy

```
GLOBAL CONTROLS (top bar)
  ├── Live Status Indicator (green/yellow/red + pulse rate)
  ├── Active Agent Count (clickable → agent sidebar)
  ├── Task Throughput (tasks/min, sparkline)
  ├── Repository Health (aggregate health bar)
  ├── Queue Depth (total pending + backlog)
  ├── Failure Rate (last 5 min, sparkline)
  └── Time Range Selector (5m / 15m / 1h / custom)

ARENA CANVAS
  ├── Minimap (new) — shows entire arena at zoomed-out scale
  │   └── Click to navigate to zone
  ├── Zone: Pending
  │   ├── Zone Header: name, count, ETA, oldest wait, priority pie
  │   └── Task Cards: priority stripes, wait time badge, ETA bar
  ├── Zone: In Progress
  │   ├── Zone Header: name, count, avg duration, active tool usage
  │   └── Agent + Task pairs:
  │       ├── Agent: pixel art + health ring + status icon + speech bubble
  │       └── Task: progress bar, duration, token cost, current action
  ├── Zone: Backlog
  │   ├── Zone Header: name, count, priority distribution, estimated total
  │   └── Grouped by priority level (P0, P1, P2, P3)
  ├── Zone: Blocked
  │   ├── Zone Header: name, count, blocked-by breakdown
  │   └── Grouped by block reason (Dependency, Rate Limit, Human, Conflict)
  ├── Zone: Recovery Center (was Therapy Room)
  │   ├── Zone Header: name, count, retry queue, cooldown timers
  │   └── Agents in cooldown with countdown rings
  └── Repository Clusters (new) — agents grouped by repository
      ├── Repository avatar/icon
      ├── Active branches
      ├── Locked files count
      └── Running workflows

EVENT TIMELINE (slide-out panel, new)
  ├── Chronological event stream
  ├── Filters by event type, agent, repository
  └── Click to highlight entity in Arena

SIDE PANEL (on selection, new)
  ├── Agent Detail: health, cost, latency, context, queue, tools
  ├── Task Detail: full execution history, retries, duration breakdown
  └── Repository Detail: branches, PRs, locks, workflows
```

### 4.3 Reading Order Priority

What operators scan for, in priority order:

1. **Is everything OK?** → Global status indicator (green/red pulse)
2. **Are there failures?** → Failure rate sparkline + Recent failures list
3. **What's blocked and why?** → Blocked zone with grouped causes
4. **What's in progress?** → In Progress zone with agent activity
5. **What's waiting?** → Pending queue health + ETA
6. **What just happened?** → Event timeline (slide-out)
7. **Deep dive** → Side panel on selection

---

## 5. Layout Improvements

### 5.1 Proportional Zone Sizing

**Problem**: Current zones likely have fixed or equal widths. With 5,000 tasks, Backlog dominates. With 200 agents, In Progress needs more space.

**Solution**: Dynamic zone sizing based on entity count, with minimum sizes and max constraints.

```
[ Top Bar — compact, always visible ]
[ Minimap — collapsible, top-right corner ]
[ Zoom Controls — bottom-right ]
┌──────────┬───────────┬──────────┬──────────┬──────────┐
│ Pending  │ In        │ Backlog  │ Blocked  │ Recovery │
│ (15%)    │ Progress  │ (30%)    │ (10%)    │ (10%)    │
│          │ (35%)     │          │          │          │
│          │           │          │          │          │
├──────────┴───────────┴──────────┴──────────┴──────────┤
│ Repository Cluster Strip (optional, collapsible)       │
│ [repo1 icon] [repo2 icon] ...                          │
└───────────────────────────────────────────────────────┘
[ Event Timeline — collapsible footer/pull-up ]
```

**Layout Rules**:

- Zones use CSS Grid / flex with `min-content` constraints
- When a zone exceeds its proportion, it gets a scrollable internal container
- Repository strip is below the main zone row, collapsible
- Minimap floats top-right, visible at zoom < 100%

### 5.2 Zone Overflow Handling

**Problem**: When Backlog has 3,000 tasks, it overflows visually.

**Solution**:

- **Aggregation mode**: At >50 tasks, zone collapses into a summary card showing count, ETA, priority distribution
- **Progressive reveal**: Hovering expands the zone, scrolling reveals more
- **Virtual scroll**: For >100 items in a zone, use virtual scrolling (only render visible items)

### 5.3 Responsive Layout

| Breakpoint  | Layout                                                       |
| ----------- | ------------------------------------------------------------ |
| ≥1400px     | Full 5-zone grid + repository strip + timeline               |
| 1000-1399px | 3-column: Pending+InProgress                                 | Backlog                            | Blocked+Recovery |
| 700-999px   | 2-column: Active (Pending+InProgress)                        | Waiting (Backlog+Blocked+Recovery) |
| <700px      | Single scrollable column, minimap becomes primary navigation |

---

## 6. Zone-by-Zone Improvements

### 6.1 Pending Zone

**Current**: Static list of unassigned tasks. No queue intelligence.

**Target**:

| Element           | What                                                                  | Why                     |
| ----------------- | --------------------------------------------------------------------- | ----------------------- |
| Zone header badge | `"12 tasks · ETA 4m 30s · oldest: 8m"`                                | Instant queue health    |
| Priority pie      | Mini donut chart showing P0/P1/P2/P3 distribution                     | See urgency at a glance |
| Wait-time heat    | Tasks color-shift from cool (just arrived) to warm (waiting too long) | Spot stale tasks        |
| ETA bar per task  | Thin progress bar showing estimated time-to-start                     | Manage expectations     |
| Group by priority | Sub-sections: P0 (critical), P1 (high), P2 (medium), P3 (low)         | Focus on what matters   |
| Sort controls     | "Newest First" / "Oldest First" / "Priority"                          | Operator preference     |

**Metrics to compute**:

- `average_wait_time` — seconds since task entered Pending
- `max_wait_time` — oldest task's wait duration
- `priority_distribution` — { p0: count, p1: count, p2: count, p3: count }
- `eta` — based on agent availability × average task duration

**Criticality**: High — queue health is fundamental ops feedback.

### 6.2 In Progress Zone

**Current**: Agents walk around with tasks. No progress visibility.

**Target**:

| Element           | What                                                                                   | Why                          |
| ----------------- | -------------------------------------------------------------------------------------- | ---------------------------- |
| Agent health ring | Colored ring around agent: green (healthy), yellow (degraded), red (failing)           | Health at a glance           |
| Status icon       | `⚡` coding, `🔍` searching, `🧪` testing, `📝` reviewing, `⏳` waiting, `🔄` retrying | What is it doing RIGHT NOW   |
| Progress bar      | Thin bar below task showing % complete (± confidence interval)                         | How close to done            |
| Duration badge    | `"2m 14s"` on each task                                                                | How long has it been running |
| Token usage       | `"1.2k tokens"`                                                                        | Cost awareness               |
| Current tool      | Tool name floating near agent: `search_symbols`, `memory-store`                        | What tool is being used      |
| Agent label       | Name + model (e.g., `frontend / GPT-4o`)                                               | Not random appearance        |

**Metrics to compute**:

- `avg_duration` per task type
- `active_agents` count
- `tool_usage_frequency` per agent
- `token_burn_rate` tokens/second

**Criticality**: Critical — this is where operators stare most.

### 6.3 Backlog Zone

**Current**: Dump of low-priority tasks.

**Evaluation**: The name "Backlog" is appropriate. It signals "these are important but not yet prioritized."

**Target**:

| Element              | What                                                                 | Why                                  |
| -------------------- | -------------------------------------------------------------------- | ------------------------------------ |
| Priority grouping    | P0 → P3 sections                                                     | See what's important buried in noise |
| Estimated total      | `"~4h total estimated"`                                              | Capacity planning                    |
| Auto-promotion badge | Tasks auto-promoted from Backlog → Pending get a `↗️ promoted` badge | See pipeline flow                    |
| Tag clusters         | Collapsible sections by tag/type                                     | Quick filtering                      |
| Sorting              | Priority / Created / Estimate / Last Updated                         | Flexible triage                      |

**Recommendation**: Keep "Backlog" — it's industry-standard and understood. Add forward-planning metadata.

**Criticality**: Medium — backlog is not urgent but capacity planning is.

### 6.4 Blocked Zone

**Current**: Tasks pile up with no indication of _why_.

**Target**:

| Block Reason    | Icon | Color            | Action                             |
| --------------- | ---- | ---------------- | ---------------------------------- |
| Dependency      | 🔗   | Amber `#F59E0B`  | Show blocking task link            |
| Rate Limit      | ⏱️   | Orange `#F97316` | Show cooldown countdown            |
| Human Approval  | 👤   | Blue `#3B82F6`   | Show approver + time since request |
| Merge Conflict  | 🔀   | Red `#EF4444`    | Show conflicting files             |
| Token Exhausted | 💰   | Purple `#A855F7` | Show reset time                    |
| Memory Conflict | 🧠   | Pink `#EC4899`   | Show conflicting memory            |
| Tool Error      | ⚙️   | Gray `#6B7280`   | Show error message                 |

**Zone groups tasks by reason** — the operator immediately sees "3 tasks blocked by rate limits" and "1 blocked on human approval."

**Root cause display**: Each blocked task shows its specific blocker in a compact chip.

**Criticality**: Critical — Blocked is the highest-signal zone for operator intervention.

### 6.5 Recovery Center (was Therapy Room)

**Current**: "Therapy Room" — clever but ambiguous. Agents go there when? To recover? To be fixed? To rest?

**Recommendation**: Rename to **Recovery Center**. This is semantically clear — agents come here to recover from failures, cooldown after rate limits, or await retry.

**Target**:

| Sub-area     | Purpose                                                           | Visual                      |
| ------------ | ----------------------------------------------------------------- | --------------------------- |
| Cooldown     | Agents waiting after rate limit / token exhaustion                | Countdown ring around agent |
| Retry Queue  | Tasks scheduled for retry with backoff                            | Stacked cards with timer    |
| Self-Healing | Agents running auto-recovery (memory compaction, context refresh) | Spinning icon + progress    |
| Human Review | Tasks/agents requiring human intervention                         | Pulsing attention badge     |

**State machine**:

```
TaskFailed
    ↓
Enter Recovery Center (cooldown)
    ├── Retry available → automatic retry after backoff
    ├── Human required → moves to Human Review area
    └── Fatal → stays in Recovery, alert triggered
```

**Criticality**: High — the Therapy Room is currently an unused concept. Recovery Center gives it purpose.

### 6.6 Summary: Zone Comparison

| Zone         | Old            | New                                       | Improvement                   |
| ------------ | -------------- | ----------------------------------------- | ----------------------------- |
| Pending      | Task list      | Queue with health, ETA, priority          | Can see bottlenecks forming   |
| In Progress  | Walking agents | Agents with health, status, progress bars | Know what each agent is doing |
| Backlog      | Task dump      | Organized by priority with estimates      | Capacity planning possible    |
| Blocked      | Task pile      | Grouped by cause with root display        | Fix faster                    |
| Therapy Room | Ambiguous      | Recovery Center with retry/cooldown       | Clear purpose and workflow    |

---

## 7. Agent Improvements

### 7.1 Current Agent Model

```typescript
interface VisualAgent {
	id: string;
	name: string;
	x: number;
	y: number; // position
	targetX: number;
	targetY: number; // walking target
	animPhase: number; // walk cycle
	color: string;
	facing: "left" | "right";
	state: "idle" | "walk" | "arrive" | "handoff";
}
```

This is too sparse. An operator cannot make decisions from this data.

### 7.2 Target Agent Model

```typescript
interface VisualAgent {
  // Identity
  id: string;
  name: string;
  model: string;                // e.g. "GPT-4o", "Claude-3.5"
  role: 'backend' | 'frontend' | 'debugger' | 'explore' | ...;

  // Position & Animation (existing)
  x: number; y: number;
  targetX: number; targetY: number;
  animPhase: number;
  facing: 'left' | 'right';
  state: 'idle' | 'walk' | 'arrive' | 'handoff';

  // Health & Status (NEW)
  health: 'healthy' | 'degraded' | 'critical' | 'offline';
  currentAction: 'thinking' | 'coding' | 'testing' | 'reviewing' | 'searching' | 'memory-syncing' | 'waiting' | 'retrying' | 'idle';
  currentTool: string;           // "search_symbols", "memory-store", etc.
  confidence: number;            // 0.0 - 1.0
  progress: number;              // 0.0 - 1.0 on current task

  // Telemetry (NEW)
  tokenUsage: number;            // total tokens consumed this session
  tokenBurnRate: number;         // tokens/second
  cost: number;                  // estimated cost
  latency: number;               // average response latency ms
  contextUsage: number;          // percentage of context window used
  queueLength: number;           // tasks waiting for this agent
  memoryOps: number;             // memory operations this session
  toolCalls: number;             // tool calls this session

  // Visual enhancements (NEW)
  statusIcon: string;            // emoji or icon key
  speechBubble: string | null;   // current message
  activityAnimation: string;     // which animation to play
  healthRing: number;            // 0-100 for progress ring
  coloredOutline: string;        // hex color for outline based on role/health
}
```

### 7.3 Visual Changes

| Element                | Implementation                                              | Why                                 |
| ---------------------- | ----------------------------------------------------------- | ----------------------------------- |
| **Health Ring**        | Circular progress ring around agent feet, colored by health | First-glance status                 |
| **Status Icon**        | Small icon floating above agent head                        | Know what it's doing                |
| **Speech Bubble**      | Brief text bubble: "Searching for User model..."            | Context on current action           |
| **Colored Outline**    | Agent outline color = role color                            | Role identification at distance     |
| **Activity Animation** | Different walk cycles / particle effects per action         | Coding looks different from waiting |
| **Confidence Spark**   | Small particles when confidence > 0.8                       | High confidence is visible          |
| **Cost Glow**          | Subtle glow intensifies with cost                           | Cost awareness without numbers      |

### 7.4 Agent Role Colors

| Role          | Color  | Hex       |
| ------------- | ------ | --------- |
| backend       | Blue   | `#3B82F6` |
| frontend      | Green  | `#10B981` |
| debugger      | Orange | `#F59E0B` |
| devops        | Purple | `#8B5CF6` |
| data-engineer | Teal   | `#14B8A6` |
| explore       | Cyan   | `#06B6D4` |
| documentation | Gray   | `#6B7280` |
| general       | White  | `#F9FAFB` |

**Criticality**: Critical — agents are indistinguishable today.

---

## 8. Task Improvements

### 8.1 Current Task Model

```typescript
interface VisualTask {
	id: string;
	title: string;
	x: number;
	y: number;
	w: number;
	h: number;
	type: TaskType;
}
```

### 8.2 Target Task Model

```typescript
interface VisualTask {
	// Identity
	id: string;
	title: string;
	taskCode: string; // e.g. "AUTH-42"

	// Position
	x: number;
	y: number;
	w: number;
	h: number;

	// Priority & Status
	priority: "p0" | "p1" | "p2" | "p3";
	status: "pending" | "in_progress" | "blocked" | "completed" | "failed";

	// Ownership
	ownerId: string; // agent ID
	repositoryId: string; // repository ID

	// Timing
	createdAt: number; // timestamp
	startedAt: number | null;
	estimatedDuration: number; // seconds
	actualDuration: number | null;
	waitTime: number; // seconds in current zone

	// Progress & Quality
	progress: number; // 0.0 - 1.0
	retryCount: number;
	maxRetries: number;
	failureReason: string | null;
	blockedReason: "dependency" | "rate-limit" | "human" | "conflict" | "token" | "memory" | "tool" | null;
	blockedById: string | null; // dependency task ID

	// Cost
	tokenCost: number;
	estimatedCost: number;

	// Metadata
	labels: string[];
	tags: string[];
	type: "feature" | "fix" | "refactor" | "chore" | "docs" | "test";

	// Visual
	animationState: "idle" | "entering" | "exiting" | "pulse" | "shake" | "celebration";
}
```

### 8.3 Visual Task Card

```
┌─────────────────────────────┐
│ [P0] AUTH-42                │ ← Priority badge + code
│ Set up JWT authentication   │ ← Title (truncated)
│ ████████░░░░ 73%            │ ← Progress bar
│ ⚡ frontend  ·  2m 14s      │ ← Agent + duration
│ 💰 1.2k tokens              │ ← Cost
│ 🔗 blocked by AUTH-41       │ ← Block reason (if blocked)
│ 📦 2 retries                │ ← Retry badge (if any)
└─────────────────────────────┘
```

### 8.4 Progressive Disclosure

| State                          | Shows                                      |
| ------------------------------ | ------------------------------------------ |
| **At zoom-out / high density** | Priority stripe + task code only           |
| **Normal**                     | Priority badge, title, progress bar, owner |
| **Hover**                      | Full card with all metrics                 |
| **Click**                      | Side panel with execution history, logs    |

**Criticality**: High — current task cards show too little.

---

## 9. Repository Improvements

### 9.1 Current State

Repositories are a sidebar concept. In the Arena, tasks have no repository grouping.

### 9.2 Target: Repository as First-Class Entity

```typescript
interface VisualRepository {
	id: string;
	name: string;
	fullName: string; // owner/repo
	icon: string; // or pixel-art icon

	// Health
	health: "healthy" | "degraded" | "critical";

	// Activity
	activeBranches: number;
	lockedFiles: string[]; // files currently locked
	mergeQueueLength: number;
	activePRs: number;
	runningWorkflows: number;

	// Agent activity
	activeAgents: number;
	tasksInProgress: number;
	tasksPending: number;
	tasksBlocked: number;

	// Utilization
	utilizationPercent: number; // how busy this repo is
	avgTaskDuration: number;
	recentFailures: number;
}
```

### 9.3 Repository Visualization

**Repository Cluster Strip**: Located below the main zone row, showing:

```
[ repoA 🟢 3 agents | 2 branches | 1 workflow ]
[ repoB 🟡 1 agent | 1 branch | 0 workflows ]
[ repoC 🔴 0 agents | 0 branches | 0 workflows ]
```

Each repo cluster:

- Shows a mini-arena for that repository's working agents
- Click expands full repo detail in side panel
- Health dot: green (all good), yellow (some blocked/degraded), red (failures)

### 9.4 Repository Health Computation

| Factor                      | Weight | Why                               |
| --------------------------- | ------ | --------------------------------- |
| Blocked tasks / total tasks | 30%    | Too many blocked = unhealthy      |
| Failure rate (last 15m)     | 25%    | Recent failures indicate problems |
| Agent availability          | 20%    | No active agents = stalled        |
| Lock contention             | 15%    | Too many locked files = conflicts |
| Age of oldest pending task  | 10%    | Stale tasks = neglect             |

**Criticality**: High — today there's no way to see which repository is struggling.

---

## 10. Telemetry Improvements

### 10.1 Dashboard Metrics

Place these in the top bar and optional metrics panel:

| Metric                     | Type      | Visualization                     | Update Rate |
| -------------------------- | --------- | --------------------------------- | ----------- |
| **Success Rate**           | %         | Circular gauge + sparkline (5min) | Real-time   |
| **Failure Rate**           | %         | Sparkline (green→red)             | Real-time   |
| **Retry Rate**             | %         | Mini bar                          | Real-time   |
| **Average Duration**       | seconds   | Number + trend arrow              | Per-task    |
| **Token Consumption**      | count     | Running total + rate/min          | Real-time   |
| **Cost**                   | $         | Running total + hourly rate       | Real-time   |
| **Throughput**             | tasks/min | Sparkline with moving average     | Real-time   |
| **Queue Depth**            | count     | Number + change indicator         | Real-time   |
| **Agent Utilization**      | %         | Heat grid (agent × busy/idle)     | Real-time   |
| **Repository Utilization** | %         | Horizontal bar per repo           | Per-event   |
| **Memory Usage**           | MB        | Gauge                             | Real-time   |
| **Context Size**           | tokens    | Gauge per agent                   | Per-event   |
| **Tool Calls**             | count     | Stacked bar (by tool type)        | Real-time   |

### 10.2 Top Bar Redesign

```
┌─────────────────────────────────────────────────────────────────────┐
│ 🟢 LIVE   3/8 agents   14 tasks/min  97.3% success  $0.04/min      │
│ ────────  ──────────── ───────────── ────────────── ────────────    │
│ Status    Agents busy   Throughput    Success Rate   Cost           │
└─────────────────────────────────────────────────────────────────────┘
```

| Current        | New                             | Why                  |
| -------------- | ------------------------------- | -------------------- |
| Green dot only | Green/yellow/red pulse + uptime | Actual health signal |
| Agent count    | Active / total agents (3/8)     | Shows utilization    |
| Task count     | Throughput (tasks/min)          | Shows velocity       |
| Repo count     | Aggregate health bar            | Shows system health  |
| —              | Success rate                    | Shows quality        |
| —              | Cost rate                       | Shows spending       |

**Criticality**: Critical — the top bar is prime real estate and currently underutilized.

---

## 11. Observability Improvements

### 11.1 Event Timeline (Slide-Out Panel)

A chronological, filterable event stream that lives at the bottom or as a slide-out:

```
┌─── Events (last 15m) ──────────────────────────────────────┐
│ 🔵 14:23:12  Task Completed   AUTH-42 · by frontend-agent  │
│ 🔴 14:23:10  Task Failed      DB-7 · timeout · by backend   │
│ 🟡 14:23:08  Task Blocked     DEPLOY-3 · rate limit         │
│ 🟢 14:23:05  Agent Connected  debugger-2                    │
│ 🔄 14:23:00  Retry Scheduled  AUTH-41 · 30s backoff         │
│ 🧠 14:22:55  Memory Sync      backend-1 · "Auth pattern"    │
│ 🔵 14:22:50  Task Completed   UI-12 · by frontend-agent     │
│ 📝 14:22:45  Tool Call        explore-1 · search_symbols    │
└──────────────────────────────────────────────────────────────┘
```

**Features**:

- Filter by event type, agent, repository, task
- Click event → highlights related entity in arena
- Auto-scroll with "Pause" toggle
- Color-coded by event type

### 11.2 Activity Feed (Panel)

Short-form, high-signal feed on the right side:

```
┌── Activity ──────────────────┐
│ ⚡ frontend coding AUTH-42   │
│ 🔍 explore searching symbols │
│ 🧪 backend testing DB-7     │
│ 📝 debugger reviewing crash  │
└──────────────────────────────┘
```

### 11.3 Heat Map (Tab)

A grid of agent × time showing activity:

```
        now-5m  now-4m  now-3m  now-2m  now-1m  now
agent-1  ████    ████    ░░░░    ████    ████    ████
agent-2  ░░░░    ░░░░    ░░░░    ████    ████    ████
agent-3  ████    ████    ████    ████    ░░░░    ░░░░
```

Darker = more active. Shows utilization patterns at a glance.

### 11.4 Dependency Graph (Tab)

A directed graph showing task → task dependencies:

```
AUTH-42 ──→ AUTH-41 ──→ USER-5
  │                      │
  └──→ DEPLOY-3         └──→ ORG-2
```

Tasks in Red = blocked. Green = completed. Blue = in progress.

### 11.5 Replay Mode

Record the event stream and allow operators to scrub backward/forward in time — like a video player for agent activity.

**Controls**: ▶️ ⏸ ⏪ ⏩ with speed control (1x, 2x, 4x, 8x).

**Use case**: "What happened at 14:23 when the failure spike occurred?"

### 11.6 Execution Trace

Per-task: a vertical timeline of every step the agent took:

```
Task: AUTH-42 (frontend-agent)
├── 14:20:01  search_symbols("User") → 12 results
├── 14:20:03  read("src/models/User.ts") → 154 lines
├── 14:20:08  thinking... → "Need to add JWT support"
├── 14:20:15  edit("src/models/User.ts:42") → +12 lines
├── 14:21:30  memory-store("JWT pattern") → MEM-89
└── 14:22:00  validate → type-check ✓
```

**Criticality**: High — operators need to audit agent decisions and debug failures.

---

## 12. Performance Improvements

### 12.1 Rendering Strategy

| Approach             | Agent Count | Task Count | FPS   | Notes                       |
| -------------------- | ----------- | ---------- | ----- | --------------------------- |
| **DOM only**         | ≤50         | ≤500       | 60    | Current approach might work |
| **Canvas 2D**        | ≤200        | ≤2,000     | 60    | Current likely Canvas 2D    |
| **PixiJS / WebGL**   | ≤500        | ≤5,000     | 60    | Recommended target          |
| **PixiJS + culling** | ≤2,000      | ≤20,000    | 30-60 | Extreme scale               |

**Recommendation**: The codebase already uses an `ArenaRenderer` on Canvas. If it's not PixiJS already, **migrate to PixiJS 8** for:

- Batched sprite rendering (thousands of sprites at 60fps)
- WebGL2 backend with Canvas2D fallback
- Built-in particle system for celebrations/effects
- Sprite sheets for pixel art animation
- Filter effects (glow, blur for speech bubbles)

### 12.2 Optimization Techniques

| Technique                 | Applies To                                  | Impact                         |
| ------------------------- | ------------------------------------------- | ------------------------------ |
| **Viewport culling**      | Entities outside visible area not rendered  | 2-5x FPS improvement at scale  |
| **LOD (Level of Detail)** | Distant agents simplify to dots             | Reduces draw calls at zoom-out |
| **Sprite batching**       | All agents in one draw call                 | Reduces GPU state changes      |
| **Dirty rectangles**      | Only redraw changed areas                   | Avoids full-canvas repaint     |
| **Web Workers**           | Transform computation off main thread       | Prevents UI jank               |
| **State batching**        | Coalesce rapid events → single render frame | Avoids 100 renders/sec         |     |

### 12.3 Animation Performance

| Rule                                       | Why                        |
| ------------------------------------------ | -------------------------- |
| Use `requestAnimationFrame` (already does) | Syncs with display refresh |
| No `setTimeout` for animation              | Causes jank                |
| Cap animation at 30fps when tab hidden     | Saves battery              |
| Use CSS `will-change` for DOM overlays     | Hints browser to composite |

### 12.4 Memory Management

- **Sprite pooling**: Reuse agent sprites instead of creating/destroying
- **Task card pool**: Virtual scrolling recycles DOM nodes
- **Event buffer pruning**: Keep last 1,000 events in memory, archive older to IndexedDB
- **Texture atlas**: Single sprite sheet for all agent parts (hair, body, pants, accessories)

**Criticality**: High — at 500 agents / 5,000 tasks, naive rendering will fail.

---

## 13. Accessibility Improvements

### 13.1 Canvas Accessibility

Canvas is inherently inaccessible. Mitigations:

| Technique               | Implementation                                                         | Effort |
| ----------------------- | ---------------------------------------------------------------------- | ------ |
| **DOM overlay**         | Invisible DOM elements overlaid on canvas positions for screen readers | Medium |
| **ARIA live region**    | `aria-live="polite"` region announcing major events                    | Low    |
| **Keyboard navigation** | Tab through agents/tasks with focus rings on DOM overlay               | Medium |
| **Roving tabindex**     | Arrow keys to move between entities                                    | Medium |

### 13.2 Color & Contrast

| Rule                     | Current             | Target                                | Why               |
| ------------------------ | ------------------- | ------------------------------------- | ----------------- |
| Minimum contrast         | Unknown             | 4.5:1 text, 3:1 large                 | WCAG AA           |
| Color not sole indicator | Status = color only | Status = color + icon + text          | Color blindness   |
| Zone backgrounds         | Likely pure dark    | Soft, slightly desaturated            | Reduce eye strain |
| Focus indicators         | None                | 3px bright outline on focused element | Keyboard users    |

### 13.3 Motion

| Preference                     | Implementation                                      | Why                  |
| ------------------------------ | --------------------------------------------------- | -------------------- |
| `prefers-reduced-motion`       | Disable walking animations, use instant transitions | Vestibular disorders |
| `prefers-reduced-transparency` | Disable glow/glass effects                          | Visual sensitivity   |
| No auto-play                   | Pause button for continuous animations              | User control         |

### 13.4 Specificity

| Element         | Issue                      | Fix                                     |
| --------------- | -------------------------- | --------------------------------------- |
| Agent pixel art | Indistinguishable features | Name label + role badge alongside       |
| Zone labels     | May be low contrast        | Ensure 4.5:1 contrast on all text       |
| Task cards      | Small text                 | Minimum 12px font, zoom to 16px minimum |
| Event timeline  | Dense scrolling            | Pause, filter, search controls          |

**Criticality**: High — currently no accessibility consideration (canvas + no DOM overlay).

---

## 14. Scalability Improvements

### 14.1 Scaling Tiers

| Tier           | Agents  | Tasks        | Repos  | Strategy                                         |
| -------------- | ------- | ------------ | ------ | ------------------------------------------------ |
| **Solo**       | 1-5     | 1-50         | 1-3    | Full animation, no optimization needed           |
| **Team**       | 5-20    | 50-500       | 3-10   | LOD, aggregation zones, minimap                  |
| **Org**        | 20-100  | 500-2,000    | 10-50  | Virtual scroll, clustering, filtering            |
| **Enterprise** | 100-500 | 2,000-20,000 | 50-200 | All optimizations, WebGL, aggregation by default |

### 14.2 Clustering

At Enterprise tier, agents cluster by:

- **Repository**: All agents on `repo-X` cluster together
- **Role**: All `backend` agents cluster
- **Team**: Custom grouping

Cluster visualization: A single "swarm" circle showing agent count, health, and activity level. Click to expand.

### 14.3 Progressive Disclosure by Zoom Level

| Zoom               | Shows                                                  | Hides                 |
| ------------------ | ------------------------------------------------------ | --------------------- |
| **200%+**          | Individual pixels, full agent detail                   | Nothing               |
| **100% (default)** | All agents, task cards, zones                          | Extra detail          |
| **50%**            | Zone names, aggregate counts, repository clusters      | Individual task cards |
| **25%**            | Arena overview, health heat map, throughput sparklines | All entities          |
| **10% (minimap)**  | Global state, bottleneck indicators                    | Everything individual |

### 14.4 Filtering & Search

| Filter        | Type         | Why                              |
| ------------- | ------------ | -------------------------------- |
| Repository    | Dropdown     | Focus on one repo                |
| Agent role    | Checkbox set | See only frontend agents         |
| Task priority | Toggle P0-P3 | Focus on critical work           |
| Status        | Toggle set   | Hide completed, show blocked     |
| Search        | Text input   | Find specific task/agent by name |
| Time range    | Slider       | Show events in window            |

### 14.5 Virtual Scrolling

For zones with >100 items:

- Render only visible items (viewport + buffer)
- Fixed item height for predictable scroll
- Svelte `{#each}` with keyed items for efficient DOM diffing

**Criticality**: High — essential for Enterprise tier. Without it, the Arena freezes above ~200 tasks.

---

## 15. Interaction Improvements

### 15.1 Interaction Map

| Action           | Current | Target                                                                                   | Implementation                         |
| ---------------- | ------- | ---------------------------------------------------------------------------------------- | -------------------------------------- |
| **Hover**        | Unknown | Agent: show speech bubble + health tooltip. Task: show full card. Repo: show summary     | DOM overlay + canvas hover detection   |
| **Click**        | Unknown | Select entity → highlight, show side panel                                               | Selection state in Arena State Manager |
| **Double-click** | None    | Zoom to entity, center in viewport                                                       | Animated camera pan + zoom             |
| **Right-click**  | None    | Context menu: "Focus Agent", "View Logs", "Cancel Task", "Retry"                         | Custom context menu component          |
| **Drag & Drop**  | None    | Move tasks between zones (Pending → In Progress to assign)                               | Pointer events + canvas hit testing    |
| **Keyboard**     | None    | Tab/Shift+Tab between entities, Enter to select, Esc to deselect, Arrow keys to navigate | DOM overlay with roving tabindex       |
| **Touch**        | Unknown | Tap to select, pinch to zoom, swipe timeline                                             | Touch event handling                   |
| **Scroll wheel** | Unknown | Zoom in/out (pinch or Ctrl+scroll)                                                       | Canvas zoom transform                  |
| **Middle-click** | None    | Auto-pan viewport                                                                        | Pan on middle-click drag               |

### 15.2 Shortcuts

| Shortcut | Action                   |
| -------- | ------------------------ |
| `1`      | Focus Pending zone       |
| `2`      | Focus In Progress zone   |
| `3`      | Focus Backlog zone       |
| `4`      | Focus Blocked zone       |
| `5`      | Focus Recovery Center    |
| `r`      | Reset zoom / center view |
| `f`      | Toggle filter panel      |
| `e`      | Toggle event timeline    |
| `m`      | Toggle minimap           |
| `/`      | Search tasks / agents    |
| `Esc`    | Deselect / close panel   |
| `Space`  | Pause/resume animations  |

### 15.3 Context Menu (Right-Click)

```
┌───────────────────────────┐
│ Focus Agent               │ ← Pan camera to agent
│ View Task Logs            │ ← Open side panel with logs
│ ───────────────────────── │
│ Cancel Task               │ ← Confirm then cancel
│ Retry Task                │ ← Move to Pending
│ Assign to...              │ ← Sub-menu: choose agent
│ ───────────────────────── │
│ Block Task                │ ← Mark as blocked
│ Raise Priority            │ ← P1 → P0
│ ───────────────────────── │
│ Copy Task ID              │ ← Clipboard
└───────────────────────────┘
```

**Criticality**: Medium — these are power features. Not critical for MVP but essential for daily ops.

---

## 16. Suggested Component Tree

```
┌── App.svelte
├── ArenaContainer.svelte          ← Main Arena layout
│   ├── TopBar.svelte              ← Global stats, controls
│   │   ├── LiveStatus.svelte      ← Green/yellow/red pulse
│   │   ├── MetricTile.svelte      ← Reusable metric display (x of N)
│   │   ├── ThroughputSparkline.svelte
│   │   ├── SuccessRateGauge.svelte
│   │   └── TimeRangeSelector.svelte
│   │
│   ├── ArenaCanvas.svelte         ← Canvas / PixiJS container
│   │   ├── ZoneArea.svelte        ← Per-zone render controller
│   │   ├── AgentSprite.svelte     ← Single agent pixi sprite
│   │   ├── TaskCard.svelte        ← Single task card (DOM overlay or canvas)
│   │   ├── RepositoryCluster.svelte ← Repo bubble/grouping
│   │   ├── HandoffAnimation.svelte  ← Task handoff visual
│   │   └── ParticleEffect.svelte  ← Celebrations, sparkles
│   │
│   ├── Minimap.svelte             ← Small overview, click to navigate
│   │
│   ├── ZoomControls.svelte        ← +/- zoom, reset button
│   │
│   └── InputLayer.svelte          ← DOM overlay for hover/click/keyboard
│       ├── HoverTooltip.svelte    ← Agent/task/repo tooltip
│       └── ContextMenu.svelte     ← Right-click menu
│
├── SidePanel.svelte               ← Slide-out detail panel
│   ├── AgentDetail.svelte         ← Full agent info + telemetry
│   ├── TaskDetail.svelte          ← Full task info + execution trace
│   ├── RepositoryDetail.svelte    ← Full repo info
│   └── ExecutionTrace.svelte      ← Step-by-step agent trace
│
├── EventTimeline.svelte           ← Bottom slide-out drawer
│   ├── EventRow.svelte            ← Single event row
│   ├── EventFilter.svelte         ← Filter by type/agent/repo
│   └── ReplayControls.svelte      ← Playback controls
│
├── ActivityFeed.svelte            ← Right-side compact feed
│   └── ActivityItem.svelte
│
├── FilterBar.svelte               ← Search + filter controls
│
├── ObservabilityPanel.svelte       ← Tabbed panel (if not slide-out)
│   ├── HeatMap.svelte
│   ├── DependencyGraph.svelte
│   └── AgentGraph.svelte
│
└── AccessibilityOverlay.svelte    ← ARIA live region, screen reader announcements
```

---

## 17. Suggested State Model

### 17.1 Arena State (Single Source of Truth)

```typescript
interface ArenaState {
	// Version for conflict resolution
	version: number;

	// Entities
	agents: Map<string, VisualAgent>;
	tasks: Map<string, VisualTask>;
	repositories: Map<string, VisualRepository>;
	handoffs: Map<string, VisualHandoff>;

	// Zone Aggregates (computed from entities)
	zones: {
		pending: ZoneAggregate;
		inProgress: ZoneAggregate;
		backlog: ZoneAggregate;
		blocked: ZoneAggregate;
		recovery: ZoneAggregate;
	};

	// Global Metrics (computed)
	metrics: {
		successRate: number;
		failureRate: number;
		retryRate: number;
		throughput: number; // tasks/min
		avgDuration: number;
		tokenConsumption: number;
		cost: number;
		agentUtilization: number;
		queueDepth: number;
	};

	// UI State
	ui: {
		selectedEntityId: string | null;
		selectedEntityType: "agent" | "task" | "repository" | null;
		zoom: number; // 0.1 - 3.0
		panX: number;
		panY: number;
		hoveredEntityId: string | null;
		activeFilter: FilterState;
		timelineVisible: boolean;
		sidePanelVisible: boolean;
		sidePanelView: "agent" | "task" | "repo" | "trace";
		eventLog: EventLogEntry[]; // last N events
		paused: boolean;
	};
}

interface ZoneAggregate {
	count: number;
	oldestWait: number; // seconds
	averageWait: number;
	priorityDistribution: Record<string, number>;
	eta: number | null; // seconds
	blockedByDistribution: Record<string, number> | null; // Blocked zone only
}
```

### 17.2 State Manager

```typescript
class ArenaStateManager {
	private state: ArenaState;
	private subscribers: Set<(patch: ArenaPatch) => void>;

	// Apply a domain event → produce patch
	applyEvent(event: DomainEvent): ArenaPatch;

	// Apply patch → notify subscribers
	applyPatch(patch: ArenaPatch): void;

	// Subscribe to patches
	subscribe(cb: (patch: ArenaPatch) => void): () => void;

	// Get snapshot (for Canvas render)
	getSnapshot(): ArenaState;
}
```

### 17.3 Patch Structure

```typescript
type ArenaPatch = {
	// What changed
	entities: {
		agents?: Map<string, Partial<VisualAgent>>;
		tasks?: Map<string, Partial<VisualTask>>;
		repositories?: Map<string, Partial<VisualRepository>>;
	};
	// Zones that need recomputation
	invalidatedZones: string[];
	// UI events to trigger
	effects: VisualEffect[];
	// Metrics recomputed
	metricsChanged: boolean;
};
```

---

## 18. Suggested Event Model

### 18.1 Domain Events (from local-memory-mcp)

The Arena subscribes to these events:

```typescript
// ─── Agent Events ───
interface AgentConnected {
	type: "agent-connected";
	agentId: string;
	name: string;
	model: string;
	role: AgentRole;
	timestamp: number;
}

interface AgentDisconnected {
	type: "agent-disconnected";
	agentId: string;
	reason: "shutdown" | "error" | "timeout" | "completed";
	timestamp: number;
}

interface AgentHealthChanged {
	type: "agent-health-changed";
	agentId: string;
	health: "healthy" | "degraded" | "critical";
	reason: string;
	timestamp: number;
}

interface AgentActionChanged {
	type: "agent-action-changed";
	agentId: string;
	action: AgentAction;
	tool: string | null;
	timestamp: number;
}

// ─── Task Events ───
interface TaskCreated {
	type: "task-created";
	taskId: string;
	title: string;
	priority: TaskPriority;
	repositoryId: string;
	timestamp: number;
}

interface TaskAssigned {
	type: "task-assigned";
	taskId: string;
	agentId: string;
	timestamp: number;
}

interface TaskStarted {
	type: "task-started";
	taskId: string;
	agentId: string;
	timestamp: number;
}

interface TaskProgressed {
	type: "task-progressed";
	taskId: string;
	progress: number; // 0.0 - 1.0
	tokenUsage: number;
	timestamp: number;
}

interface TaskBlocked {
	type: "task-blocked";
	taskId: string;
	reason: TaskBlockReason;
	detail: string; // e.g., "Waiting on AUTH-41", "Rate limit 30s"
	blockedById: string | null; // dependency task ID
	timestamp: number;
}

interface TaskUnblocked {
	type: "task-unblocked";
	taskId: string;
	timestamp: number;
}

interface TaskRetryScheduled {
	type: "task-retry-scheduled";
	taskId: string;
	attempt: number;
	maxRetries: number;
	backoffSeconds: number;
	timestamp: number;
}

interface TaskCompleted {
	type: "task-completed";
	taskId: string;
	agentId: string;
	duration: number;
	tokenCost: number;
	timestamp: number;
}

interface TaskFailed {
	type: "task-failed";
	taskId: string;
	agentId: string;
	error: string;
	canRetry: boolean;
	timestamp: number;
}

// ─── Memory Events ───
interface MemoryCreated {
	type: "memory-created";
	memoryId: string;
	agentId: string;
	summary: string;
	timestamp: number;
}

interface MemoryUpdated {
	type: "memory-updated";
	memoryId: string;
	agentId: string;
	summary: string;
	timestamp: number;
}

// ─── Repository Events ───
interface RepositoryLocked {
	type: "repository-locked";
	repositoryId: string;
	lockedBy: string; // agent ID
	file: string; // locked file path
	timestamp: number;
}

interface RepositoryUnlocked {
	type: "repository-unlocked";
	repositoryId: string;
	file: string;
	timestamp: number;
}

interface RepositoryHealthChanged {
	type: "repository-health-changed";
	repositoryId: string;
	health: RepositoryHealth;
	metrics: Partial<VisualRepository>;
	timestamp: number;
}

// ─── Global Events ───
interface MetricsUpdated {
	type: "metrics-updated";
	metrics: Partial<ArenaMetrics>;
	timestamp: number;
}

type DomainEvent =
	| AgentConnected
	| AgentDisconnected
	| AgentHealthChanged
	| AgentActionChanged
	| TaskCreated
	| TaskAssigned
	| TaskStarted
	| TaskProgressed
	| TaskBlocked
	| TaskUnblocked
	| TaskRetryScheduled
	| TaskCompleted
	| TaskFailed
	| MemoryCreated
	| MemoryUpdated
	| RepositoryLocked
	| RepositoryUnlocked
	| RepositoryHealthChanged
	| MetricsUpdated;
```

### 18.2 Event → Visual Effect Mapping

| Event              | Visual Effect                            | Animation                      |
| ------------------ | ---------------------------------------- | ------------------------------ |
| AgentConnected     | Agent sprite enters from edge            | Walk-in animation              |
| AgentDisconnected  | Agent fades out                          | Dissolve + dismissed particles |
| AgentHealthChanged | Health ring color transition             | Smooth color lerp              |
| AgentActionChanged | Status icon + speech bubble change       | Icon crossfade                 |
| TaskCreated        | Card slides into zone                    | Ease-in slide                  |
| TaskAssigned       | Agent walks to task                      | Pathfinding walk               |
| TaskStarted        | Agent shows working animation            | Activity-specific animation    |
| TaskProgressed     | Progress bar fills                       | Smooth tween                   |
| TaskBlocked        | Card moves to Blocked zone, shake effect | Slide + shake                  |
| TaskUnblocked      | Card returns to previous zone            | Slide back                     |
| TaskRetryScheduled | Badge appears on card                    | Badge pop-in                   |
| TaskCompleted      | Card slides out, sparkle particles       | Exit slide + particles         |
| TaskFailed         | Card moves to Recovery, red pulse        | Pulse + slide                  |
| MemoryCreated      | Agent shows "memory saved" bubble        | Bubble fade in/out             |
| MemoryUpdated      | Agent shows "memory updated" icon        | Icon flash                     |
| RepositoryLocked   | Lock icon appears on repo cluster        | Icon pop-in                    |
| RepositoryUnlocked | Lock icon removed                        | Icon fade                      |
| MetricsUpdated     | Top bar values update                    | Smooth number transition       |

---

## 19. Suggested Animation System

### 19.1 Architecture

```
AnimationController
├── TweenEngine        ← Linear interpolation for positions, colors, sizes
├── SequenceEngine     ← Chained animations (walk → arrive → work)
├── ParticleEngine     ← Particle effects (celebration, error, sparkles)
├── EasingFunctions    ← Ease-in-out, bounce, elastic, etc.
└── AnimationQueue     ← Prioritized queue: UI feedback > ambient > idle
```

### 19.2 Existing Animations (Preserve & Enhance)

| Current               | Enhancement                                             |
| --------------------- | ------------------------------------------------------- |
| Agent walking         | Add pathfinding (avoid other agents)                    |
| Agent wandering       | Add environmental idle behaviors (stretch, look around) |
| Handoff with vehicles | Keep — this is delightful. Add more vehicle types       |
| Arrive animation      | Keep — add arrival particles                            |

### 19.3 New Animations

| Animation                 | Trigger                              | Implementation                      |
| ------------------------- | ------------------------------------ | ----------------------------------- |
| **Task card enters zone** | TaskCreated                          | Slide from top + scale bounce       |
| **Task card exits zone**  | TaskCompleted                        | Shrink + fade + sparkle burst       |
| **Agent starts working**  | TaskStarted                          | Small bounce + attention particles  |
| **Agent health critical** | Health='critical'                    | Subtle red pulse on health ring     |
| **Celebration burst**     | TaskCompleted + task count milestone | Particle fountain from agent        |
| **Error shake**           | TaskFailed                           | Card shakes, red flash              |
| **Blocked pulse**         | TaskBlocked                          | Card pulses amber                   |
| **Memory sync**           | MemoryCreated/Updated                | Brief brain/sparkle icon near agent |
| **Cooldown ring**         | TaskRetryScheduled                   | Circular countdown on agent/task    |
| **Handoff**               | Task reassigned                      | Car/vehicle drives between zones    |

### 19.4 Animation Budget

| Priority                 | Max Simultaneous | Frames | Notes                 |
| ------------------------ | ---------------- | ------ | --------------------- |
| Critical (health, error) | 10               | 30fps  | Always plays          |
| High (task transitions)  | 20               | 30fps  | Drops to 15fps if >20 |
| Medium (idle, wandering) | 50               | 15fps  | Lowest priority       |
| Low (ambient particles)  | Unlimited        | 10fps  | Skip if >100          |

### 19.5 Easing Functions

| Transition            | Easing           | Why                        |
| --------------------- | ---------------- | -------------------------- |
| Agent walk            | Linear           | Predictable movement       |
| Agent arrive          | Ease-out         | Smooth stop                |
| Card slide-in         | Ease-out         | Natural entry              |
| Card slide-out        | Ease-in          | Fast exit                  |
| Health ring color     | Smoothstep       | Perceptually smooth        |
| Celebration particles | Gravity + bounce | Fun, natural               |
| Speech bubble         | Fade + scale     | Noticeable but not jarring |

---

## 20. Suggested Color System

### 20.1 Zone Colors

| Zone        | Color | Hex       | Usage                       |
| ----------- | ----- | --------- | --------------------------- |
| Pending     | Blue  | `#3B82F6` | Waiting, neutral-productive |
| In Progress | Green | `#22C55E` | Active, healthy             |
| Backlog     | Slate | `#64748B` | Background, waiting         |
| Blocked     | Amber | `#F59E0B` | Warning, attention needed   |
| Recovery    | Rose  | `#F43F5E` | Error, recovery             |

### 20.2 Health Colors

| State    | Color  | Hex       | Accessibility |
| -------- | ------ | --------- | ------------- |
| Healthy  | Green  | `#22C55E` | OK            |
| Degraded | Yellow | `#EAB308` | Caution       |
| Critical | Red    | `#EF4444` | Danger        |
| Offline  | Gray   | `#9CA3AF` | Inactive      |

### 20.3 Priority Colors

| Priority | Color         | Hex       | Visual               |
| -------- | ------------- | --------- | -------------------- |
| P0       | Red stripe    | `#EF4444` | Thin red left border |
| P1       | Orange stripe | `#F97316` | Orange border        |
| P2       | Blue stripe   | `#3B82F6` | Blue border          |
| P3       | Gray stripe   | `#9CA3AF` | Gray border          |

### 20.4 Semantic Colors

| Token                   | Light     | Dark      | Usage                  |
| ----------------------- | --------- | --------- | ---------------------- |
| `--arena-bg`            | `#F8FAFC` | `#0F172A` | Main arena background  |
| `--arena-grid`          | `#E2E8F0` | `#1E293B` | Grid lines             |
| `--zone-bg`             | `#FFFFFF` | `#1E293B` | Zone panel backgrounds |
| `--zone-border`         | `#CBD5E1` | `#334155` | Zone borders           |
| `--text-primary`        | `#1E293B` | `#F1F5F9` | Primary text           |
| `--text-secondary`      | `#64748B` | `#94A3B8` | Secondary text         |
| `--agent-label`         | `#1E293B` | `#E2E8F0` | Agent name label       |
| `--task-bg`             | `#FFFFFF` | `#334155` | Task card background   |
| `--hover-highlight`     | `#DBEAFE` | `#1E3A5F` | Hover state            |
| `--selection-highlight` | `#BFDBFE` | `#1D4ED8` | Selected state         |

### 20.5 Glow Effects

| Element         | Glow                   | Implementation                           |
| --------------- | ---------------------- | ---------------------------------------- |
| Healthy agent   | Subtle green aura +2px | CSS `box-shadow` or Canvas glow filter   |
| Critical agent  | Red pulse glow         | Animated glow with `filter: drop-shadow` |
| Selected entity | Blue glow ring         | Outline with glow                        |
| Blocked zone    | Amber ambient glow     | Zone background tinted amber at 5%       |
| Celebration     | Gold sparkle burst     | Particle effect                          |

---

## 21. Suggested Design Tokens

```css
:root {
	/* ─── Spacing ─── */
	--arena-gap: 8px;
	--zone-padding: 16px;
	--card-padding: 8px;
	--agent-size: 32px;
	--task-card-min-width: 160px;
	--task-card-max-width: 280px;

	/* ─── Typography ─── */
	--font-mono: "JetBrains Mono", "Fira Code", monospace;
	--font-sans: "Inter", system-ui, sans-serif;
	--text-xs: 10px;
	--text-sm: 12px;
	--text-base: 14px;
	--text-lg: 16px;
	--text-xl: 20px;
	--text-2xl: 24px;

	/* ─── Border Radius ─── */
	--radius-none: 0px;
	--radius-sm: 2px; /* Pixel-perfect for game aesthetic */
	--radius-md: 4px;
	--radius-lg: 8px;
	--radius-full: 9999px;

	/* ─── Zone Sizing ─── */
	--zone-min-width: 200px;
	--zone-max-width: 400px;
	--zone-header-height: 48px;
	--zone-body-max-height: calc(100vh - 200px);

	/* ─── Agent Visual ─── */
	--agent-ring-size: 40px; /* Health ring diameter */
	--agent-ring-width: 3px; /* Health ring stroke */
	--agent-icon-size: 12px; /* Status icon size */
	--agent-glow-radius: 8px;
	--agent-speech-duration: 3s;

	/* ─── Animation ─── */
	--animation-fast: 150ms;
	--animation-normal: 300ms;
	--animation-slow: 500ms;
	--animation-float: 800ms;

	/* ─── Z-Index Layers ─── */
	--z-canvas: 0;
	--z-agents: 1;
	--z-tasks: 2;
	--z-overlay: 10;
	--z-tooltip: 20;
	--z-context-menu: 30;
	--z-side-panel: 40;
	--z-timeline: 35;
	--z-modal: 50;

	/* ─── Pixel Art ─── */
	--pixel-size: 1; /* 1 = 1:1, 2 = 2x pixel scaling */
	--pixel-grid: 8px; /* Grid alignment unit */

	/* ─── Minimap ─── */
	--minimap-size: 180px;
	--minimap-scale: 0.1; /* 10% of full canvas */

	/* ─── Event Timeline ─── */
	--timeline-height: 200px;
	--timeline-row-height: 24px;
}
```

---

## 22. Prioritized Roadmap

### Phase 1: Foundation (Critical — Must Have)

| #   | Item                                 | Effort   | Impact   | Notes                                                                                                       |
| --- | ------------------------------------ | -------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| 1.1 | **Event-driven architecture**        | 3-5 days | Critical | Replace polling with SSE/WebSocket event stream. `EventCoordinator` + typed events.                         |
| 1.2 | **Arena State Manager**              | 2-3 days | Critical | Single state store with differential patches. `ArenaStateManager` with `applyEvent` → `applyPatch` cycle.   |
| 1.3 | **Agent health ring + status icons** | 1-2 days | Critical | Add `health`, `currentAction`, `statusIcon` to `VisualAgent`. Render health ring and status icon on canvas. |
| 1.4 | **Blocked zone root cause grouping** | 1 day    | Critical | Group blocked tasks by `blockedReason`. Add color-coded badges.                                             |
| 1.5 | **Top bar redesign**                 | 1 day    | Critical | Replace static counts with live metrics: success rate, throughput, cost rate, agent utilization.            |
| 1.6 | **Task card priority + progress**    | 1-2 days | Critical | Add priority stripe, progress bar, owner badge, duration to task cards.                                     |

**Phase 1 Outcome**: Operators can see what every agent is doing, what's blocked and why, and system health at a glance.

### Phase 2: Observability (High)

| #   | Item                                       | Effort   | Impact | Notes                                                                          |
| --- | ------------------------------------------ | -------- | ------ | ------------------------------------------------------------------------------ |
| 2.1 | **Event timeline**                         | 2-3 days | High   | Slide-out panel with chronological, filterable event stream.                   |
| 2.2 | **Repository clusters**                    | 2-3 days | High   | Repository strip below zones. Health, active branches, locked files, PR count. |
| 2.3 | **Recovery Center (replace Therapy Room)** | 1-2 days | High   | Cooldown rings, retry queue, self-healing area, human review area.             |
| 2.4 | **Execution trace**                        | 2-3 days | High   | Per-task step-by-step timeline of agent actions.                               |
| 2.5 | **Pending zone queue health**              | 1 day    | High   | ETA, oldest wait, priority pie, wait-time heat.                                |
| 2.6 | **Agent speech bubbles**                   | 1 day    | High   | Brief contextual messages: "Searching for User model..."                       |

**Phase 2 Outcome**: Full observability into what happened, what's happening, and why. Repository-level visibility.

### Phase 3: Interaction (High)

| #   | Item                    | Effort   | Impact | Notes                                                      |
| --- | ----------------------- | -------- | ------ | ---------------------------------------------------------- |
| 3.1 | **Hover tooltips**      | 1 day    | High   | Agent/task/repo tooltip on hover.                          |
| 3.2 | **Side panel**          | 2-3 days | High   | Slide-out detail panel for agent, task, repository.        |
| 3.3 | **Keyboard navigation** | 1-2 days | High   | Tab, arrow keys, shortcuts. DOM overlay for accessibility. |
| 3.4 | **Filter bar**          | 1-2 days | High   | Search, repository filter, role filter, priority filter.   |
| 3.5 | **Zoom + pan**          | 2-3 days | Medium | Canvas zoom controls, mouse wheel zoom, middle-click pan.  |

**Phase 3 Outcome**: Operators can navigate, filter, and zoom the Arena. Keyboard accessible.

### Phase 4: Scalability (High)

| #   | Item                                          | Effort   | Impact | Notes                                                                  |
| --- | --------------------------------------------- | -------- | ------ | ---------------------------------------------------------------------- |
| 4.1 | **Viewport culling**                          | 1-2 days | High   | Don't render entities outside viewport. 2-5x FPS improvement at scale. |
| 4.2 | **LOD system**                                | 2-3 days | Medium | Distant agents simplify to dots, zone-level aggregation at low zoom.   |
| 4.3 | **Virtual scrolling for large zones**         | 1-2 days | Medium | Only render visible task cards in overflow zones.                      |
| 4.4 | **Minimap**                                   | 2-3 days | Medium | Small overview with click-to-navigate.                                 |
| 4.5 | **PixiJS / WebGL migration (if not already)** | 3-5 days | High   | Batched rendering, sprite sheets, WebGL2. Required for 500+ agents.    |

**Phase 4 Outcome**: Arena usable at 500+ agents and 5,000+ tasks with stable 30-60fps.

### Phase 5: Observability Deep (Medium)

| #   | Item                        | Effort   | Impact | Notes                                      |
| --- | --------------------------- | -------- | ------ | ------------------------------------------ |
| 5.1 | **Heat map (agent × time)** | 2-3 days | Medium | Grid showing agent activity over time.     |
| 5.2 | **Dependency graph**        | 3-4 days | Medium | Task dependency visualization.             |
| 5.3 | **Replay mode**             | 3-5 days | Medium | Event stream playback with scrub controls. |
| 5.4 | **Activity feed**           | 1 day    | Medium | Right-side compact feed.                   |

**Phase 5 Outcome**: Advanced observability for debugging complex workflows and understanding agent behavior patterns.

### Phase 6: Gamification & Delight (Low)

| #   | Item                             | Effort   | Impact | Notes                                                                       |
| --- | -------------------------------- | -------- | ------ | --------------------------------------------------------------------------- |
| 6.1 | **Celebration particles**        | 1 day    | Low    | Sparkle burst on task completion.                                           |
| 6.2 | **Agent idle behaviors**         | 1-2 days | Low    | More varied idle animations (stretch, check watch, chat with other agents). |
| 6.3 | **Mission complete animation**   | 1 day    | Low    | Milestone-based celebration (10, 50, 100 tasks).                            |
| 6.4 | **Agent XP / levels (optional)** | 2-3 days | Low    | Agents gain XP for completed tasks, level up visually.                      |

**Phase 6 Outcome**: The Arena becomes genuinely delightful to watch without distracting from ops.

### Phase 7: Accessibility (Ongoing)

| #   | Item                              | Effort   | Impact | Notes                                     |
| --- | --------------------------------- | -------- | ------ | ----------------------------------------- |
| 7.1 | **ARIA live region**              | 0.5 day  | High   | Announce major events for screen readers. |
| 7.2 | **Color contrast audit**          | 0.5 day  | Medium | Ensure all text meets WCAG AA.            |
| 7.3 | **Reduced motion support**        | 0.5 day  | Medium | `prefers-reduced-motion` detection.       |
| 7.4 | **DOM overlay + roving tabindex** | 2-3 days | Medium | Full keyboard navigation.                 |

**Phase 7 Outcome**: WCAG AA compliance for the Arena.

---

## Decision Log

| ADR     | Decision                                       | Rationale                                                                                       |
| ------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| ADR-001 | **Event-driven over polling**                  | Architecture constraint. Eliminates staleness, enables replay, reduces bandwidth.               |
| ADR-002 | **Canvas/PixiJS over DOM**                     | Required for 500+ animated agents. DOM can't maintain 60fps at that scale.                      |
| ADR-003 | **Therapy Room → Recovery Center**             | Semantic clarity. Operators understand "recovery" immediately. "Therapy" is ambiguous.          |
| ADR-004 | **Keep Backlog naming**                        | Industry standard. Renaming adds confusion for no benefit.                                      |
| ADR-005 | **PixiJS 8 over raw Canvas**                   | Sprite batching, particle system, filter effects, WebGL2.                                       |
| ADR-006 | **Progressive disclosure by zoom**             | Single interface works at all scales without overwhelming.                                      |
| ADR-007 | **Repository as first-class entity**           | Agents work on repos, not in isolation. Correlating agent activity to repo health is essential. |
| ADR-008 | **VisualAgent role colors over random colors** | `nameHash()` random colors encode no information. Role colors enable instant recognition.       |

---

_This document serves as the design specification for the Agent Arena optimization. All recommendations are classified by priority and expected impact. The governing principle: preserve the playful, game-inspired aesthetic while delivering enterprise-grade observability, scalability, and accessibility._
