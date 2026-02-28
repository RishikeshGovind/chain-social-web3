"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import AppShell from "@/components/AppShell";

type XmptMessage = {
  id: string;
  content: string;
  senderAddress: string;
  sentAt: string;
};

type XmtpConversation = {
  messages: () => Promise<unknown[]>;
  send: (content: string) => Promise<unknown>;
};

type XmtpClient = {
  canMessage: (address: string) => Promise<boolean>;
  conversations: {
    newConversation: (address: string) => Promise<XmtpConversation>;
  };
};

type XmtpModule = {
  Client: {
    create: (signer: unknown, options: { env: string }) => Promise<XmtpClient>;
  };
};

type EthersModule = {
  ethers: {
    providers: {
      Web3Provider: new (provider: unknown) => {
        getSigner: () => unknown;
      };
    };
  };
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function isAddress(value: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function shortenAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

async function importPackage(name: string): Promise<Record<string, unknown>> {
  const importer = new Function("moduleName", "return import(moduleName)") as (
    moduleName: string
  ) => Promise<Record<string, unknown>>;
  return importer(name);
}

export default function MessagesPage() {
  const { authenticated, user } = usePrivy();
  const { wallets } = useWallets();

  const [peerAddress, setPeerAddress] = useState("");
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<string>("Connect wallet to start encrypted chat.");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<XmptMessage[]>([]);
  const [xmtpClient, setXmtpClient] = useState<XmtpClient | null>(null);
  const [conversation, setConversation] = useState<XmtpConversation | null>(null);

  const viewerAddress = useMemo(
    () => user?.wallet?.address?.toLowerCase() ?? "",
    [user?.wallet?.address]
  );

  async function getSigner(): Promise<unknown> {
    const wallet = wallets.find(
      (item) => item.address?.toLowerCase() === user?.wallet?.address?.toLowerCase()
    );
    if (!wallet) {
      throw new Error("No connected wallet found in Privy.");
    }
    const ethProvider = await wallet.getEthereumProvider();
    const ethersPkg = (await importPackage("ethers")) as unknown as EthersModule;
    const provider = new ethersPkg.ethers.providers.Web3Provider(ethProvider);
    return provider.getSigner();
  }

  function mapXmptMessages(items: unknown[]): XmptMessage[] {
    return items
      .map((item) => ({
        id: String(asRecord(item).id ?? crypto.randomUUID()),
        content: String(asRecord(item).content ?? ""),
        senderAddress: String(asRecord(item).senderAddress ?? ""),
        sentAt: String(
          asRecord(item).sent ?? asRecord(item).sentAt ?? new Date().toISOString()
        ),
      }))
      .sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  }

  async function connectConversation() {
    setError(null);
    const target = peerAddress.trim();
    if (!isAddress(target)) {
      setError("Enter a valid recipient wallet address (0x...).");
      return;
    }
    if (!authenticated || !user?.wallet?.address) {
      setError("Please connect wallet first.");
      return;
    }

    setBusy(true);
    try {
      setStatus("Connecting to XMTP...");
      const { Client } = (await importPackage("@xmtp/xmtp-js")) as unknown as XmtpModule;
      const signer = await getSigner();
      const client =
        xmtpClient ??
        (await Client.create(signer, {
          env: process.env.NEXT_PUBLIC_XMTP_ENV || "production",
        }));
      setXmtpClient(client);

      const canMessage = await client.canMessage(target);
      if (!canMessage) {
        throw new Error(
          "Recipient is not reachable on XMTP yet. They need to enable XMTP with their wallet."
        );
      }

      const convo = await client.conversations.newConversation(target);
      setConversation(convo);
      const history = await convo.messages();
      setMessages(mapXmptMessages(history));
      setStatus(`Encrypted chat with ${shortenAddress(target)} ready.`);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to connect XMTP.";
      if (
        message.includes("Cannot find module") ||
        message.includes("Failed to resolve module")
      ) {
        setError(
          "XMTP packages are not installed. Run: npm install @xmtp/xmtp-js ethers@5"
        );
      } else {
        setError(message);
      }
      setStatus("Unable to start XMTP conversation.");
    } finally {
      setBusy(false);
    }
  }

  async function refreshMessages() {
    if (!conversation) return;
    setBusy(true);
    try {
      const history = await conversation.messages();
      setMessages(mapXmptMessages(history));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to refresh messages.");
    } finally {
      setBusy(false);
    }
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    if (!conversation) {
      setError("Start a conversation first.");
      return;
    }
    const text = input.trim();
    if (!text) return;

    setBusy(true);
    setError(null);
    try {
      await conversation.send(text);
      setInput("");
      const history = await conversation.messages();
      setMessages(mapXmptMessages(history));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send message.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell active="Messages">
      <div className="w-full max-w-3xl px-6 py-8 text-white">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Messages</h1>
          <Link href="/feed" className="text-sm text-blue-400 hover:underline">
            Back to Feed
          </Link>
        </div>

        <div className="mb-4 rounded-xl border border-gray-800 bg-gray-900 p-4">
          <p className="mb-3 text-sm text-gray-300">{status}</p>
          <div className="flex gap-2">
            <input
              value={peerAddress}
              onChange={(event) => setPeerAddress(event.target.value)}
              placeholder="Recipient wallet address (0x...)"
              className="flex-1 rounded border border-gray-700 bg-black px-3 py-2 text-sm"
            />
            <button
              onClick={() => void connectConversation()}
              disabled={busy}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
            >
              Connect
            </button>
            <button
              onClick={() => void refreshMessages()}
              disabled={busy || !conversation}
              className="rounded border border-gray-700 px-4 py-2 text-sm text-gray-200 hover:bg-gray-800 disabled:opacity-50"
            >
              Refresh
            </button>
          </div>
          {viewerAddress && (
            <p className="mt-2 text-xs text-gray-500">
              Connected as {shortenAddress(viewerAddress)}
            </p>
          )}
        </div>

        {error && (
          <div className="mb-4 rounded border border-red-800 bg-red-950 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        <form onSubmit={sendMessage} className="mb-4 flex gap-2">
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Type an encrypted message"
            className="flex-1 rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm"
            disabled={!conversation || busy}
          />
          <button
            type="submit"
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            disabled={!conversation || busy}
          >
            Send
          </button>
        </form>

        <div className="space-y-3">
          {messages.map((message) => {
            const mine = message.senderAddress.toLowerCase() === viewerAddress;
            return (
              <article
                key={message.id}
                className={`rounded-xl border p-4 ${
                  mine ? "border-blue-700 bg-blue-950/30" : "border-gray-800 bg-gray-900"
                }`}
              >
                <p className="mb-1 text-xs text-gray-400">
                  {mine ? "You" : shortenAddress(message.senderAddress)}
                </p>
                <p className="whitespace-pre-wrap break-words text-sm text-gray-100">
                  {message.content}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  {new Date(message.sentAt).toLocaleString()}
                </p>
              </article>
            );
          })}
          {messages.length === 0 && (
            <p className="text-gray-500">
              No messages yet. Connect to a wallet address and start chatting.
            </p>
          )}
        </div>
      </div>
    </AppShell>
  );
}
