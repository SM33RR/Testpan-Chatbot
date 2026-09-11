// scripts/ingest.js
import FirecrawlApp from '@mendable/firecrawl-js';
import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

const firecrawl = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY });

// Website crawl configuration with depth settings
const WEBSITES = [
  {
    url: 'https://testpanindia.com',
    limit: 50,
    includeSubpages: true,
    description: 'Main Testpan India portal'
  },
  {
    url: 'https://bookmytestcenter.com',
    limit: 100,
    allowSubdomains: true,
    crawlEntireDomain: true,
    description: 'BookMyTestCenter platform, including client and centre subdomains'
  },
  {
    url: 'https://manpowerx.co.in',
    limit: 80,
    includePaths: ['/', '/about*', '/services*', '/solutions*', '/contact*'],
    description: 'ManpowerX - Partner site for manpower services'
  }
];

// Authentication pages are low-value for the assistant and often dominate a crawl.
// Firecrawl converts these path globs to regular expressions. A leading `*`
// becomes an invalid expression, so use root paths and their descendants.
const AUTH_EXCLUDE_PATHS = [
  '/login', '/login/*',
  '/signup', '/signup/*',
  '/register', '/register/*',
  '/auth', '/auth/*'
];

const SOCIAL_NETWORKS = {
  linkedin: /(^|\.)linkedin\.com$/i,
  facebook: /(^|\.)facebook\.com$/i,
  twitter: /(^|\.)(twitter\.com|x\.com)$/i,
  instagram: /(^|\.)instagram\.com$/i,
  youtube: /(^|\.)youtube\.com$/i
};

// These Testpan URLs are verified in the existing knowledge base. Distinct
// BMTC/ManpowerX URLs are intentionally discovered from their own footers rather
// than guessed, so the bot never presents an unrelated account as official.
const STATIC_SOCIAL_FALLBACK_DATA = [
  {
    site: 'Testpan India', url: 'https://testpanindia.com', source_domain: 'testpanindia.com',
    channels: {
      linkedin: 'https://www.linkedin.com/company/testpan-india-private-limited/',
      facebook: 'https://www.facebook.com/testpan',
      twitter: 'https://twitter.com/testpanindia',
      instagram: 'https://www.instagram.com/testpanindia/',
      youtube: 'https://www.youtube.com/@testpanindiaprivatelimited5851'
    }
  },
  { site: 'BookMyTestCenter', url: 'https://bookmytestcenter.com', source_domain: 'bookmytestcenter.com', channels: {} },
  { site: 'ManpowerX', url: 'https://manpowerx.co.in', source_domain: 'manpowerx.co.in', channels: {} }
];

function getFooterMarkup(markup, isHtml) {
  if (!markup) return '';
  if (isHtml) {
    return [...markup.matchAll(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi)].map(match => match[0]).join('\n');
  }
  const marker = markup.search(/(?:follow\s+us|social\s+media|connect\s+with\s+us|footer)/i);
  return marker >= 0 ? markup.slice(marker, marker + 4000) : '';
}

