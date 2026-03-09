"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import AppShell from "@/components/AppShell";

type UserList = {
  id: string;
  name: string;
  members: string[];
  createdAt: string;
  updatedAt: string;
};

type ListsResponse = {
  lists?: UserList[];
  error?: string;
};

function shortenAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function isAddress(value: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

export default function ListsPage() {
  const { authenticated } = usePrivy();
  const [name, setName] = useState("");
  const [lists, setLists] = useState<UserList[]>([]);
  const [memberDrafts, setMemberDrafts] = useState<Record<string, string>>({});
  const [renameDrafts, setRenameDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadLists() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/lists", {
        credentials: "include",
        cache: "no-store",
      });
      const data = (await res.json()) as ListsResponse;
      if (!res.ok) {
        throw new Error(
          res.status === 401 ? "Connect Lens to manage your lists." : data.error || "Failed to load lists"
        );
      }
      const nextLists = Array.isArray(data.lists) ? data.lists : [];
      setLists(nextLists);
      setRenameDrafts(
        Object.fromEntries(nextLists.map((list) => [list.id, list.name]))
      );
    } catch (loadError) {
      setLists([]);
      setError(loadError instanceof Error ? loadError.message : "Failed to load lists");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadLists();
  }, [authenticated]);

  async function createList(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name }),
      });
      const data = (await res.json()) as ListsResponse;
      if (!res.ok) {
        throw new Error(data.error || "Failed to create list");
      }
      const nextLists = Array.isArray(data.lists) ? data.lists : [];
      setLists(nextLists);
      setRenameDrafts(
        Object.fromEntries(nextLists.map((list) => [list.id, list.name]))
      );
      setName("");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create list");
    } finally {
      setBusy(false);
    }
  }

  async function updateList(listId: string, body: Record<string, unknown>, fallback: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/lists", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ listId, ...body }),
      });
      const data = (await res.json()) as ListsResponse;
      if (!res.ok) {
        throw new Error(data.error || fallback);
      }
      const nextLists = Array.isArray(data.lists) ? data.lists : [];
      setLists(nextLists);
      setRenameDrafts(
        Object.fromEntries(nextLists.map((list) => [list.id, list.name]))
      );
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : fallback);
    } finally {
      setBusy(false);
    }
  }

  async function deleteList(listId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/lists", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ listId }),
      });
      const data = (await res.json()) as ListsResponse;
      if (!res.ok) {
        throw new Error(data.error || "Failed to delete list");
      }
      const nextLists = Array.isArray(data.lists) ? data.lists : [];
      setLists(nextLists);
      setRenameDrafts(
        Object.fromEntries(nextLists.map((list) => [list.id, list.name]))
      );
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete list");
    } finally {
      setBusy(false);
    }
  }

  async function addMember(listId: string) {
    const memberAddress = (memberDrafts[listId] ?? "").trim();
    if (!isAddress(memberAddress)) {
      setError("Enter a valid wallet address to add to the list.");
      return;
    }
    await updateList(
      listId,
      { action: "add_member", memberAddress },
      "Failed to add list member"
    );
    setMemberDrafts((prev) => ({ ...prev, [listId]: "" }));
  }

  return (
    <AppShell active="Lists">
      <div className="w-full max-w-4xl px-6 py-8 text-white">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Lists</h1>
          <Link href="/feed" className="text-sm text-blue-400 hover:underline">
            Back to Feed
          </Link>
        </div>

        <form onSubmit={createList} className="mb-6 flex gap-2">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Create a list name"
            className="flex-1 rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            Add
          </button>
        </form>

        {error && (
          <div className="mb-4 rounded border border-red-800 bg-red-950 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}
        {!authenticated && !loading && !error && (
          <p className="mb-4 text-sm text-gray-500">Connect Lens to manage your lists.</p>
        )}
        {loading && <p className="text-gray-400">Loading lists...</p>}
        {!loading && lists.length === 0 && <p className="text-gray-500">No lists yet.</p>}

        <div className="space-y-4">
          {lists.map((list) => (
            <article key={list.id} className="rounded-2xl border border-gray-800 bg-gray-900 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <input
                  value={renameDrafts[list.id] ?? list.name}
                  onChange={(event) =>
                    setRenameDrafts((prev) => ({ ...prev, [list.id]: event.target.value }))
                  }
                  className="flex-1 rounded border border-gray-700 bg-black px-3 py-2 text-sm"
                />
                <button
                  onClick={() =>
                    void updateList(
                      list.id,
                      { action: "rename", name: renameDrafts[list.id] ?? list.name },
                      "Failed to rename list"
                    )
                  }
                  disabled={busy}
                  className="rounded border border-gray-700 px-3 py-2 text-xs text-gray-200 hover:bg-gray-800 disabled:opacity-50"
                >
                  Rename
                </button>
                <button
                  onClick={() => void deleteList(list.id)}
                  disabled={busy}
                  className="rounded border border-red-800 px-3 py-2 text-xs text-red-300 hover:bg-red-950 disabled:opacity-50"
                >
                  Delete
                </button>
              </div>

              <div className="mb-3 flex gap-2">
                <input
                  value={memberDrafts[list.id] ?? ""}
                  onChange={(event) =>
                    setMemberDrafts((prev) => ({ ...prev, [list.id]: event.target.value }))
                  }
                  placeholder="Add member wallet address (0x...)"
                  className="flex-1 rounded border border-gray-700 bg-black px-3 py-2 text-sm"
                />
                <button
                  onClick={() => void addMember(list.id)}
                  disabled={busy}
                  className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                >
                  Add Member
                </button>
              </div>

              <div className="space-y-2">
                {list.members.map((memberAddress) => (
                  <div
                    key={memberAddress}
                    className="flex items-center justify-between rounded-xl border border-gray-800 bg-black px-3 py-2"
                  >
                    <Link href={`/profile/${memberAddress}`} className="text-sm text-gray-100 hover:underline">
                      {shortenAddress(memberAddress)}
                    </Link>
                    <button
                      onClick={() =>
                        void updateList(
                          list.id,
                          { action: "remove_member", memberAddress },
                          "Failed to remove list member"
                        )
                      }
                      disabled={busy}
                      className="text-xs text-red-400 hover:underline disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </div>
                ))}
                {list.members.length === 0 && (
                  <p className="text-sm text-gray-500">No members in this list yet.</p>
                )}
              </div>
            </article>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
