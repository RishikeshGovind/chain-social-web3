import axios from "axios";

// Pinata public pinning endpoint (for demo; production should use API keys)
const PINATA_PIN_URL = "https://api.pinata.cloud/pinning/pinFileToIPFS";

export async function uploadToIPFS(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);

  // For demo, use Pinata's public endpoint (replace with your own API key for production)
  const res = await axios.post(PINATA_PIN_URL, formData, {
    headers: {
      "Content-Type": "multipart/form-data",
      // 'Authorization': 'Bearer <your_pinata_jwt>' // Add if using API key
    },
  });

  // Returns IPFS hash
  return `https://gateway.pinata.cloud/ipfs/${res.data.IpfsHash}`;
}
