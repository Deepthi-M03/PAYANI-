/**
 * Design tokens for JavaScript (motion timing, charts). Colours mirror src/index.css,
 * which is the source of truth for styling; a unit test keeps the two in step.
 */
export const palette = {
  navy: "#0B1F3A",
  primary: "#16335C",
  signal: "#2357B5",
  saffron: "#E8731A",
  ivory: "#F4F5F2",
  surface: "#FFFFFF",
  mist: "#E8EBEF",
  line: "#D5DAE1",
  steel: "#6B7480",
  muted: "#4A5562",
} as const;

export const status = {
  success: { fg: "#1E7A46", tint: "#E6F2EA" },
  warning: { fg: "#8A5A00", tint: "#FDF3DC" },
  error: { fg: "#C62828", tint: "#FBE9E9" },
  info: { fg: "#2357B5", tint: "#E8EFFA" },
} as const;

/** Motion tokens in seconds, for the `motion` library (app UI only). */
export const motionTokens = {
  duration: { instant: 0.12, fast: 0.2, base: 0.32, slow: 0.6 },
  ease: {
    ui: [0.2, 0, 0, 1] as const,
    exit: [0.4, 0, 1, 1] as const,
  },
  exitRatio: 0.7,
} as const;
