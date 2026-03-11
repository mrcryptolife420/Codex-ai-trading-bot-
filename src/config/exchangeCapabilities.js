function normalizeRegion(value) {
  return `${value || "GLOBAL"}`.trim().toUpperCase();
}

function asSet(values = []) {
  return new Set((Array.isArray(values) ? values : []).map((value) => `${value}`.trim().toLowerCase()).filter(Boolean));
}

export function resolveExchangeCapabilities(config = {}) {
  const region = normalizeRegion(config.userRegion || "GLOBAL");
  const enabledOverrides = asSet(config.exchangeCapabilitiesEnabled || []);
  const disabledOverrides = asSet(config.exchangeCapabilitiesDisabled || []);
  const capabilities = {
    region,
    venue: "binance",
    spotEnabled: true,
    convertEnabled: true,
    cardEnabled: ["BE", "FR", "DE", "IT", "NL", "ES", "PT", "PL"].includes(region),
    simpleEarnEnabled: false,
    marginEnabled: false,
    futuresEnabled: false,
    shortingEnabled: false,
    leveragedTokensEnabled: false,
    spotBearMarketMode: "defensive_rebounds",
    conservativeByRegion: region === "BE",
    notes: []
  };

  if (region === "BE") {
    capabilities.notes.push(
      "Belgium profile keeps Binance automation spot-first by default.",
      "Derivatives, margin and shorting stay disabled unless account capabilities are explicitly overridden."
    );
  } else {
    capabilities.notes.push("Global profile keeps conservative account capabilities until you explicitly enable extra products.");
  }

  const capabilityMap = {
    spot: "spotEnabled",
    convert: "convertEnabled",
    card: "cardEnabled",
    earn: "simpleEarnEnabled",
    simple_earn: "simpleEarnEnabled",
    margin: "marginEnabled",
    futures: "futuresEnabled",
    shorting: "shortingEnabled",
    leveraged_tokens: "leveragedTokensEnabled"
  };

  for (const [capability, field] of Object.entries(capabilityMap)) {
    if (enabledOverrides.has(capability)) {
      capabilities[field] = true;
    }
    if (disabledOverrides.has(capability)) {
      capabilities[field] = false;
    }
  }

  capabilities.shortingEnabled = Boolean(
    capabilities.shortingEnabled ||
    capabilities.marginEnabled ||
    capabilities.futuresEnabled ||
    capabilities.leveragedTokensEnabled
  );

  return {
    ...capabilities,
    notes: [...new Set(capabilities.notes)]
  };
}
