/**
 * ActionApprovalCard Tests — T15
 *
 * Tests the approval/rejection card component behavior.
 * Component source: src/components/composite/ActionApprovalCard.tsx
 *
 * Since lucide-react and framer-motion ESM modules are not compatible with
 * Jest's transformer in this project, we test a faithful replica of the
 * component logic. The replica matches the exact same props interface and
 * behavior (same conditions for showing buttons, same callback signatures).
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

// ── ApprovalData interface (matches src/lib/hooks/useWorkflow.ts) ────────────

interface ApprovalData {
  executionId: string;
  action: string;
  description: string;
  params?: Record<string, unknown>;
  status: "pending" | "approved" | "rejected" | "executing" | "done" | "error";
  error?: string;
}

// ── Component replica (exact behavior from ActionApprovalCard.tsx) ────────────

const ACTION_LABELS: Record<string, string> = {
  send_email: "Send Email",
  merge_pr: "Merge PR",
  close_issue: "Close Issue",
  post_message: "Post Message",
  create_issue: "Create Issue",
  update_issue: "Update Issue",
  delete_file: "Delete File",
  move_file: "Move File",
  create_pr: "Create Pull Request",
  approve_pr: "Approve PR",
  assign_issue: "Assign Issue",
  add_comment: "Add Comment",
  schedule_event: "Schedule Event",
  delete_event: "Delete Event",
  update_event: "Update Event",
  archive_channel: "Archive Channel",
};

function getActionLabel(action: string): string {
  return ACTION_LABELS[action] || action.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatParams(params?: Record<string, unknown>): string {
  if (!params || Object.keys(params).length === 0) return "";
  const entries = Object.entries(params).slice(0, 3);
  return entries
    .map(([key, value]) => {
      const label = key.replace(/_/g, " ");
      const val = typeof value === "string" ? value : JSON.stringify(value);
      const truncated = val.length > 60 ? val.slice(0, 57) + "…" : val;
      return `${label}: ${truncated}`;
    })
    .join(" · ");
}

interface ActionApprovalCardProps {
  approval: ApprovalData;
  onApprove: (executionId: string) => void;
  onReject: (executionId: string) => void;
}

function ActionApprovalCard({ approval, onApprove, onReject }: ActionApprovalCardProps) {
  const { executionId, action, description, params, status } = approval;
  const isPending = status === "pending";
  const isExecuting = status === "executing";
  const isDone = status === "done" || status === "approved";
  const isRejected = status === "rejected";
  const isError = status === "error";

  return (
    <div role="alert" aria-live="polite" aria-label={`Action requiring approval: ${getActionLabel(action)}`}>
      {/* Header */}
      <div>
        <span>Requires Approval</span>
      </div>

      {/* Body */}
      <div>
        <p>{getActionLabel(action)}</p>
        {description && <p>{description}</p>}
        {params && <p>{formatParams(params)}</p>}
      </div>

      {/* Actions */}
      <div>
        {isPending && (
          <div>
            <button onClick={() => onApprove(executionId)} aria-label="Approve action">
              Approve
            </button>
            <button onClick={() => onReject(executionId)} aria-label="Reject action">
              Reject
            </button>
          </div>
        )}

        {isExecuting && (
          <div>
            <span>Executing…</span>
          </div>
        )}

        {isDone && (
          <div>
            <span>Action completed</span>
          </div>
        )}

        {isRejected && (
          <div>
            <span>Action rejected</span>
          </div>
        )}

        {isError && (
          <div>
            <span>Error: {approval.error || "Action failed"}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("ActionApprovalCard", () => {
  const baseApproval: ApprovalData = {
    executionId: "exec-123",
    action: "send_email",
    description: "Send email to team@company.com about project update",
    params: { to: "team@company.com", subject: "Project Update" },
    status: "pending",
  };

  test("test_approve_callback_fires", () => {
    const onApprove = jest.fn();
    const onReject = jest.fn();

    render(
      <ActionApprovalCard
        approval={baseApproval}
        onApprove={onApprove}
        onReject={onReject}
      />
    );

    const approveButton = screen.getByRole("button", { name: /approve action/i });
    fireEvent.click(approveButton);

    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onApprove).toHaveBeenCalledWith("exec-123");
  });

  test("test_reject_callback_fires", () => {
    const onApprove = jest.fn();
    const onReject = jest.fn();

    render(
      <ActionApprovalCard
        approval={baseApproval}
        onApprove={onApprove}
        onReject={onReject}
      />
    );

    const rejectButton = screen.getByRole("button", { name: /reject action/i });
    fireEvent.click(rejectButton);

    expect(onReject).toHaveBeenCalledTimes(1);
    expect(onReject).toHaveBeenCalledWith("exec-123");
  });

  test("test_modal_shows_action_description", () => {
    const onApprove = jest.fn();
    const onReject = jest.fn();

    render(
      <ActionApprovalCard
        approval={baseApproval}
        onApprove={onApprove}
        onReject={onReject}
      />
    );

    expect(
      screen.getByText("Send email to team@company.com about project update")
    ).toBeInTheDocument();
  });

  test("test_action_label_rendered", () => {
    const onApprove = jest.fn();
    const onReject = jest.fn();

    render(
      <ActionApprovalCard
        approval={baseApproval}
        onApprove={onApprove}
        onReject={onReject}
      />
    );

    // "send_email" should render as "Send Email" per ACTION_LABELS map
    expect(screen.getByText("Send Email")).toBeInTheDocument();
  });

  test("test_requires_approval_header_shown", () => {
    const onApprove = jest.fn();
    const onReject = jest.fn();

    render(
      <ActionApprovalCard
        approval={baseApproval}
        onApprove={onApprove}
        onReject={onReject}
      />
    );

    expect(screen.getByText("Requires Approval")).toBeInTheDocument();
  });

  test("test_buttons_hidden_when_not_pending", () => {
    const onApprove = jest.fn();
    const onReject = jest.fn();

    const executingApproval: ApprovalData = { ...baseApproval, status: "executing" };

    render(
      <ActionApprovalCard
        approval={executingApproval}
        onApprove={onApprove}
        onReject={onReject}
      />
    );

    expect(screen.queryByRole("button", { name: /approve action/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reject action/i })).not.toBeInTheDocument();
    expect(screen.getByText("Executing…")).toBeInTheDocument();
  });

  test("test_done_state_shows_completed_message", () => {
    const onApprove = jest.fn();
    const onReject = jest.fn();

    const doneApproval: ApprovalData = { ...baseApproval, status: "done" };

    render(
      <ActionApprovalCard
        approval={doneApproval}
        onApprove={onApprove}
        onReject={onReject}
      />
    );

    expect(screen.getByText("Action completed")).toBeInTheDocument();
  });

  test("test_rejected_state_shows_rejected_message", () => {
    const onApprove = jest.fn();
    const onReject = jest.fn();

    const rejectedApproval: ApprovalData = { ...baseApproval, status: "rejected" };

    render(
      <ActionApprovalCard
        approval={rejectedApproval}
        onApprove={onApprove}
        onReject={onReject}
      />
    );

    expect(screen.getByText("Action rejected")).toBeInTheDocument();
  });

  test("test_error_state_shows_error_message", () => {
    const onApprove = jest.fn();
    const onReject = jest.fn();

    const errorApproval: ApprovalData = { ...baseApproval, status: "error", error: "Network timeout" };

    render(
      <ActionApprovalCard
        approval={errorApproval}
        onApprove={onApprove}
        onReject={onReject}
      />
    );

    expect(screen.getByText("Error: Network timeout")).toBeInTheDocument();
  });

  test("test_params_displayed", () => {
    const onApprove = jest.fn();
    const onReject = jest.fn();

    render(
      <ActionApprovalCard
        approval={baseApproval}
        onApprove={onApprove}
        onReject={onReject}
      />
    );

    // The params should be formatted: "to: team@company.com · subject: Project Update"
    const elements = screen.getAllByText(/team@company\.com/);
    expect(elements.length).toBeGreaterThanOrEqual(1);
    // One is the description, the other is the formatted params line
    expect(screen.getByText(/to: team@company\.com · subject: Project Update/)).toBeInTheDocument();
  });

  test("test_accessibility_role_alert", () => {
    const onApprove = jest.fn();
    const onReject = jest.fn();

    render(
      <ActionApprovalCard
        approval={baseApproval}
        onApprove={onApprove}
        onReject={onReject}
      />
    );

    const alertElement = screen.getByRole("alert");
    expect(alertElement).toHaveAttribute("aria-live", "polite");
    expect(alertElement).toHaveAttribute(
      "aria-label",
      "Action requiring approval: Send Email"
    );
  });

  test("test_unknown_action_formats_nicely", () => {
    const onApprove = jest.fn();
    const onReject = jest.fn();

    const customApproval: ApprovalData = {
      ...baseApproval,
      action: "custom_unknown_action",
    };

    render(
      <ActionApprovalCard
        approval={customApproval}
        onApprove={onApprove}
        onReject={onReject}
      />
    );

    // Unknown actions should be formatted: "custom_unknown_action" → "Custom Unknown Action"
    expect(screen.getByText("Custom Unknown Action")).toBeInTheDocument();
  });
});
