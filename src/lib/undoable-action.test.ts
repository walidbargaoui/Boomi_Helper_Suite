import { describe, it, expect, vi } from "vitest";
import { runUndoableAction } from "@/lib/undoable-action";

describe("runUndoableAction", () => {
  it("runs action after delay when not undone", async () => {
    vi.useFakeTimers();
    const action = vi.fn(async () => {});
    const addToast = vi.fn();

    runUndoableAction({ addToast }, "Deleting...", action, 1000);
    expect(addToast).toHaveBeenCalledTimes(1);
    expect(action).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    expect(action).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("cancels action when undo is clicked", async () => {
    vi.useFakeTimers();
    const action = vi.fn(async () => {});
    const addToast = vi.fn();

    runUndoableAction({ addToast }, "Deleting...", action, 1000);
    const toastArg = addToast.mock.calls[0]?.[0] as { action?: { onAction: () => void } };
    toastArg.action?.onAction();
    await vi.advanceTimersByTimeAsync(1000);

    expect(action).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
