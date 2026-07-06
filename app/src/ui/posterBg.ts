/** Deterministic hue from a string, for poster gradients. */
export function hueOf(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h);
  return Math.abs(h) % 360;
}

/** Gradient stand-in for titles without poster art. */
export function posterBg(title: string): string {
  const h = hueOf(title);
  const h2 = (h + 42) % 360;
  return `linear-gradient(155deg, hsl(${h} 46% 30%), hsl(${h2} 58% 15%))`;
}
