'use strict';
// 1.99.2 NetEventPro's own line icons (24 × 24, drawn with the current text colour, so they follow every theme).
// TILE: icons for dashboard tiles (a thermometer on a temperature tile ...). VIS: small pictures of the visuals in the tile editor.
(() => {
  const P = (d) => d;   // paths below: stroke only, round caps
  const TILE = {
    thermometer: ['Temperature', P('M14 14.8V5a2 2 0 1 0-4 0v9.8a4 4 0 1 0 4 0z M12 9v7')],
    snowflake: ['Cooling', P('M12 2v20 M4 7l16 10 M20 7L4 17 M9 3.5l3 2.5 3-2.5 M9 20.5l3-2.5 3 2.5')],
    flame: ['Heat', P('M12 22c4 0 7-2.7 7-6.8 0-3.6-2.6-5.8-4.2-8.7-.6 2-1.6 3.1-2.8 3.6.2-3-1.2-5.8-3.6-8.1.3 3.6-3.4 6.2-3.4 10.9C5 19.3 8 22 12 22z')],
    droplet: ['Humidity', P('M12 2.7l5.4 6.6A7 7 0 1 1 6.6 9.3z')],
    bolt: ['Power', P('M13 2L4 14h7l-1 8 9-12h-7z')],
    battery: ['Battery', P('M3 7h15a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z M22 10.5v3 M6 10v4 M10 10v4')],
    plug: ['Mains', P('M9 2v5 M15 2v5 M6 7h12v4a6 6 0 0 1-12 0z M12 17v5')],
    voltage: ['Voltage', P('M4 12h3l2-6 3 12 3-9 2 3h3')],
    current: ['Current', P('M3 12c2.5-6 5.5-6 9 0s6.5 6 9 0')],
    fan: ['Fan', P('M12 12m-1.6 0a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0 M12 10.4C11 6 13 3 16 3.5c2 .4 1.6 4.4-2.6 7.6 M13.4 12.8c4.3 1.6 5.8 4.7 4 6.7-1.4 1.5-4.6-.6-5.2-5.4 M10.6 12.6C7 15.6 3.7 15 3.4 12.4c-.2-2 3.8-3.2 7.4-.8')],
    cpu: ['Processor', P('M7 7h10v10H7z M10 10h4v4h-4z M9 3v4 M15 3v4 M9 17v4 M15 17v4 M3 9h4 M3 15h4 M17 9h4 M17 15h4')],
    memory: ['Memory', P('M3 7h18v9H3z M7 16v3 M11 16v3 M15 16v3 M7 10v3 M11 10v3 M15 10v3')],
    disk: ['Disk', P('M4 5h16v14H4z M4 14h16 M16 17h.01')],
    server: ['Server', P('M4 4h16v6H4z M4 14h16v6H4z M8 7h.01 M8 17h.01')],
    switch: ['Switch', P('M3 9h18v6H3z M6 12h.01 M9 12h.01 M12 12h.01 M15 12h.01 M18 12h.01')],
    router: ['Router', P('M3 14h18v5H3z M7 16.5h.01 M11 16.5h.01 M8 10a5.6 5.6 0 0 1 8 0 M5.5 7.5a9 9 0 0 1 13 0')],
    antenna: ['Radio', P('M12 12v10 M8.5 22h7 M9 9a4.2 4.2 0 0 1 6 0 M6.3 6.3a8 8 0 0 1 11.4 0 M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0')],
    satellite: ['Satellite', P('M13 7l4 4-6 6-4-4z M17 3l4 4-2.5 2.5-4-4z M7 13l-4 4 4 4 M4 22c.5-2.2 1.8-3.5 4-4')],
    signal: ['Signal', P('M4 20v-3 M9 20v-7 M14 20v-11 M19 20V4')],
    network: ['Network', P('M12 3v5 M5 16v-3h14v3 M12 13V8 M9 3h6v5H9z M2 16h6v5H2z M16 16h6v5h-6z')],
    globe: ['Internet', P('M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z M3 12h18 M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z')],
    clock: ['Time', P('M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z M12 7v5l3.5 2')],
    bell: ['Alarm', P('M6 16V11a6 6 0 0 1 12 0v5l2 2H4z M10 21h4')],
    warning: ['Warning', P('M12 3l10 18H2z M12 10v5 M12 18h.01')],
    check: ['OK', P('M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z M8 12.5l2.7 2.7L16 9.8')],
    info: ['Information', P('M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z M12 11v6 M12 7.5h.01')],
    shield: ['Security', P('M12 3l8 3v6c0 4.6-3.3 8-8 9-4.7-1-8-4.4-8-9V6z')],
    lock: ['Lock', P('M6 11h12v10H6z M8.5 11V8a3.5 3.5 0 0 1 7 0v3')],
    pulse: ['Activity', P('M3 12h4l2.5-6 4 12L16 12h5')],
    gauge: ['Load', P('M4.5 18a8.5 8.5 0 1 1 15 0 M12 14l4-5 M12 14m-1.3 0a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0-2.6 0')],
    speed: ['Speed', P('M3 17h4 M2 12h7 M3 7h4 M12 6h6l3 6-3 6h-6z')],
    arrows: ['Traffic', P('M7 4v16 M3 8l4-4 4 4 M17 20V4 M13 16l4 4 4-4')],
    cloud: ['Cloud', P('M7 18a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 9a4.5 4.5 0 0 1-1 9z')],
    sun: ['Solar', P('M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8z M12 2v2 M12 20v2 M2 12h2 M20 12h2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4')],
    generator: ['Generator', P('M3 8h18v11H3z M6 8V5h5v3 M7 13h4 M15 11v5 M13 13.5h4')],
    door: ['Door', P('M6 3h12v18H6z M15 12h.01 M3 21h18')],
    phone: ['Phone', P('M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z')],
    user: ['People', P('M12 12a4 4 0 1 0 0-8a4 4 0 1 0 0 8z M4 21a8 8 0 0 1 16 0')],
    mail: ['E-mail', P('M3 6h18v12H3z M3 7l9 6 9-6')],
    chart: ['Chart', P('M4 4v16h16 M8 15l3-4 3 2 4-6')],
    list: ['List', P('M9 6h11 M9 12h11 M9 18h11 M4.5 6h.01 M4.5 12h.01 M4.5 18h.01')],
    tag: ['Tag', P('M3 12V4h8l10 10-8 8z M7.5 8h.01')],
    location: ['Site', P('M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z M12 7.5a2 2 0 1 0 0 4a2 2 0 1 0 0-4z')]
  };
  const VIS = {
    kpi: 'M5 8l2-1v10 M10.5 8.5a2 2 0 0 1 3.5 1.3c0 2-3.6 4.4-3.6 7.2h4 M17 7.5h3l-1.6 3a2.4 2.4 0 1 1-1.6 4.2',
    statspark: 'M4 6h7 M4 9h4 M3 19l4-4 3 2 4-5 3 2 4-5',
    gauge: 'M4.5 17a8 8 0 1 1 15 0 M12 13l3.5-4',
    bargauge: 'M3 6h14 M3 12h18 M3 18h9',
    line: 'M3 19h18 M4 15l4-5 4 3 4-6 4 3',
    trend: 'M3 20h18 M5 20v-6 M9 20v-9 M13 20v-4 M17 20v-11',
    bar: 'M3 5h12 M3 10h17 M3 15h8 M3 20h14',
    top: 'M3 5h18 M3 10h13 M3 15h9 M3 20h5',
    sevbars: 'M3 6h16 M3 12h11 M3 18h6',
    pie: 'M12 3a9 9 0 1 0 9 9h-9z M14 2.5A8.5 8.5 0 0 1 21.5 10H14z',
    radial: 'M12 4a8 8 0 1 1-8 8 M12 8a4 4 0 1 1-4 4',
    rose: 'M12 12L12 3a9 9 0 0 1 6.4 2.6z M12 12l6-1a6 6 0 0 1-1.8 4.2z M12 12l-3 5a6 6 0 0 1-3-4z',
    waffle: 'M4 4h4v4H4z M10 4h4v4h-4z M16 4h4v4h-4z M4 10h4v4H4z M10 10h4v4h-4z M4 16h4v4H4z',
    treemap: 'M3 3h18v18H3z M12 3v18 M12 11h9 M3 14h9 M16.5 11v10',
    table: 'M3 4h18v16H3z M3 9h18 M3 14h18 M9 4v16',
    latest: 'M8 6h13 M8 12h13 M8 18h13 M3.5 6h.01 M3.5 12h.01 M3.5 18h.01',
    heat: 'M4 4h4v4H4z M10 4h4v4h-4z M16 4h4v4h-4z M4 10h4v4H4z M10 10h4v4h-4z M16 10h4v4h-4z M4 16h4v4H4z M10 16h4v4h-4z M16 16h4v4h-4z',
    cloud: 'M4 9h7 M13 9h7 M6 14h12 M4 19h5 M11 19h9',
    bubble: 'M8 14a5 5 0 1 0 0 .1z M17 8a3 3 0 1 0 0 .1z M18 17a2 2 0 1 0 0 .1z',
    funnel: 'M3 4h18l-6 8v7l-6 2v-9z',
    podium: 'M9 9h6v12H9z M3 14h6v7H3z M15 12h6v9h-6z',
    poll: 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z'
  };
  const svg = (d, size = 18, extra = '') => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}><path d="${d}"/></svg>`;
  window.NEPIcons = {
    TILE, VIS, svg,
    tile: (name, size, extra) => (TILE[name] ? svg(TILE[name][1], size, extra) : ''),
    vis: (type, size) => svg(VIS[type] || VIS.kpi, size),
    list: () => Object.entries(TILE).map(([k, v]) => ({ k, label: v[0] }))
  };
})();
