/**
 * Motion Design Tokens — based on Impeccable motion-design principles.
 *
 * Rules:
 * - Only animate `transform` and `opacity`
 * - Use exponential easing (ease-out-expo), never bounce/elastic
 * - Exit animations = 75% of enter duration
 * - Respect `prefers-reduced-motion` (handled in CSS)
 *
 * SSOT: src/index.css (--duration-*, --ease-*). These JS values mirror those
 * CSS tokens for framer-motion, which cannot read CSS custom properties as
 * numeric transition values. Durations are in SECONDS (framer's unit) and equal
 * the CSS ms tokens (0.2s == --duration-fast 200ms). Change BOTH places together.
 */

import type { BezierDefinition } from "framer-motion";

/* ── Durations (100/300/500 rule) ── */
export const DURATION = {
  /** Instant feedback: button press, toggle, color change */
  instant: 0.1,
  /** State changes: menu open, tooltip, hover */
  fast: 0.2,
  /** Layout changes: accordion, modal, drawer */
  base: 0.3,
  /** Entrance animations: page load, card reveals */
  slow: 0.5,
  /** Ambient effects: scan lines, background loops */
  ambient: 8,
} as const;

/* ── Easing curves (exponential, no bounce) ── */
export const EASE: Record<"out" | "in" | "inOut", BezierDefinition> = {
  /** Elements entering — smooth deceleration (default) */
  out: [0.16, 1, 0.3, 1],
  /** Elements leaving — smooth acceleration */
  in: [0.7, 0, 0.84, 0],
  /** State toggles — symmetric */
  inOut: [0.65, 0, 0.35, 1],
};

