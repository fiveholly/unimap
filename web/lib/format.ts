export function timeAgo(seconds: number): string {
  const d = Math.max(0, Date.now() / 1000 - seconds);
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  if (d < 86400 * 30) return `${Math.floor(d / 86400)}d`;
  return new Date(seconds * 1000).toLocaleDateString();
}

export function btc(sats: number): string {
  return `${(sats / 1e8).toLocaleString(undefined, { maximumFractionDigits: 8 })} BTC`;
}

// Blocks everyone knows. Zoning beyond this waits for mainnet statistics (see the MVP plan).
export const LANDMARKS: Record<number, string> = {
  0: "Genesis block",
  57043: "Bitcoin Pizza",
  210000: "First halving",
  420000: "Second halving",
  481824: "SegWit activation",
  630000: "Third halving",
  709632: "Taproot activation",
  767430: "First inscription",
  840000: "Fourth halving",
};

export function epochName(height: number): string {
  const epoch = Math.floor(height / 210000);
  return epoch === 0 ? "Old Town (epoch 0)" : `Epoch ${epoch}`;
}
