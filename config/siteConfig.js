export const SITE_PROFILES = {
  testpan: {
    key: 'testpan',
    name: 'Testpan India',
    logo: '/logo.png',
    domains: ['testpanindia.com'],
    primaryContext: 'Testpan India corporate examination infrastructure, centre management, and customer support.'
  },
  bmtc: {
    key: 'bmtc',
    name: 'BookMyTestCenter',
    logo: '/logo2.png',
    domains: ['bookmytestcenter.com'],
    primaryContext: 'BookMyTestCenter (BMTC) portal services: sourcing, verifying, booking, and managing examination centres.'
  },
  manpower: {
    key: 'manpower',
    name: 'ManpowerX',
    logo: '/logo3.png',
    domains: ['manpowerx.co.in'],
    primaryContext: 'ManpowerX examination staffing: invigilators, administrative staff, technical support, security, and exam-day operations.'
  }
};

const SITE_ALIASES = {
  testpan: 'testpan',
  testpanindia: 'testpan',
  bmtc: 'bmtc',
  bookmytestcenter: 'bmtc',
  bookmytestcentre: 'bmtc',
  manpower: 'manpower',
  manpowerx: 'manpower',
  mpx: 'manpower'
};

export function normalizeSite(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  return SITE_ALIASES[normalized] || 'testpan';
}

export function getSiteProfile(value) {
  return SITE_PROFILES[normalizeSite(value)];
}
