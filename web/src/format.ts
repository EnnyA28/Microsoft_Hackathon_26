// Small display formatters shared across components.

export const fmtInt = (n: number) => Math.round(n).toLocaleString();

export const fmtMoney = (n: number) => {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${Math.round(n)}`;
};

export const fmtEnergy = (kwh: number) => {
  if (kwh >= 1_000_000) return `${(kwh / 1_000_000).toFixed(1)} GWh`;
  if (kwh >= 1_000) return `${(kwh / 1_000).toFixed(0)} MWh`;
  return `${Math.round(kwh)} kWh`;
};

export const fmtWater = (liters: number) => {
  if (liters >= 1_000_000) return `${(liters / 1_000_000).toFixed(1)} ML`;
  if (liters >= 1_000) return `${(liters / 1_000).toFixed(0)} kL`;
  return `${Math.round(liters)} L`;
};

export const fmtTonnes = (t: number) => `${Math.round(t).toLocaleString()} t`;
