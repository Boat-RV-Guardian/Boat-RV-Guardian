import { useState, useEffect } from 'react';
import { isMobileWidth } from '../utils/viewport';

// True when the viewport is at/below the mobile breakpoint. Drives the responsive primary nav
// (top row on desktop, bottom tab bar on mobile — Task 16 IA).
export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(() => (typeof window !== 'undefined' ? isMobileWidth(window.innerWidth) : false));
  useEffect(() => {
    const onResize = () => setMobile(isMobileWidth(window.innerWidth));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return mobile;
}
