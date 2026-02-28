"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import AppShell from "@/components/AppShell";

type UserList = {
  id: string;
  name: string;
};

const STORAGE_KEY = "chainsocial:lists";

function readLists(): UserList[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as UserList[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLists(items: UserList[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export default function ListsPage() {
  const [name, setName] = useState("");
  const [lists, setLists] = useState<UserList[]>([]);

  useEffect(() => {
    setLists(readLists());
  }, []);

  function createList(event: FormEvent) {
    event.preventDefault();
    const value = name.trim();
    if (!value) return;
    const next = [{ id: crypto.randomUUID(), name: value }, ...lists];
    setLists(next);
    writeLists(next);
    setName("");
  }

  function deleteList(id: string) {
    const next = lists.filter((item) => item.id !== id);
    setLists(next);
    writeLists(next);
  }

  return (
    <AppShell active="Lists">
      <div className="w-full max-w-3xl px-6 py-8 text-white">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Lists</h1>
          <Link href="/feed" className="text-sm text-blue-400 hover:underline">
            Back to Feed
          </Link>
        </div>
        <form onSubmit={createList} className="mb-4 flex gap-2">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Create a list name"
            className="flex-1 rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
          >
            Add
          </button>
        </form>
        <div className="space-y-3">
          {lists.map((list) => (
            <article key={list.id} className="flex items-center justify-between rounded-xl border border-gray-800 bg-gray-900 p-4">
              <p className="text-sm text-gray-100">{list.name}</p>
              <button
                onClick={() => deleteList(list.id)}
                className="text-xs text-red-400 hover:underline"
              >
                Delete
              </button>
            </article>
          ))}
          {lists.length === 0 && <p className="text-gray-500">No lists yet.</p>}
        </div>
      </div>
    </AppShell>
  );
}
