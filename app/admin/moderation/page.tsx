"use client";

import { useCallback, useEffect, useState } from "react";

type ModerationReport = {
  id: string;
  reporterAddress: string;
  entityType: "post" | "reply" | "profile" | "message" | "media";
  entityId: string;
  targetAddress?: string;
  reason: string;
  details?: string;
  status: "open" | "reviewed" | "actioned" | "rejected";
  createdAt: string;
  updatedAt: string;
  resolutionNotes?: string;
  action?: string;
};

type ModerationState = {
  reports: ModerationReport[];
  hiddenPostIds: string[];
  hiddenReplyIds: string[];
  hiddenProfileAddresses: string[];
  bannedAddresses: string[];
  blockedMediaUrls: string[];
  quarantinedMediaUrls: string[];
  operator?: { address: string; authMethod: string };
  error?: string;
};

function shorten(value: string) {
  if (value.length <= 20) return value;
  return `${value.slice(0, 10)}...${value.slice(-6)}`;
}

function actionsForReport(report: ModerationReport) {
  switch (report.entityType) {
    case "post":
      return ["hide_post", "ban_address", "reject_report"] as const;
    case "reply":
      return ["hide_reply", "ban_address", "reject_report"] as const;
    case "profile":
      return ["hide_profile", "ban_address", "reject_report"] as const;
    case "message":
      return ["ban_address", "reject_report"] as const;
    case "media":
      return ["approve_media", "block_media", "reject_report"] as const;
    default:
      return ["reject_report"] as const;
  }
}

export default function ModerationAdminPage() {
  const [state, setState] = useState<ModerationState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);

  const loadState = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/moderation/reports", {
        credentials: "include",
        cache: "no-store",
      });
      const data = (await res.json()) as ModerationState;
      if (!res.ok) throw new Error(data.error || "Failed to load moderation queue");
      setState(data);
    } catch (loadError) {
      setState(null);
      setError(loadError instanceof Error ? loadError.message : "Failed to load moderation queue");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  async function applyAction(report: ModerationReport, action: string) {
    setActingId(report.id);
    setError(null);
    try {
      const res = await fetch("/api/admin/moderation/reports", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          reportId: report.id,
          action,
          entityId: report.entityId,
          address: report.targetAddress,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Failed to apply moderation action");
      await loadState();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Failed to apply moderation action");
    } finally {
      setActingId(null);
    }
  }

  return (
    <div className="min-h-screen bg-[#05070b] px-6 py-10 text-white">
      <div className="mx-auto max-w-6xl">
        <div className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] backdrop-blur">
          <p className="text-[11px] uppercase tracking-[0.28em] text-cyan-200">Admin moderation</p>
          <h1 className="mt-3 text-3xl font-black uppercase tracking-[-0.05em]">Safety queue</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-gray-300">
            Review reports, quarantine media, and remove abusive content before it spreads across the product.
          </p>
          {state?.operator && (
            <p className="mt-4 text-xs text-gray-400">
              Signed in as {state.operator.address} via {state.operator.authMethod}
            </p>
          )}
        </div>

        {error && (
          <div className="mt-6 rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
            <p className="text-sm text-gray-400">Open reports</p>
            <p className="mt-2 text-3xl font-semibold text-white">
              {state?.reports.filter((report) => report.status === "open").length ?? 0}
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
            <p className="text-sm text-gray-400">Quarantined media</p>
            <p className="mt-2 text-3xl font-semibold text-white">
              {state?.quarantinedMediaUrls.length ?? 0}
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
            <p className="text-sm text-gray-400">Banned addresses</p>
            <p className="mt-2 text-3xl font-semibold text-white">
              {state?.bannedAddresses.length ?? 0}
            </p>
          </div>
        </div>

        <div className="mt-6 rounded-[2rem] border border-white/10 bg-white/[0.04] p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] backdrop-blur">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold text-white">Reports</h2>
            <button
              type="button"
              onClick={() => void loadState()}
              className="rounded-full border border-white/10 px-4 py-2 text-sm text-gray-300 transition hover:bg-white/[0.06]"
            >
              Refresh
            </button>
          </div>

          {loading ? (
            <p className="text-sm text-gray-400">Loading moderation queue...</p>
          ) : !state || state.reports.length === 0 ? (
            <p className="text-sm text-gray-400">No reports yet.</p>
          ) : (
            <div className="space-y-4">
              {state.reports.map((report) => (
                <article
                  key={report.id}
                  className="rounded-[1.5rem] border border-white/10 bg-black/30 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-cyan-200">
                          {report.entityType}
                        </span>
                        <span className="rounded-full border border-white/10 bg-black/30 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-gray-300">
                          {report.reason}
                        </span>
                        <span className="rounded-full border border-white/10 bg-black/30 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-gray-400">
                          {report.status}
                        </span>
                      </div>
                      <p className="mt-3 text-sm text-white">Target: {shorten(report.entityId)}</p>
                      <p className="mt-1 text-xs text-gray-400">
                        Reporter {shorten(report.reporterAddress)}
                        {report.targetAddress ? ` | Actor ${shorten(report.targetAddress)}` : ""}
                      </p>
                      {report.details && (
                        <p className="mt-3 text-sm leading-6 text-gray-300">{report.details}</p>
                      )}
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      {actionsForReport(report).map((action) => (
                        <button
                          key={action}
                          type="button"
                          onClick={() => void applyAction(report, action)}
                          disabled={actingId === report.id}
                          className="rounded-full border border-white/10 px-3 py-1.5 text-xs uppercase tracking-[0.16em] text-gray-200 transition hover:bg-white/[0.06] disabled:opacity-50"
                        >
                          {action.replaceAll("_", " ")}
                        </button>
                      ))}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
