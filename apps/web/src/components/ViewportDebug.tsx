import { useEffect, useState } from 'react';

/** TEMPORARY: live viewport numbers for debugging the Create sheet on phones.
 *  Shown only with ?vv in the URL. Delete once the sheet is fixed. */
export function ViewportDebug() {
  const [, tick] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    const on = () => tick((n) => n + 1);
    vv?.addEventListener('resize', on);
    vv?.addEventListener('scroll', on);
    window.addEventListener('resize', on);
    window.addEventListener('scroll', on);
    const id = window.setInterval(on, 250);
    return () => {
      vv?.removeEventListener('resize', on);
      vv?.removeEventListener('scroll', on);
      window.removeEventListener('resize', on);
      window.removeEventListener('scroll', on);
      window.clearInterval(id);
    };
  }, []);

  const vv = window.visualViewport;
  const rect = (sel: string) => {
    const r = document.querySelector(sel)?.getBoundingClientRect();
    return r ? `${Math.round(r.top)}–${Math.round(r.bottom)}` : '—';
  };
  const rows: [string, string | number][] = [
    ['inner', `${window.innerWidth}×${window.innerHeight}`],
    ['client', document.documentElement.clientHeight],
    ['vv h', vv ? Math.round(vv.height) : '—'],
    ['vv top', vv ? Math.round(vv.offsetTop) : '—'],
    ['scrollY', Math.round(window.scrollY)],
    ['sheet', rect('.sheet')],
    ['card', rect('.sheet__card')],
    ['ua', /iPhone|iPad/.test(navigator.userAgent) ? 'iOS' : /Android/.test(navigator.userAgent) ? 'Android' : 'other'],
  ];

  return (
    <div
      style={{
        position: 'fixed', top: 8, left: 8, zIndex: 1000, pointerEvents: 'none',
        background: 'rgba(0,0,0,.8)', color: '#0f0', font: '11px/1.35 ui-monospace, monospace',
        padding: '6px 8px', borderRadius: 6, whiteSpace: 'pre',
      }}
    >
      {rows.map(([k, v]) => `${k.padEnd(8)}${v}`).join('\n')}
    </div>
  );
}
