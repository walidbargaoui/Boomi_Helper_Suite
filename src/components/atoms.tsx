import clsx from "clsx";
import { AlertTriangle, CheckCircle2, XCircle, type LucideIcon } from "lucide-react";
import type { MappingIssue, MappingRule } from "@/lib/domain";

export function WorkspacePanel({ children }: { children: React.ReactNode }) {
  return <div className="p-5">{children}</div>;
}

export function PanelHeader({
  icon: Icon,
  title,
  action,
}: {
  icon: LucideIcon;
  title: string;
  action?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon size={17} className="text-[#298b68]" />
      <p className="text-sm font-semibold">{title}</p>
      {action ? <span className="ml-auto text-xs font-medium text-[#66706a]">{action}</span> : null}
    </div>
  );
}

export function InfoRow({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2" : ""}>
      <p className="text-xs font-semibold uppercase text-[#66706a]">{label}</p>
      <p className="mt-1 text-sm leading-6 text-[#1b1f23]">{value}</p>
    </div>
  );
}

export function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone: "green" | "amber" | "gray" | "red";
}) {
  return (
    <span
      className={clsx(
        "inline-flex h-6 items-center rounded-md px-2 text-xs font-medium",
        tone === "green" && "bg-[#e3f3ed] text-[#1b5e4a]",
        tone === "amber" && "bg-[#fff3d9] text-[#8a5a0a]",
        tone === "gray" && "bg-[#eef1ee] text-[#4a524d]",
        tone === "red" && "bg-[#fdecec] text-[#9c2a2a]",
      )}
    >
      {label}
    </span>
  );
}

export function MappingTypePill({ type }: { type: MappingRule["mappingType"] }) {
  const tone = type === "direct" ? "green" : type === "constant" ? "gray" : "amber";
  return <StatusPill label={type} tone={tone} />;
}

export function IssueRow({ issue }: { issue: MappingIssue }) {
  const Icon =
    issue.severity === "error" ? XCircle : issue.severity === "warning" ? AlertTriangle : CheckCircle2;
  return (
    <div className="flex gap-2 rounded-md bg-white p-3">
      <Icon
        size={16}
        className={clsx(
          "mt-0.5 shrink-0",
          issue.severity === "error" && "text-[#b83b3b]",
          issue.severity === "warning" && "text-[#b77816]",
          issue.severity === "info" && "text-[#298b68]",
        )}
      />
      <div>
        <p className="text-sm font-semibold">{issue.title}</p>
        <p className="mt-1 text-xs leading-5 text-[#66706a]">{issue.detail}</p>
      </div>
    </div>
  );
}
