"use client";

import { useEffect, useState } from "react";

type Post = {
  id: string;
  timestamp: string;
  metadata?: {
    content?: string;
  };
  author: {
    username?: {
      localName?: string;
    };
    address: string;
  };
};
export default function FeedPage() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const pageSize = 3;

  // Toggle this to false to use a real backend later
  const USE_MOCK_FEED = true;

  useEffect(() => {
    if (USE_MOCK_FEED) {
      fetchMockFeed();
    } else {
      fetchRealFeed();
    }
  }, []);

  async function fetchMockFeed() {
    try {
      const res = await fetch("/api/lens/feed");
      const data = await res.json();
      setPosts(data.posts || []);
    } catch (error) {
      console.error("Failed to load mock feed");
    } finally {
      setLoading(false);
    }
  }

  async function fetchRealFeed() {
    // Example: fetch from a real backend or protocol
    // const res = await fetch("https://your-backend.com/api/feed");
    // const data = await res.json();
    // setPosts(data.posts || []);
    setLoading(false);
  }

  // Pagination logic
  const totalPages = Math.ceil(posts.length / pageSize);
  const paginatedPosts = posts.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="min-h-screen bg-black text-white p-6">
      <div className="max-w-2xl mx-auto">
        <h2 className="text-2xl font-semibold mb-6">Global Feed</h2>

        {loading && <p className="text-gray-400">Loading...</p>}

        {!loading && posts.length === 0 && (
          <p className="text-gray-500">No posts found.</p>
        )}

        <div className="space-y-4">
          {paginatedPosts.map((post) => (
            <div
              key={post.id}
              className="border border-gray-800 bg-gray-900 rounded-xl p-4 flex gap-4 items-start transition-shadow hover:shadow-lg hover:border-blue-500"
            >
              {/* Avatar */}
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center text-lg font-bold text-white">
                {post.author.username?.localName?.[0]?.toUpperCase() || "?"}
              </div>
              {/* Post content */}
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold text-white">
                    {post.author.username?.localName || shortenAddress(post.author.address)}
                  </span>
                  <span className="text-xs text-gray-500">
                    {shortenAddress(post.author.address)}
                  </span>
                </div>
                <div className="text-white mb-2 whitespace-pre-wrap">
                  {post.metadata?.content || ""}
                </div>
                <div className="text-xs text-gray-500">
                  {new Date(post.timestamp).toLocaleString()}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Pagination controls */}
        {totalPages > 1 && (
          <div className="flex justify-center gap-4 mt-8">
            <button
              className="px-4 py-2 rounded bg-gray-800 text-white disabled:opacity-50"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              Previous
            </button>
            <span className="text-gray-400">Page {page} of {totalPages}</span>
            <button
              className="px-4 py-2 rounded bg-gray-800 text-white disabled:opacity-50"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function shortenAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
