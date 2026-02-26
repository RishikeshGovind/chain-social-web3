import axios from "axios";

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
  const pinataJwt = process.env.PINATA_JWT || process.env.NEXT_PUBLIC_PINATA_JWT;
  const web3StorageKey = process.env.WEB3_STORAGE_TOKEN || process.env.NEXT_PUBLIC_WEB3_STORAGE_TOKEN;

  // Try Pinata first (if API key available)
  if (pinataJwt) {
    const pinataResult = await uploadToPinata(file, pinataJwt);
    if (pinataResult) {
      console.log("[IPFS] Uploaded to Pinata:", pinataResult);
      return ipfsToHttp(pinataResult);
    }
  }

  // Try Web3.Storage next
  if (web3StorageKey) {
    const web3Result = await uploadToWeb3Storage(file, web3StorageKey);
    if (web3Result) {
      console.log("[IPFS] Uploaded to Web3.Storage:", web3Result);
      return ipfsToHttp(web3Result);
    }
  }

  // Try NFT.Storage (free)
  const nftStorageResult = await uploadToNFTStorage(file);
  if (nftStorageResult) {
    console.log("[IPFS] Uploaded to NFT.Storage:", nftStorageResult);
    return ipfsToHttp(nftStorageResult);
  }

  // Fallback to data URI (works locally but may not work with Lens)
  console.warn("[IPFS] All IPFS providers failed, using data URI fallback");
  const dataUri = await createDataUri(file);
  return dataUri;
}

// Convert IPFS URI to HTTP gateway URL
export function ipfsToHttp(uri: string): string {
  if (uri.startsWith("ipfs://")) {
    const cid = uri.replace("ipfs://", "");
    return `${IPFS_GATEWAYS[0]}${cid}`;
  }
  if (uri.startsWith("ar://")) {
    const path = uri.replace("ar://", "");
    return `https://arweave.net/${path}`;
  }
  return uri;
}
