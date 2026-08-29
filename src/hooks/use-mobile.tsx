import * as React from "react";

// Where the sidebar stops being a fixed rail and becomes a drawer.
//
// 1024, not 768: product.md section 4.3 groups tablet WITH mobile ("Navigation
// opens as a sheet or drawer", and UX-009 expects drawers at 768-1023px). At
// 768 the rail took 256 of the 768 available pixels and the header could not
// compress into the remaining 512, so every single page scrolled horizontally
// on a portrait tablet — which UX-009/UX-010 forbid outright.
//
// Keep this in sync with the `lg:` prefixes in components/ui/sidebar.tsx: the
// CSS and this hook must agree on where the rail appears, or a tablet gets
// both a drawer and a rail.
const MOBILE_BREAKPOINT = 1024;

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return !!isMobile;
}
