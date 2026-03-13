import axios from "axios";
import { logger } from "@/lib/server/logger";

// Multiple IPFS gateway options for reliability
const IPFS_GATEWAYS = [
  "https://ipfs.io/ipfs/",
  "https://cloudflare-ipfs.com/ipfs/",
  "https://gateway.pinata.cloud/ipfs/",
  "https://dweb.link/ipfs/",
];

// Try uploading to NFT.Storage (free, no API key required for small files)
// Fallback to Pinata if that fails
async function uploadToNFTStorage(file: File): Promise<string | null> {
  try {
    const formData = new FormData();
    formData.append("file", file);

    // NFT.Storage free upload endpoint
    const res = await axios.post("https://api.nft.storage/upload", formData, {
      headers: {
        "Content-Type": "multipart/form-data",
      },
      timeout: 30000,
    });

    if (res.data?.value?.cid) {
      return `ipfs://${res.data.value.cid}`;
    }
    return null;
  } catch {
    return null;
  }
}

// Web3.Storage free upload (requires API key but has free tier)
async function uploadToWeb3Storage(file: File, apiKey?: string): Promise<string | null> {
  if (!apiKey) return null;
  
  try {
    const formData = new FormData();
    formData.append("file", file);

    const res = await axios.post("https://api.web3.storage/upload", formData, {
      headers: {
        "Content-Type": "multipart/form-data",
        Authorization: `Bearer ${apiKey}`,
      },
      timeout: 30000,
    });

    if (res.data?.cid) {
      return `ipfs://${res.data.cid}`;
    }
    return null;
  } catch {
    return null;
  }
}

// Pinata upload (requires API key)
async function uploadToPinata(file: File, jwt?: string): Promise<string | null> {
  if (!jwt) return null;

  try {
    const formData = new FormData();
    formData.append("file", file);

    const res = await axios.post(
      "https://api.pinata.cloud/pinning/pinFileToIPFS",
      formData,
      {
        headers: {
          "Content-Type": "multipart/form-data",
          Authorization: `Bearer ${jwt}`,
        },
        timeout: 30000,
      }
    );

    if (res.data?.IpfsHash) {
      return `ipfs://${res.data.IpfsHash}`;
    }
    return null;
  } catch {
    return null;
  }
}

// Local fallback - store file as base64 data URI (works without external services)
function createDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result);
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export async function uploadToIPFS(file: File): Promise<string> {
  const pinataJwt = process.env.PINATA_JWT;
  const web3StorageKey = process.env.WEB3_STORAGE_TOKEN;

  // Try Pinata first (if API key available)
  if (pinataJwt) {
    const pinataResult = await uploadToPinata(file, pinataJwt);
    if (pinataResult) {
      logger.info("ipfs.upload.pinata", { provider: "pinata" });
      return ipfsToHttp(pinataResult);
    }
  }

  // Try Web3.Storage next
  if (web3StorageKey) {
    const web3Result = await uploadToWeb3Storage(file, web3StorageKey);
    if (web3Result) {
      logger.info("ipfs.upload.web3_storage", { provider: "web3.storage" });
      return ipfsToHttp(web3Result);
    }
  }

  // Try NFT.Storage (free)
  const nftStorageResult = await uploadToNFTStorage(file);
  if (nftStorageResult) {
    logger.info("ipfs.upload.nft_storage", { provider: "nft.storage" });
    return ipfsToHttp(nftStorageResult);
  }

  // Fallback to data URI (works locally but may not work with Lens)
  logger.warn("ipfs.upload.data_uri_fallback");
  const dataUri = await createDataUri(file);
  return dataUri;
}

// Validate IPFS CID format (CIDv0 or CIDv1, optionally with subpath)
function isValidCid(cid: string): boolean {
  const cidPart = cid.split("/")[0].split("?")[0];
  // CIDv0: base58btc, starts with Qm, 46 chars
  if (/^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(cidPart)) return true;
  // CIDv1: base32 lowercase, starts with b, or base36 starting with k
  if (/^b[a-z2-7]{58,}$/.test(cidPart)) return true;
  if (/^k[a-z0-9]{50,}$/.test(cidPart)) return true;
  // CIDv1 base58btc: starts with z
  if (/^z[1-9A-HJ-NP-Za-km-z]{46,}$/.test(cidPart)) return true;
  // Relaxed: alphanumeric CIDs from various IPFS implementations
  if (/^[a-zA-Z0-9]{46,}$/.test(cidPart)) return true;
  return false;
}

// Validate Arweave transaction ID (43-char base64url)
function isValidArweaveId(id: string): boolean {
  const txPart = id.split("/")[0].split("?")[0];
  return /^[a-zA-Z0-9_-]{43}$/.test(txPart);
}

// Convert IPFS URI to HTTP gateway URL
export function ipfsToHttp(uri: string): string {
  if (uri.startsWith("ipfs://")) {
    const cid = uri.replace("ipfs://", "");
    if (!isValidCid(cid)) {
      logger.warn("ipfs.invalid_cid", { cid: cid.slice(0, 80) });
      return uri;
    }
    return `${IPFS_GATEWAYS[0]}${cid}`;
  }
  if (uri.startsWith("ar://")) {
    const arId = uri.replace("ar://", "");
    if (!isValidArweaveId(arId)) {
      logger.warn("ipfs.invalid_arweave_id", { id: arId.slice(0, 80) });
      return uri;
    }
    return `https://arweave.net/${arId}`;
  }
  return uri;
}
