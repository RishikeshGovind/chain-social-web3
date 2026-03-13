"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";

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
  approvedRemoteMediaUrls: string[];
  operator?: { address: string; authMethod: string };
  error?: string;
};

type PostPreview = {
  id: string;
  content: string | null;
  media: string[];
  author: string;
  username: string;
  timestamp: string | null;
  source: string;
};

type Tab = "reports" | "actioned" | "quarantine" | "hidden";

function shorten(value: string, max = 20) {
  if (value.length <= max) return value;
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
      return ["redact_message", "ban_address", "reject_report"] as const;
    case "media":
      return ["approve_media", "block_media", "reject_report"] as const;
    default:
      return ["reject_report"] as const;
  }
}

const ACTION_LABELS: Record<string, string> = {
  hide_post: "Hide Post",
  hide_reply: "Hide Reply",
  hide_profile: "Hide Profile",
  ban_address: "Ban User",
  reject_report: "Dismiss",
  approve_media: "Approve",
  block_media: "Block",
  redact_message: "Redact",
};

const BADGE_COLORS: Record<string, string> = {
  open: "border-yellow-400/30 bg-yellow-400/10 text-yellow-200",
  actioned: "border-green-400/30 bg-green-400/10 text-green-200",
  rejected: "border-gray-400/30 bg-gray-400/10 text-gray-300",
  reviewed: "border-blue-400/30 bg-blue-400/10 text-blue-200",
};

