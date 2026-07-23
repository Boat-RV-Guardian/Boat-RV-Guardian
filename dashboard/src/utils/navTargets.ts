// Navigation model (owner restructure 2026-07-22): THREE primary destinations — Systems / Alerts /
// Settings — with the old "Overview" page now the FIRST sub-page of Systems, renamed "Dashboard".
// Pure mapping helpers so App.tsx's routing (initial view from the ?view= deep link, the
// navigate_view event, and the Dashboard cards) is testable and consistent. Legacy view values
// (the old tab names, incl. 'overview'/'home') are mapped forward so existing deep links / the web
// `?view=account` portal keep working.

export type AppView = 'systems' | 'alerts' | 'settings' | 'account';
export type SystemsSection = 'dashboard' | 'water' | 'power' | 'flood' | 'environment';

export interface ViewTarget {
  view: AppView;
  /** Only meaningful when view === 'systems'. */
  section?: SystemsSection;
}

/**
 * Resolve a raw view string (from `?view=` or a navigate_view event) to a destination, mapping the
 * legacy names forward. Returns null for an unknown/empty value (caller keeps its default).
 */
export function parseViewTarget(raw: string | null | undefined): ViewTarget | null {
  switch (raw) {
    case 'overview':      // legacy primary tab → now the Dashboard sub-page of Systems
    case 'home':
    case 'dashboard':
    case 'systems':     return { view: 'systems', section: 'dashboard' };
    case 'fresh_water': return { view: 'systems', section: 'water' };
    case 'high_water':  return { view: 'systems', section: 'flood' };
    case 'batteries':
    case 'shore_power': return { view: 'systems', section: 'power' };
    case 'environment': return { view: 'systems', section: 'environment' };
    case 'alerts':      return { view: 'alerts' };
    case 'settings':    return { view: 'settings' };
    case 'account':     return { view: 'account' };
    default:            return null;
  }
}

/** Map a Dashboard category card (Home's CatKey) to its Systems section. */
export function sectionForCategory(cat: string): SystemsSection {
  if (cat === 'high_water') return 'flood';
  if (cat === 'fresh_water') return 'water';
  if (cat === 'environment') return 'environment';
  return 'power'; // batteries + shore_power
}
