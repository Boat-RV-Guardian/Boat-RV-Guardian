// Viewport breakpoint for the responsive nav (Task 16 IA). On mobile (Capacitor / narrow screens) the
// 4-item primary nav renders as a bottom tab bar; on desktop (Tauri / wide) it stays a top row. Pure
// breakpoint test so the decision is testable; the hook (useIsMobile) wraps it with a resize listener.

export const MOBILE_BREAKPOINT = 640;

export function isMobileWidth(width: number): boolean {
  return width <= MOBILE_BREAKPOINT;
}