export default function ModerationAdminPage() {
  const { user } = usePrivy();
  const walletAddress = useMemo(() => user?.wallet?.address ?? "", [user?.wallet?.address]);
  const [state, setState] = useState<ModerationState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("reports");
  const [postPreviews, setPostPreviews] = useState<Record<string, PostPreview>>({});
  const [loadingPreviews, setLoadingPreviews] = useState<Set<string>>(new Set());
  const [cleaning, setCleaning] = useState(false);

  const headers = useMemo(
    (): Record<string, string> =>
      walletAddress ? { "x-wallet-address": walletAddress } : {},
    [walletAddress]
  );

  const loadState = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/moderation/reports", {
        credentials: "include",
        cache: "no-store",
        headers,
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
  }, [headers]);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  // Fetch post content preview for a report
  const fetchPreview = useCallback(
    async (entityId: string) => {
      if (postPreviews[entityId] || loadingPreviews.has(entityId)) return;
      setLoadingPreviews((prev) => new Set(prev).add(entityId));
      try {
        const res = await fetch(
          `/api/admin/moderation/post?id=${encodeURIComponent(entityId)}`,
          { headers, credentials: "include", cache: "no-store" }
        );
        if (res.ok) {
          const data = (await res.json()) as PostPreview;
          setPostPreviews((prev) => ({ ...prev, [entityId]: data }));
        }
      } catch {
        // silent
      } finally {
        setLoadingPreviews((prev) => {
          const next = new Set(prev);
          next.delete(entityId);
          return next;
        });
      }
    },
    [headers, postPreviews, loadingPreviews]
  );

  // Auto-load previews for all post/reply reports
  useEffect(() => {
    if (!state) return;
    const postReports = state.reports.filter(
      (r) => (r.entityType === "post" || r.entityType === "reply") && !postPreviews[r.entityId]
    );
    // Load up to 10 at a time to avoid flooding
    const toLoad = postReports.slice(0, 10);
    for (const report of toLoad) {
      void fetchPreview(report.entityId);
    }
  }, [state, postPreviews, fetchPreview]);

  async function applyAction(report: ModerationReport, action: string) {
    setActingId(report.id);
    setError(null);
    try {
      const res = await fetch("/api/admin/moderation/reports", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...headers },
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

  async function handleCleanup() {
    setCleaning(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/moderation/cleanup", {
        method: "POST",
        headers,
        credentials: "include",
      });
      const data = (await res.json()) as { removedReports?: number; clearedQuarantined?: number; error?: string };
      if (!res.ok) throw new Error(data.error || "Cleanup failed");
      await loadState();
    } catch (cleanupError) {
      setError(cleanupError instanceof Error ? cleanupError.message : "Cleanup failed");
    } finally {
      setCleaning(false);
    }
  }

  const openReports = useMemo(
    () => state?.reports.filter((r) => r.status === "open") ?? [],
    [state]
  );
  const actionedReports = useMemo(
    () => state?.reports.filter((r) => r.status !== "open") ?? [],
    [state]
  );
  const autoMediaReports = useMemo(
    () =>
      openReports.filter(
        (r) =>
          r.entityType === "media" &&
          r.reason === "other" &&
          r.details?.includes("automatically")
      ),
    [openReports]
  );
  const userReports = useMemo(
    () => openReports.filter((r) => !autoMediaReports.includes(r)),
    [openReports, autoMediaReports]
  );

  const tabs: Array<{ id: Tab; label: string; count: number }> = [
    { id: "reports", label: "Open Reports", count: userReports.length },
    { id: "quarantine", label: "Auto-Quarantine", count: autoMediaReports.length + (state?.quarantinedMediaUrls.length ?? 0) },
    { id: "actioned", label: "History", count: actionedReports.length },
    { id: "hidden", label: "Hidden", count: (state?.hiddenPostIds.length ?? 0) + (state?.bannedAddresses.length ?? 0) },
  ];

  return (
    <div className="min-h-screen bg-[#05070b] px-4 py-8 text-white sm:px-6">
      <div className="mx-auto max-w-5xl">
        {/* Header */}
        <div className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-6 backdrop-blur">
          <p className="text-[11px] uppercase tracking-[0.28em] text-cyan-200">Admin</p>
          <h1 className="mt-2 text-2xl font-black uppercase tracking-[-0.04em]">Moderation</h1>
          {state?.operator && (
            <p className="mt-2 text-xs text-gray-500">
              {shorten(state.operator.address, 42)}
            </p>
          )}
        </div>

        {error && (
          <div className="mt-4 rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        {/* Stats */}
        <div className="mt-4 grid gap-3 grid-cols-2 sm:grid-cols-4">
          <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
            <p className="text-xs text-gray-400">User Reports</p>
            <p className="mt-1 text-2xl font-semibold">{userReports.length}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
            <p className="text-xs text-gray-400">Auto-Quarantined</p>
            <p className="mt-1 text-2xl font-semibold">{state?.quarantinedMediaUrls.length ?? 0}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
            <p className="text-xs text-gray-400">Hidden Posts</p>
            <p className="mt-1 text-2xl font-semibold">{state?.hiddenPostIds.length ?? 0}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
            <p className="text-xs text-gray-400">Banned</p>
            <p className="mt-1 text-2xl font-semibold">{state?.bannedAddresses.length ?? 0}</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="mt-6 flex gap-2 overflow-x-auto pb-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`whitespace-nowrap rounded-full border px-4 py-2 text-xs uppercase tracking-[0.14em] transition ${
                tab === t.id
                  ? "border-cyan-400/30 bg-cyan-400/10 text-white"
                  : "border-white/10 text-gray-400 hover:bg-white/[0.04]"
              }`}
            >
              {t.label}
              {t.count > 0 && (
                <span className="ml-2 rounded-full bg-white/10 px-2 py-0.5 text-[10px]">
                  {t.count}
                </span>
              )}
            </button>
          ))}
          <div className="ml-auto flex gap-2">
            <button
              onClick={() => void loadState()}
              className="rounded-full border border-white/10 px-4 py-2 text-xs text-gray-300 transition hover:bg-white/[0.06]"
            >
              Refresh
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="mt-4 rounded-[2rem] border border-white/10 bg-white/[0.04] p-5 backdrop-blur">
          {loading ? (
            <p className="text-sm text-gray-400">Loading...</p>
          ) : tab === "reports" ? (
            /* ── Open User Reports ── */
            userReports.length === 0 ? (
              <p className="text-sm text-gray-400">No open reports from users.</p>
            ) : (
              <div className="space-y-4">
                {userReports.map((report) => (
                  <ReportCard
                    key={report.id}
                    report={report}
                    actingId={actingId}
                    preview={postPreviews[report.entityId]}
                    loadingPreview={loadingPreviews.has(report.entityId)}
                    onAction={(action) => void applyAction(report, action)}
                    onLoadPreview={() => void fetchPreview(report.entityId)}
                  />
                ))}
              </div>
            )
          ) : tab === "quarantine" ? (
            /* ── Auto Quarantine ── */
            <div className="space-y-4">
              {(autoMediaReports.length > 0 || (state?.quarantinedMediaUrls.length ?? 0) > 0) && (
                <div className="flex items-center justify-between rounded-2xl border border-yellow-400/20 bg-yellow-400/5 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-yellow-200">
                      {autoMediaReports.length} auto-generated reports &middot;{" "}
                      {state?.quarantinedMediaUrls.length ?? 0} quarantined URLs
                    </p>
                    <p className="mt-1 text-xs text-gray-400">
                      These were created automatically by the media quarantine system. You can clear them all at once.
                    </p>
                  </div>
                  <button
                    onClick={() => void handleCleanup()}
                    disabled={cleaning}
                    className="rounded-full border border-yellow-400/30 bg-yellow-400/10 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-yellow-200 transition hover:bg-yellow-400/20 disabled:opacity-50"
                  >
                    {cleaning ? "Clearing..." : "Clear All"}
                  </button>
                </div>
              )}
              {autoMediaReports.length === 0 && (state?.quarantinedMediaUrls.length ?? 0) === 0 && (
                <p className="text-sm text-gray-400">No quarantined items.</p>
              )}
            </div>
          ) : tab === "actioned" ? (
            /* ── History ── */
            actionedReports.length === 0 ? (
              <p className="text-sm text-gray-400">No moderation history yet.</p>
            ) : (
              <div className="space-y-4">
                {actionedReports.map((report) => (
                  <ReportCard
                    key={report.id}
                    report={report}
                    actingId={actingId}
                    preview={postPreviews[report.entityId]}
                    loadingPreview={loadingPreviews.has(report.entityId)}
                    onAction={(action) => void applyAction(report, action)}
                    onLoadPreview={() => void fetchPreview(report.entityId)}
                  />
                ))}
              </div>
            )
          ) : (
            /* ── Hidden items ── */
            <div className="space-y-4">
              {(state?.hiddenPostIds.length ?? 0) > 0 && (
                <div>
                  <h3 className="mb-2 text-sm font-semibold text-gray-300">Hidden Posts</h3>
                  <div className="space-y-1">
                    {state!.hiddenPostIds.map((id) => (
                      <div key={id} className="flex items-center justify-between rounded-xl border border-white/5 bg-black/20 px-4 py-2 text-xs">
                        <span className="text-gray-300">{shorten(id)}</span>
                        <button
                          onClick={() =>
                            void applyAction(
                              { id: "", entityId: id, entityType: "post" } as ModerationReport,
                              "unhide_post"
                            )
                          }
                          className="text-cyan-300 hover:text-white"
                        >
                          Unhide
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {(state?.bannedAddresses.length ?? 0) > 0 && (
                <div>
                  <h3 className="mb-2 text-sm font-semibold text-gray-300">Banned Addresses</h3>
                  <div className="space-y-1">
                    {state!.bannedAddresses.map((addr) => (
                      <div key={addr} className="flex items-center justify-between rounded-xl border border-white/5 bg-black/20 px-4 py-2 text-xs">
                        <span className="text-gray-300">{shorten(addr, 42)}</span>
                        <button
                          onClick={() =>
                            void applyAction(
                              { id: "", entityId: "", entityType: "profile", targetAddress: addr } as ModerationReport,
                              "unban_address"
                            )
                          }
                          className="text-cyan-300 hover:text-white"
                        >
                          Unban
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {(state?.hiddenPostIds.length ?? 0) === 0 && (state?.bannedAddresses.length ?? 0) === 0 && (
                <p className="text-sm text-gray-400">Nothing hidden or banned.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Report Card Component ── */

function ReportCard({
  report,
  actingId,
  preview,
  loadingPreview,
  onAction,
  onLoadPreview,
}: {
  report: ModerationReport;
  actingId: string | null;
  preview?: PostPreview;
  loadingPreview: boolean;
  onAction: (action: string) => void;
  onLoadPreview: () => void;
}) {
  const isPostOrReply = report.entityType === "post" || report.entityType === "reply";

  return (
    <article className="rounded-[1.5rem] border border-white/10 bg-black/30 p-5">
      {/* Header badges */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1 uppercase tracking-wider text-cyan-200">
          {report.entityType}
        </span>
        <span className="rounded-full border border-red-400/20 bg-red-400/10 px-2.5 py-1 uppercase tracking-wider text-red-200">
          {report.reason}
        </span>
        <span className={`rounded-full border px-2.5 py-1 uppercase tracking-wider ${BADGE_COLORS[report.status]}`}>
          {report.status}
        </span>
        <span className="ml-auto text-gray-500">
          {new Date(report.createdAt).toLocaleString()}
        </span>
      </div>

      {/* Reporter info */}
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-400">
        <span>Reporter: {shorten(report.reporterAddress, 42)}</span>
        {report.targetAddress && <span>Target: {shorten(report.targetAddress, 42)}</span>}
      </div>

      {/* Report details (from user) */}
      {report.details && (
        <p className="mt-3 rounded-xl border border-white/5 bg-black/20 px-3 py-2 text-sm text-gray-300">
          {report.details}
        </p>
      )}

      {/* Post content preview */}
      {isPostOrReply && (
        <div className="mt-3">
          {preview ? (
            <div className="rounded-xl border border-white/10 bg-black/40 p-4">
              <div className="mb-2 flex items-center gap-2 text-xs text-gray-400">
                {preview.username && <span className="font-medium text-cyan-300">@{preview.username}</span>}
                {preview.author && <span>{shorten(preview.author, 42)}</span>}
                <span className={
                  preview.source === "lens" ? "text-green-400" :
                  preview.source === "local" ? "text-blue-400" :
                  "text-yellow-400"
                }>
                  ({preview.source === "lens" ? "Lens" : preview.source === "local" ? "Local" : "Not found"})
                </span>
                {preview.timestamp && (
                  <span className="ml-auto">{new Date(preview.timestamp).toLocaleString()}</span>
                )}
              </div>
              {preview.content ? (
                <div className="rounded-lg border border-white/5 bg-black/30 p-3">
                  <p className="text-sm leading-relaxed text-white whitespace-pre-wrap">
                    {preview.content.length > 800
                      ? preview.content.slice(0, 800) + "…"
                      : preview.content}
                  </p>
                </div>
              ) : preview.source === "not_found" ? (
                <p className="text-xs italic text-gray-500">
                  Could not fetch post content. Post may have been deleted. ID: {report.entityId}
                </p>
              ) : (
                <p className="text-xs italic text-gray-500">No text content (media-only post)</p>
              )}
              {preview.media.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {preview.media.map((url, i) => {
                    const safeUrl = /^https?:\/\//i.test(url) ? url : "#";
                    return (
                    <a key={i} href={safeUrl} target="_blank" rel="noopener noreferrer"
                       className="block overflow-hidden rounded-lg border border-white/10 hover:border-white/30 transition">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={safeUrl}
                        alt={`Media ${i + 1}`}
                        className="h-24 w-24 object-cover"
                        onError={(e) => {
                          const el = e.target as HTMLImageElement;
                          el.outerHTML = `<div class="flex h-24 w-24 items-center justify-center bg-black/60 text-[10px] text-gray-500">Failed</div>`;
                        }}
                      />
                    </a>
                    );
                  })}
                </div>
              )}
            </div>
          ) : loadingPreview ? (
            <div className="rounded-xl border border-dashed border-white/10 px-4 py-3 text-xs text-gray-500">
              Loading post content...
            </div>
          ) : (
            <button
              onClick={onLoadPreview}
              className="rounded-xl border border-dashed border-white/10 px-4 py-2 text-xs text-gray-400 transition hover:border-white/20 hover:text-gray-300"
            >
              Retry loading content
            </button>
          )}
        </div>
      )}

      {/* Entity ID for non-post types */}
      {!isPostOrReply && (
        <p className="mt-3 text-xs text-gray-400 break-all">
          ID: {report.entityType === "media" ? report.entityId : shorten(report.entityId)}
        </p>
      )}

      {/* Actions */}
      <div className="mt-4 flex flex-wrap gap-2">
        {actionsForReport(report).map((action) => {
          const isDestructive = action !== "reject_report" && action !== "approve_media";
          return (
            <button
              key={action}
              onClick={() => onAction(action)}
              disabled={actingId === report.id}
              className={`rounded-full border px-4 py-2 text-xs font-medium uppercase tracking-wider transition disabled:opacity-50 ${
                isDestructive
                  ? "border-red-400/20 bg-red-400/10 text-red-200 hover:bg-red-400/20"
                  : "border-white/10 text-gray-300 hover:bg-white/[0.06]"
              }`}
            >
              {ACTION_LABELS[action] ?? action.replaceAll("_", " ")}
            </button>
          );
        })}
      </div>
    </article>
  );
}
