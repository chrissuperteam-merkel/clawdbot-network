/**
 * Stealth Scoring — Calculate stealth score and dynamic pricing for nodes
 */
const config = require('../config');

const CONNECTION_SCORES = {
  mobile_5g: 100,
  mobile_4g: 90,
  mobile_3g: 70,
  wifi: 40,
  unknown: 20,
};

function calculateStealthScore(nodeInfo) {
  const connScore = CONNECTION_SCORES[nodeInfo.connectionType] || 20;
  
  let carrierBonus = 0;
  const carrier = (nodeInfo.carrier || '').toLowerCase();
  if (carrier && carrier !== 'wifi' && carrier !== 'unknown' && carrier !== '') {
    carrierBonus = 20;
  }

  // SIM bonus: if has real carrier on mobile connection, likely has SIM
  let simBonus = 0;
  if (carrierBonus > 0 && connScore >= 70) {
    simBonus = 10;
  }

  return Math.min(100, Math.max(0, connScore + carrierBonus + simBonus));
}

function getPricePerGB(stealthScore) {
  if (stealthScore >= 80) return config.PRICING_TIERS.premium;
  if (stealthScore >= 50) return config.PRICING_TIERS.residential;
  return config.PRICING_TIERS.basic;
}

function getPricingTier(stealthScore) {
  if (stealthScore >= 80) return 'premium';
  if (stealthScore >= 50) return 'residential';
  return 'basic';
}

module.exports = { calculateStealthScore, getPricePerGB, getPricingTier };
