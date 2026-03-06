"use client";

import Link from "next/link";
import { FormEvent, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useRouter, useSearchParams } from "next/navigation";
import AppShell from "@/components/AppShell";

type DirectMessage = {
  id: string;
  senderAddress: string;
  recipientAddress: string;
  content: string;
  createdAt: string;
  readAt?: string;
};

type ConversationSummary = {
  peerAddress: string;
  lastMessage: DirectMessage;
  unreadCount: number;
};

type MessagesResponse = {
  actor?: string;
  peerAddress?: string;
  conversations?: ConversationSummary[];
  messages?: DirectMessage[];
  message?: DirectMessage;
  error?: string;
};

function shortenAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function isAddress(value: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function MessagesPageContent() {
  const { authenticated, user } = usePrivy();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [peerInput, setPeerInput] = useState(searchParams.get("peer") ?? "");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [messages, setMessages] = useState<DirectMessage[]>([]);

  const viewerAddress = useMemo(
    () => user?.wallet?.address?.toLowerCase() ?? "",
    [user?.wallet?.address]
  );
  const activePeer = (searchParams.get("peer") ?? "").trim().toLowerCase();

  const loadInbox = useCallback(async (peerOverride?: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      const peer = (peerOverride ?? activePeer).trim();
      if (peer) params.set("peer", peer);
      const url = params.size > 0 ? `/api/messages?${params.toString()}` : "/api/messages";
      const res = await fetch(url, {
        credentials: "include",
        cache: "no-store",
      });
      const data = (await res.json()) as MessagesResponse;
      if (!res.ok) {
        throw new Error(data.error || "Failed to load messages");
      }
      setConversations(Array.isArray(data.conversations) ? data.conversations : []);
      setMessages(Array.isArray(data.messages) ? data.messages : []);
    } catch (loadError) {
      setConversations([]);
      setMessages([]);
      setError(loadError instanceof Error ? loadError.message : "Failed to load messages");
    } finally {
      setLoading(false);
    }
  }, [activePeer]);

  useEffect(() => {
    setPeerInput(searchParams.get("peer") ?? "");
  }, [searchParams]);

  useEffect(() => {
    void loadInbox();
  }, [loadInbox]);

  useEffect(() => {
    const onFocus = () => {
      void loadInbox();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [loadInbox]);

  function openConversation(peerAddress: string) {
    setPeerInput(peerAddress);
    setDraft("");
    router.replace(`/messages?peer=${peerAddress}`);
  }

  function startConversation(event: FormEvent) {
    event.preventDefault();
    const peer = peerInput.trim();
    if (!isAddress(peer)) {
      setError("Enter a valid recipient wallet address (0x...).");
      return;
    }
    setError(null);
    openConversation(peer.toLowerCase());
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    if (!activePeer || !isAddress(activePeer)) {
      setError("Open a conversation first.");
      return;
    }

    const content = draft.trim();
    if (!content) return;

    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          recipientAddress: activePeer,
          content,
        }),
      });
      const data = (await res.json()) as MessagesResponse;
      if (!res.ok) {
        throw new Error(data.error || "Failed to send message");
      }
      setDraft("");
      setConversations(Array.isArray(data.conversations) ? data.conversations : []);
      setMessages(Array.isArray(data.messages) ? data.messages : []);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Failed to send message");
    } finally {
      setSending(false);
    }
  }

  return (
    <AppShell active="Messages">
      <div className="w-full max-w-5xl px-6 py-8 text-white">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Messages</h1>
          <Link href="/feed" className="text-sm text-blue-400 hover:underline">
            Back to Feed
          </Link>
        </div>

        {!authenticated && (
          <div className="mb-4 rounded border border-yellow-800 bg-yellow-950 px-3 py-2 text-sm text-yellow-200">
            Connect Lens to view and send messages.
          </div>
        )}

        {error && (
          <div className="mb-4 rounded border border-red-800 bg-red-950 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="rounded-2xl border border-gray-800 bg-gray-900 p-4">
            <form onSubmit={startConversation} className="mb-4 space-y-2">
              <p className="text-sm text-gray-300">
                Start a conversation with a wallet address.
              </p>
              <input
                value={peerInput}
                onChange={(event) => setPeerInput(event.target.value)}
                placeholder="Recipient wallet address (0x...)"
                className="w-full rounded border border-gray-700 bg-black px-3 py-2 text-sm"
              />
              <button
                type="submit"
                className="w-full rounded bg-blue-600 px-4 py-2 text-sm font-medium hover:bg-blue-500"
              >
                Open Conversation
              </button>
            </form>

            <div className="space-y-2">
              {conversations.map((conversation) => {
                const active = conversation.peerAddress === activePeer;
                const mine = conversation.lastMessage.senderAddress === viewerAddress;
                return (
                  <button
                    key={conversation.peerAddress}
                    onClick={() => openConversation(conversation.peerAddress)}
                    className={`block w-full rounded-xl border px-3 py-3 text-left ${
                      active
                        ? "border-blue-700 bg-blue-950/30"
                        : "border-gray-800 bg-black hover:bg-gray-950"
                    }`}
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-white">
                        {shortenAddress(conversation.peerAddress)}
                      </span>
                      {conversation.unreadCount > 0 && (
                        <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[11px] text-white">
                          {conversation.unreadCount}
                        </span>
                      )}
                    </div>
                    <p className="truncate text-xs text-gray-400">
                      {mine ? "You: " : ""}
                      {conversation.lastMessage.content}
                    </p>
                    <p className="mt-1 text-[11px] text-gray-500">
                      {new Date(conversation.lastMessage.createdAt).toLocaleString()}
                    </p>
                  </button>
                );
              })}
              {!loading && conversations.length === 0 && (
                <p className="text-sm text-gray-500">No conversations yet.</p>
              )}
            </div>
          </aside>

          <section className="flex min-h-[32rem] flex-col rounded-2xl border border-gray-800 bg-gray-900 p-4">
            <div className="mb-4 border-b border-gray-800 pb-3">
              <p className="text-sm text-gray-400">
                {activePeer
                  ? `Conversation with ${shortenAddress(activePeer)}`
                  : "Select or start a conversation."}
              </p>
              {viewerAddress && (
                <p className="mt-1 text-xs text-gray-500">
                  Signed in as {shortenAddress(viewerAddress)}
                </p>
              )}
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto">
              {loading && <p className="text-sm text-gray-500">Loading messages...</p>}
              {!loading &&
                messages.map((message) => {
                  const mine = message.senderAddress === viewerAddress;
                  return (
                    <article
                      key={message.id}
                      className={`max-w-[85%] rounded-2xl border p-4 ${
                        mine
                          ? "ml-auto border-blue-700 bg-blue-950/30"
                          : "border-gray-800 bg-black"
                      }`}
                    >
                      <p className="mb-1 text-xs text-gray-400">
                        {mine ? "You" : shortenAddress(message.senderAddress)}
                      </p>
                      <p className="whitespace-pre-wrap break-words text-sm text-gray-100">
                        {message.content}
                      </p>
                      <p className="mt-2 text-[11px] text-gray-500">
                        {new Date(message.createdAt).toLocaleString()}
                      </p>
                    </article>
                  );
                })}
              {!loading && activePeer && messages.length === 0 && (
                <p className="text-sm text-gray-500">
                  No messages yet. Send the first one.
                </p>
              )}
              {!loading && !activePeer && (
                <p className="text-sm text-gray-500">
                  Choose a conversation from the left or paste a wallet address to begin.
                </p>
              )}
            </div>

            <form onSubmit={sendMessage} className="mt-4 flex gap-2 border-t border-gray-800 pt-4">
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={activePeer ? "Write a message" : "Open a conversation to send a message"}
                className="flex-1 rounded border border-gray-700 bg-black px-3 py-2 text-sm"
                disabled={!activePeer || sending}
              />
              <button
                type="submit"
                className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                disabled={!activePeer || sending}
              >
                Send
              </button>
            </form>
          </section>
        </div>
      </div>
    </AppShell>
  );
}

export default function MessagesPage() {
  return (
    <Suspense
      fallback={
        <AppShell active="Messages">
          <div className="w-full max-w-5xl px-6 py-8 text-white">
            <p className="text-sm text-gray-400">Loading messages...</p>
          </div>
        </AppShell>
      }
    >
      <MessagesPageContent />
    </Suspense>
  );
}
