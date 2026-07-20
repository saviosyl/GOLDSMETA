export const roundPrice = (price: number): number => Math.round(price * 100) / 100;

export const roundRatio = (ratio: number): number => Math.round(ratio * 100) / 100;

export const isPositivePrice = (price: number | null | undefined): price is number =>
  typeof price === "number" && Number.isFinite(price) && price > 0;
