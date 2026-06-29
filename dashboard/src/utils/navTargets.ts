// Navigation model for the Task 16 IA (4 primary destinations + Systems sub-sections). Pure mapping
// helpers so App.tsx's routing (initial view from the ?view= deep link, the navigate_view event, and
// the Overview cards) is testable and consistent. Legacy view values (the old 6-tab names) are mapped
// forward so existing deep links / the web `?view=account` portal keep working.

export type AppView = 'overview' | 'systems' | 'alerts' | 'settings' | 'account';
export type SystemsSection = 'water' | 'power' | 'flood';

export interface ViewTarget {
  view: AppView;
  /** Only meaningful when view === 'systems'. */
  section?: SystemsSection;
}

/**
 * Resolve a raw view string (from `?view=` or a navigate_view event) to a destination, mapping the
 * legacy 6-tab names forward. Returns null for an unknown/empty value (caller keeps its default).
 */
export function parseViewTarget(raw: string | null | undefined): ViewTarget | null {
  switch (raw) {
    case 'overview':
    case 'home':        return { view: 'overview' };
    case 'systems':
    case 'fresh_water': return { view: 'systems', section: 'water' };
    case 'high_water':  return { view: 'systems', section: 'flood' };
    case 'batteries':
    case 'shore_power': return { view: 'systems', section: 'power' };
    case 'alerts':      return { view: 'alerts' };
    case 'settings':    return { view: 'settings' };
    case 'account':     return { view: 'account' };
    default:            return null;
  }
}

/** Map an Overview category card (Home's CatKey) to its Systems section. */
export function sectionForCategory(cat: string): SystemsSection {
  if (cat === 'high_water') return 'flood';
  if (cat === 'fresh_water') return 'water';
  return 'power'; // batteries + shore_power
}
