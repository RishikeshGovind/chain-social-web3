// app/api/lens/feed/route.ts

import { NextResponse } from "next/server";

export async function GET() {
  // Mock static posts for demo purposes
  const posts = [
    {
      id: "1",
      timestamp: new Date().toISOString(),
      metadata: { content: "Hello, world! This is a demo post." },
      author: {
        username: { localName: "alice" },
        address: "0x1234567890abcdef"
      }
    },
    {
      id: "2",
      timestamp: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
      metadata: { content: "Welcome to your new social feed!" },
      author: {
        username: { localName: "bob" },
        address: "0xfedcba0987654321"
      }
    },
    {
      id: "3",
      timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
      metadata: { content: "Just setting up my ChainSocial account!" },
      author: {
        username: { localName: "charlie" },
        address: "0xaaaabbbbccccdddd"
      }
    },
    {
      id: "4",
      timestamp: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
      metadata: { content: "Web3 is the future 🚀" },
      author: {
        username: { localName: "diana" },
        address: "0x1111222233334444"
      }
    },
    {
      id: "5",
      timestamp: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(),
      metadata: { content: "Follow me for more updates!" },
      author: {
        username: { localName: "eve" },
        address: "0x5555666677778888"
      }
    }
  ];
  return NextResponse.json({ posts });
}
