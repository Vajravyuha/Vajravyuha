import React from 'react';
const paths = {
  shield: <><path d="M12 3 19 6v5c0 4.7-2.8 8-7 10-4.2-2-7-5.3-7-10V6l7-3Z"/><path d="m9 12 2 2 4-4"/></>,
  copy: <><rect x="8" y="8" width="11" height="12" rx="1"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h3"/></>,
  refresh: <><path d="M20 7v5h-5"/><path d="M19 12a7 7 0 1 1-2-5l3 5"/></>,
  external: <><path d="M14 4h6v6"/><path d="m20 4-9 9"/><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"/></>,
  chevron: <path d="m8 10 4 4 4-4"/>,
  stop: <rect x="6" y="6" width="12" height="12" rx="1"/>,
  plus: <><path d="M12 5v14"/><path d="M5 12h14"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
};
export function Icon({ name, size = 16, className = '' }) { return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>; }