function extractSocialMediaLinks(markdown = '', html = '') {
  const footerMarkup = [getFooterMarkup(html, true), getFooterMarkup(markdown, false)].filter(Boolean).join('\n');
  const links = new Map();
  for (const match of footerMarkup.matchAll(/https?:\/\/[^\s"'<>\])]+/gi)) {
    try {
      const parsed = new URL(match[0].replace(/&amp;/g, '&').replace(/[.,;:]+$/, ''));
      const platform = Object.entries(SOCIAL_NETWORKS).find(([, matcher]) => matcher.test(parsed.hostname))?.[0];
      if (!platform || /(?:\/share|\/sharer|\/intent|\/hashtag|\/signup)/i.test(parsed.pathname)) continue;
      links.set(`${platform}:${parsed.href}`, { platform, url: parsed.href });
    } catch { /* Ignore malformed URLs without failing the crawl. */ }
  }
  return [...links.values()];
}

function addSocialMediaRecord(knowledgeData, { sourceUrl, sourceDomain, markdown, html }) {
  const socialLinks = extractSocialMediaLinks(markdown, html);
  if (!socialLinks.length) return;
  knowledgeData.push({
    url: `${sourceUrl.replace(/#.*$/, '')}#social-media`,
    title: 'Official social media links',
    content: `Official social media links extracted from the site footer:\n${socialLinks.map(link => `- ${link.platform}: ${link.url}`).join('\n')}`,
    source_domain: sourceDomain,
    social_links: socialLinks,
    page_depth: 0
  });
}

function injectStaticSocialFallback(knowledgeData) {
  STATIC_SOCIAL_FALLBACK_DATA.forEach(({ site, url, source_domain, channels }) => {
    const socialLinks = Object.entries(channels).map(([platform, link]) => ({ platform, url: link }));
    knowledgeData.push({
      url: `${url}#social-media-fallback`,
      title: `${site} - Official social media channels`,
      content: socialLinks.length
        ? `Verified official social media channels for ${site}:\n${socialLinks.map(link => `- ${link.platform}: ${link.url}`).join('\n')}`
        : `No independently verified official social-media profile URLs are configured for ${site}; use footer-extracted links when available.`,
      source_domain,
      social_links: socialLinks,
      is_fallback: true,
      page_depth: 0
    });
  });
}

/**
 * Static fallback data with detailed leadership and corporate information
 * Ensures knowledge base always contains core leadership and company metadata
 */
const STATIC_LEADERSHIP_DATA = [
  {
    title: "Testpan India - Leadership & Company Overview",
    url: "https://testpanindia.com/about/leadership",
    content: `Testpan India - Founded in 2016 by CEO and Founder Rajesh Setia

LEADERSHIP TEAM:

CEO & FOUNDER: Rajesh Setia
- Visionary leader and founder of Testpan India, established in 2016
- Drives strategic direction for technology-driven examination delivery and testing infrastructure
- Oversees all business units including test center management, ManpowerX staffing solutions, and BookMyTestCenter platform
- Committed to revolutionizing examination delivery in India through innovative CBT infrastructure

ORGANIZATIONAL STRUCTURE:
- Executive Leadership: Rajesh Setia (CEO & Founder) leads overall strategy and operations
- Management Team: Dedicated professionals managing technology, operations, staffing, and customer relations
- Directors: Oversight of specific business verticals - test centers, platforms, and staffing services

COMPANY MISSION:
Testpan India, under the leadership of Founder & CEO Rajesh Setia, aims to deliver world-class computer-based testing infrastructure, robust staffing solutions through ManpowerX, and seamless test center booking experiences through BookMyTestCenter portal.

KEY FACTS ABOUT THE LEADERSHIP:
- Founded by Rajesh Setia in 2016
- Leadership vision focused on scaling examination infrastructure across India
- Commitment to professionalism, security, and service excellence
- Pan-India operations with presence in metros and tier-2/3 cities

Source: Testpan India Corporate Information`
  },
  {
    title: "Testpan India - Corporate Profile",
    url: "https://testpanindia.com/company/profile",
    content: `TESTPAN INDIA - COMPREHENSIVE CORPORATE PROFILE

COMPANY NAME: Testpan India
FOUNDED: 2016
FOUNDER & CEO: Rajesh Setia
HEADQUARTERS: India (Pan-India Operations)
INDUSTRY: Examination & Testing Infrastructure, Staffing Solutions

CORPORATE OVERVIEW:
Testpan India, established by CEO Rajesh Setia in 2016, is a leading provider of end-to-end computer-based testing (CBT) infrastructure, examination center management, and specialized staffing solutions.

BUSINESS DIVISIONS:

1. TEST CENTER MANAGEMENT
   - Nationwide exam center setup and operations
   - Computer-based testing (CBT) infrastructure
   - Exam administration and proctoring
   - High-volume deployment capability (100+ centers simultaneously)
   - Security protocols and candidate management

2. BOOKMYTESTCENTER PLATFORM
   - Online exam center booking portal
   - Real-time availability and scheduling
   - Seamless candidate registration
   - Multiple examination support
   - Pan-India coverage
   - Website: https://www.bookmytestcenter.com

3. MANPOWERX STAFFING SOLUTIONS
   - Examination invigilators and proctors
   - Administrative and technical personnel
   - Security and facilities management staff
   - Quick deployment (48-72 hours)
   - Trained and verified workforce
   - Specialization in exam environment requirements

LEADERSHIP COMMITMENT:
Under the direction of Founder & CEO Rajesh Setia, Testpan India maintains highest standards of:
- Professionalism and integrity in examination delivery
- Security and confidentiality
- Technological innovation
- Customer service excellence
- Pan-India scalability

CONTACT & ENGAGEMENT:
- Main Phone: +91 98101 47334
- Email: info@testpanindia.com
- Website: https://testpanindia.com
- Booking Platform: https://www.bookmytestcenter.com

Source: Testpan India Corporate Database`
  }
];

// Kept independently of Firecrawl so the knowledge base still answers operational
// ManpowerX questions when a site is blocked, slow, or JavaScript-only.
const STATIC_FALLBACK_DATA = [
    {
      title: "ManpowerX - Manpower Services Overview",
      url: "https://manpowerx.co.in",
      content: `ManpowerX is a specialized manpower services provider partnering with Testpan India for examination support and staffing solutions.

KEY SERVICES:
- Trained Examination Invigilators: Professional proctors for computer-based exams with security clearance and exam administration training
- Administrative Staff: Event coordinators, registration desk personnel, and documentation support
- Technical Support Staff: IT professionals for lab setup, troubleshooting, and system monitoring during exams
- Security Personnel: Trained personnel for venue security, frisking, and crowd management
- Facilities Management: Housekeeping, catering coordination, and venue setup support

EXPERTISE:
- Pan-India deployment capability across major metros and tier-2/3 cities
- Experience with high-volume exam deployments (100+ simultaneous test centers)
- Compliance with exam security protocols and confidentiality requirements
- Quick turnaround staffing (48-72 hours)

CONTACT & PARTNERSHIPS:
To engage ManpowerX manpower services for your examination needs, connect with Testpan India:
- Phone: +91 98101 47334
- Email: info@testpanindia.com
- Website: https://testpanindia.com
- Booking Portal: https://www.bookmytestcenter.com`
    },
    {
      title: "ManpowerX - Staffing Solutions for Exams",
      url: "https://manpowerx.co.in/staffing",
      content: `ManpowerX provides comprehensive staffing solutions for examination centers and large-scale exam deployments.

STAFF CATEGORIES:
1. Invigilation Staff (Highest Priority for Exam Conduct)
   - Trained and certified exam proctors
   - Knowledge of exam protocols, cheating detection, and candidate management
   - Professional conduct and confidentiality agreements

2. Administrative Personnel
   - Registration and candidate check-in
   - Document verification and badge distribution
   - Post-exam candidate feedback and query resolution

3. Technical Specialists
   - Lab technicians for system setup and configuration
   - Network and connectivity monitoring during exams
   - Hardware troubleshooting and backup system activation
   - Exam software installation and credential management

4. Security & Logistics
   - Trained security personnel with frisking expertise
   - Entry/exit checkpoint management
   - Candidate flow and crowd management
   - Emergency procedures and incident reporting

WHY CHOOSE ManpowerX:
- Reliability: 99.2% on-time deployment rate
- Quality: All staff undergo background verification and exam-specific training
- Flexibility: Scalable staffing from single centers to multi-city deployments
- Speed: Rapid mobilization within 48-72 hours
- Cost-Effective: Competitive rates with transparent pricing

DEPLOYMENT PROCESS:
1. Share your examination requirements (date, location, center count, staff headcount by role)
2. ManpowerX provides staffing proposal and pricing
3. Pre-deployment briefing and security clearance
4. On-site staff deployment with exam-day support coordination
5. Post-exam debrief and performance feedback`
    },
    {
      title: "ManpowerX - Exam Deployment and Operational Support",
      url: "https://manpowerx.co.in/solutions",
      content: `ManpowerX supports exam operations from pre-exam planning through post-exam wrap-up.

OPERATIONAL SUPPORT:
- Role-wise manpower planning for invigilation, registration, administration, technical labs, security, and candidate flow
- Pre-exam briefing, duty allocation, and coordination with the examination delivery team
- Exam-day support for check-in, document verification, lab-floor assistance, incident escalation, and venue coordination
- Multi-city staffing for computer-based and large-scale examination deployments

ENGAGEMENT DETAILS:
Share the examination date, city or cities, shift schedule, centre count, expected candidate volume, and required roles. Testpan India and ManpowerX can then plan an appropriate deployment.

CONTACT:
Phone: +91 98101 47334
Email: info@testpanindia.com
Website: https://testpanindia.com`
    }
];

/**
 * Inject fallback ManpowerX content if Firecrawl fails
 * Ensures knowledge base has ManpowerX data even if web crawl fails
 */
function injectManpowerXFallback(knowledgeData) {

  // Add fallback pages to knowledge data
  STATIC_FALLBACK_DATA.forEach(item => {
    knowledgeData.push({
      url: item.url,
      title: item.title,
      content: item.content,
      source_domain: 'manpowerx.co.in',
      page_depth: 1,
      is_fallback: true // Mark as fallback data
    });
  });

  console.log(`   ✓ Injected ${STATIC_FALLBACK_DATA.length} fallback ManpowerX pages`);
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Firecrawl's free tier allows only 3 requests/minute. Parse the retry hint out
 * of a rate-limit error and wait it out instead of losing the whole crawl.
 */
async function crawlWithRetry(url, options, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await firecrawl.crawl(url, options);
    } catch (error) {
      const message = error?.message || '';
      const isRateLimit = /rate limit/i.test(message);
      if (!isRateLimit || attempt === attempts) {
        throw error;
      }
      const retryAfter = Number(message.match(/retry after (\d+)/i)?.[1]) || 60;
      console.log(`   ⏳ Rate limited, waiting ${retryAfter}s before retry ${attempt + 1}/${attempts}...`);
      await sleep((retryAfter + 2) * 1000);
    }
  }
}

async function updateKnowledgeBase() {
  console.log("Starting comprehensive website crawl for Testpan knowledge base...");
  let knowledgeData = [];
  let totalPages = 0;

  for (const website of WEBSITES) {
    const { url, limit, description, includePaths, allowSubdomains = false, crawlEntireDomain = false } = website;
    const pagesBeforeCrawl = knowledgeData.length;
    console.log(`\n📌 Crawling: ${url} (${description})`);
    console.log(`   Target pages: ${limit}, Deep crawl enabled`);
    
    try {
      // NOTE: excludePaths / allowSubdomains are crawl-level options in the v2 API.
      // Nesting them under scrapeOptions gets rejected as "Unrecognized key in body".
      const res = await crawlWithRetry(url, {
        limit, // Increased limit for deeper crawl
        excludePaths: [...AUTH_EXCLUDE_PATHS, '/privacy', '/terms', '/cookies'],
        ...(includePaths ? { includePaths } : {}),
        allowSubdomains,
        crawlEntireDomain,
        maxDiscoveryDepth: 3,
        scrapeOptions: {
          formats: ['markdown', 'html'],
          // Footer HTML contains the official social links we store separately.
          onlyMainContent: false
        }
      });

      if (res?.status === 'completed' && res.data?.length) {
        const pageCount = res.data.length;
        console.log(`   ✓ Crawled ${pageCount} pages from ${url}`);
        
        res.data.forEach((page, index) => {
          // Extract and clean content
          const sourceUrl = page.metadata?.sourceURL || url;
          const title = page.metadata?.title || `Page ${index + 1}`;
          const markdown = page.markdown || '';
          const html = page.html || '';
          const content = markdown || html;
          
          // Log each scraped page for debugging
          if (content.length > 100) {
            console.log(`     - Page ${index + 1}: "${title}" (${content.length} chars) from ${sourceUrl}`);
          }
          
          // Only add pages with meaningful content (>100 characters)
          if (content.length > 100) {
            knowledgeData.push({
              url: sourceUrl,
              title: title,
              content: content.trim(),
              source_domain: new URL(sourceUrl).hostname,
              page_depth: calculatePageDepth(sourceUrl, url)
            });
            addSocialMediaRecord(knowledgeData, {
              sourceUrl,
              sourceDomain: new URL(sourceUrl).hostname,
              markdown,
              html
            });
            totalPages++;
          }
        });

        if (url.includes('manpowerx') && knowledgeData.length === pagesBeforeCrawl) {
          console.log('   ⚠️  No usable ManpowerX pages returned; using static fallback content');
          injectManpowerXFallback(knowledgeData);
        }
      } else {
        console.log(`   ✗ Failed to crawl ${url}: ${res?.status || 'no pages returned'}`);
        
        // Fallback: Inject static ManpowerX content if crawl fails
        if (url.includes('manpowerx')) {
          console.log(`   ⚠️  Using fallback static content for ManpowerX`);
          injectManpowerXFallback(knowledgeData);
        }
      }
    } catch (error) {
      console.error(`   ✗ Error crawling ${url}:`, error.message);
      if (url.includes('manpowerx')) {
        console.log('   ⚠️  Using fallback static content for ManpowerX');
        injectManpowerXFallback(knowledgeData);
      }
    }

    // Stay under the 3 req/min free-tier limit
    if (website !== WEBSITES[WEBSITES.length - 1]) {
      console.log('   ⏸  Pausing 25s to respect rate limits...');
      await sleep(25000);
    }
  }

  injectStaticSocialFallback(knowledgeData);

  // Remove duplicates and sort by source domain (priority: manpowerx.co.in)
  const uniqueData = deduplicatePages(knowledgeData);
  const sortedData = uniqueData.sort((a, b) => {
    // Prioritize manpowerx.co.in content
    if (a.source_domain === 'manpowerx.co.in') return -1;
    if (b.source_domain === 'manpowerx.co.in') return 1;
    return 0;
  });

  const kbPath = path.resolve('knowledgeBase.json');
  await fs.writeFile(kbPath, JSON.stringify(sortedData, null, 2));
  console.log(`\n✅ Successfully updated knowledgeBase.json`);
  console.log(`   Total unique pages: ${sortedData.length}`);
  console.log(`   Pages by source:`);
  WEBSITES.forEach(site => {
    const count = sortedData.filter(p => p.source_domain === new URL(site.url).hostname).length;
    console.log(`   - ${site.description}: ${count} pages`);
  });
}

/**
 * Calculate page depth relative to root URL
 */
function calculatePageDepth(pageUrl, rootUrl) {
  try {
    const pageUrlObj = new URL(pageUrl);
    const rootUrlObj = new URL(rootUrl);
    const pathSegments = pageUrlObj.pathname.split('/').filter(s => s.length > 0);
    return pathSegments.length;
  } catch {
    return 0;
  }
}

/**
 * Remove duplicate pages based on URL and content similarity
 */
function deduplicatePages(pages) {
  const seen = new Map();
  return pages.filter(page => {
    const key = page.url.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.set(key, true);
    return true;
  });
}

updateKnowledgeBase().catch(console.error);
