// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createFocusTrap } from "../focusTrap";

function makeRow(): HTMLTableRowElement {
	const tr = document.createElement("tr");
	tr.className = "mem-row";
	tr.setAttribute("tabindex", "-1");
	document.body.appendChild(tr);
	return tr;
}

function makePanel(): HTMLDivElement {
	const panel = document.createElement("div");
	panel.setAttribute("role", "dialog");
	panel.setAttribute("tabindex", "-1");
	const closeBtn = document.createElement("button");
	closeBtn.textContent = "Close";
	panel.appendChild(closeBtn);
	document.body.appendChild(panel);
	return panel;
}

// jsdom does no layout, so offsetParent is always null and getFocusable()
// would filter everything out; give elements a truthy offsetParent to mimic a
// rendered element when a test needs the trap's focusable set to be visible.
function makeRendered(el: HTMLElement): HTMLElement {
	Object.defineProperty(el, "offsetParent", { configurable: true, get: () => ({}) });
	return el;
}

afterEach(() => {
	document.body.innerHTML = "";
	vi.restoreAllMocks();
});

describe("createFocusTrap restore (TASK-278)", () => {
	it("restores focus to a tabindex=-1 row trigger after deactivate (memory-row case)", () => {
		const row = makeRow();
		const panel = makePanel();
		// Simulate the user clicking the row: it becomes the active element.
		row.focus();
		const trap = createFocusTrap(panel, { onEscape: () => {} });
		trap.activate();
		expect(document.activeElement).not.toBe(row); // focus moved into the panel

		trap.deactivate();
		expect(document.activeElement).toBe(row);
		expect(document.activeElement?.classList.contains("mem-row")).toBe(true);
	});

	it("falls back to the drawer container when the trigger is not focusable (<body>)", () => {
		// previousFocus === body when the trigger has no tabindex (pre-fix bug)
		document.body.focus();
		const panel = makePanel();
		const trap = createFocusTrap(panel, { onEscape: () => {} });
		trap.activate();
		vi.useFakeTimers();
		trap.deactivate();
		vi.advanceTimersByTime(0);
		vi.useRealTimers();

		expect(document.activeElement).not.toBe(document.body);
		// Container fallback is deferred one tick so it survives unmount.
		expect(document.activeElement).toBe(panel);
	});

	it("falls back to the first page focusable when the container is removed (post-unmount)", () => {
		document.body.focus();
		const panel = makePanel();
		const outside = makeRendered(document.createElement("button"));
		outside.textContent = "outside";
		document.body.appendChild(outside);

		const trap = createFocusTrap(panel, { onEscape: () => {} });
		trap.activate();
		// Drawer unmounts the panel right after deactivate (Svelte {#if}).
		vi.useFakeTimers();
		panel.remove();
		trap.deactivate();
		vi.advanceTimersByTime(0);
		vi.useRealTimers();
		expect(document.activeElement).toBe(outside);
		expect(document.activeElement).not.toBe(document.body);
	});

	it("never restores focus to <body> even with no previous focus and no fallback", () => {
		document.body.focus();
		const panel = makePanel();
		const trap = createFocusTrap(panel, { onEscape: () => {} });
		trap.activate();
		vi.useFakeTimers();
		trap.deactivate();
		vi.advanceTimersByTime(0);
		vi.useRealTimers();
		expect(document.activeElement).not.toBe(document.body);
	});

	it("routes Escape to onEscape and stops propagation", () => {
		const onEscape = vi.fn();
		const panel = makePanel();
		const trap = createFocusTrap(panel, { onEscape });
		trap.activate();

		const stopPropagation = vi.fn();
		const ev = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
		vi.spyOn(ev, "stopPropagation").mockImplementation(stopPropagation);
		panel.dispatchEvent(ev);
		expect(onEscape).toHaveBeenCalledTimes(1);
		expect(stopPropagation).toHaveBeenCalled();
	});

	it("keeps Tab wrapped inside the trap", () => {
		const panel = makePanel();
		const btnA = makeRendered(panel.querySelector("button")!);
		const btnB = makeRendered(document.createElement("button"));
		btnB.textContent = "second";
		panel.appendChild(btnB);
		const trap = createFocusTrap(panel, { onEscape: () => {} });
		trap.activate();
		btnB.focus();

		const ev = new KeyboardEvent("keydown", { key: "Tab", bubbles: true });
		ev.preventDefault = vi.fn();
		panel.dispatchEvent(ev);
		expect(document.activeElement).toBe(btnA);
	});
});
