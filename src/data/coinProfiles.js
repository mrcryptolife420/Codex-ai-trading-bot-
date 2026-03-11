export const coinProfiles = {
  BTCUSDT: { cluster: "majors", sector: "store_of_value", betaGroup: "btc" },
  ETHUSDT: { cluster: "majors", sector: "smart_contracts", betaGroup: "eth" },
  BNBUSDT: { cluster: "exchange", sector: "exchange", betaGroup: "exchange" },
  SOLUSDT: { cluster: "layer1", sector: "smart_contracts", betaGroup: "alt_l1" },
  XRPUSDT: { cluster: "payments", sector: "payments", betaGroup: "payments" },
  ADAUSDT: { cluster: "layer1", sector: "smart_contracts", betaGroup: "alt_l1" },
  LINKUSDT: { cluster: "infrastructure", sector: "oracle", betaGroup: "infra" },
  AVAXUSDT: { cluster: "layer1", sector: "smart_contracts", betaGroup: "alt_l1" },
  DOGEUSDT: { cluster: "meme", sector: "meme", betaGroup: "meme" },
  TRXUSDT: { cluster: "payments", sector: "payments", betaGroup: "payments" },
  LTCUSDT: { cluster: "payments", sector: "payments", betaGroup: "payments" },
  DOTUSDT: { cluster: "layer0", sector: "smart_contracts", betaGroup: "infra" },
  UNIUSDT: { cluster: "defi", sector: "dex", betaGroup: "defi" },
  AAVEUSDT: { cluster: "defi", sector: "lending", betaGroup: "defi" },
  NEARUSDT: { cluster: "layer1", sector: "smart_contracts", betaGroup: "alt_l1" },
  SUIUSDT: { cluster: "layer1", sector: "smart_contracts", betaGroup: "alt_l1" },
  APTUSDT: { cluster: "layer1", sector: "smart_contracts", betaGroup: "alt_l1" },
  BCHUSDT: { cluster: "payments", sector: "payments", betaGroup: "payments" }
};

export function getCoinProfile(symbol) {
  return coinProfiles[symbol] || {
    cluster: "other",
    sector: "other",
    betaGroup: "other"
  };
}
