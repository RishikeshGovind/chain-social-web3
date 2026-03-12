"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { createPortal } from "react-dom";

type ReportEntityType = "post" | "reply" | "profile" | "message";

type ReportButtonProps = {
  entityType: ReportEntityType;
  entityId: string;
  targetAddress?: string;
  compact?: boolean;
  className?: string;
};

const REPORT_REASONS = [
  { value: "nudity", label: "Nudity" },
  { value: "sexual_content", label: "Sexual content" },
  { value: "harassment", label: "Harassment" },
  { value: "hate", label: "Hate" },
  { value: "spam", label: "Spam" },
  { value: "scam", label: "Scam" },
  { value: "malware", label: "Malware" },
  { value: "illegal_content", label: "Illegal content" },
  { value: "impersonation", label: "Impersonation" },
  { value: "other", label: "Other" },
] as const;

export default function ReportButton({
  entityType,
  entityId,
  targetAddress,
  compact = false,
  className = "",
}: ReportButtonProps) {
  const { authenticated } = usePrivy();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<(typeof REPORT_REASONS)[number]["value"]>("spam");
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [panelStyle, setPanelStyle] = useState<{ top: number; left: number }>({
    top: 0,
    left: 0,
  });
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const buttonLabel = useMemo(() => (compact ? "Report" : "Report content"), [compact]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;

    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const panelWidth = 288;
      const margin = 12;
      const left = Math.max(
        margin,
        Math.min(window.innerWidth - panelWidth - margin, rect.right - panelWidth)
      );
      const estimatedHeight = panelRef.current?.offsetHeight ?? 260;
      const showAbove = rect.bottom + 12 + estimatedHeight > window.innerHeight && rect.top > estimatedHeight + 12;
      const top = showAbove
        ? Math.max(12, rect.top - estimatedHeight - 8)
        : Math.min(window.innerHeight - estimatedHeight - 12, rect.bottom + 8);
      setPanelStyle({ top, left });
    };

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (
        target &&
        !panelRef.current?.contains(target) &&
        !triggerRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    document.addEventListener("mousedown", onPointerDown);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open]);

  async function submitReport() {
    if (!authenticated) {
      setError("Connect your account before submitting a report.");
      return;
    }
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/moderation/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          entityType,
          entityId,
          targetAddress,
          reason,
          details,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error || "Failed to submit report");
      }
      setMessage("Report submitted");
      setDetails("");
      setOpen(false);
    } catch (reportError) {
      setError(reportError instanceof Error ? reportError.message : "Failed to submit report");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        ref={triggerRef}
        onClick={() => {
          setOpen((current) => !current);
          setError(null);
          setMessage(null);
        }}
        className="rounded-full border border-white/10 px-3 py-1.5 text-xs uppercase tracking-[0.16em] text-gray-300 transition hover:bg-white/[0.06] hover:text-white"
      >
        {buttonLabel}
      </button>
      {message && <p className="mt-2 text-[11px] text-emerald-300">{message}</p>}
      {open && mounted && createPortal(
        <div
          ref={panelRef}
          className="fixed z-[200] w-72 rounded-2xl border border-white/10 bg-[#090c12] p-4 shadow-2xl"
          style={{ top: panelStyle.top, left: panelStyle.left }}
          onClick={(event) => event.stopPropagation()}
        >
          <p className="text-xs uppercase tracking-[0.2em] text-cyan-200">Report</p>
          {!authenticated && (
            <p className="mt-3 text-xs leading-5 text-amber-200">
              Connect your account first. Reports are tied to a signed-in wallet so abuse actions can be audited.
            </p>
          )}
          <select
            value={reason}
            onChange={(event) => setReason(event.target.value as (typeof REPORT_REASONS)[number]["value"])}
            className="mt-3 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
            disabled={!authenticated || submitting}
          >
            {REPORT_REASONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <textarea
            value={details}
            onChange={(event) => setDetails(event.target.value)}
            rows={3}
            maxLength={500}
            placeholder="Optional details"
            className="mt-3 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
            disabled={!authenticated || submitting}
          />
          {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-gray-300"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submitReport()}
              disabled={!authenticated || submitting}
              className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50"
            >
              {submitting ? "Sending..." : "Submit"}
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
