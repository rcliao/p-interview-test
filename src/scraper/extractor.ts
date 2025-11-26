/**
 * Link Extractor - Extracts and contextualizes links from HTML pages using Playwright
 */

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

export interface ExtractedLink {
  url: string;
  anchorText: string;
  context: string; // surrounding text for better classification
  attributes: {
    title?: string;
    rel?: string;
    type?: string;
  };
}

export interface PageContent {
  url: string;
  title: string;
  markdown: string;
  links: ExtractedLink[];
}

// Browser instance management
let browserInstance: Browser | null = null;
let browserContext: BrowserContext | null = null;

// Browser configuration
let headlessMode: boolean = true;

/**
 * Sets whether to run browser in headless mode (call before initBrowser)
 */
export function setHeadless(mode: boolean): void {
  headlessMode = mode;
}

/**
 * Initializes the browser instance (call once before crawling)
 */
export async function initBrowser(): Promise<void> {
  if (browserInstance) return;

  console.log(`🌐 Launching browser (headless: ${headlessMode})...`);
  browserInstance = await chromium.launch({
    headless: headlessMode,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-infobars",
      "--window-position=0,0",
      "--ignore-certifcate-errors",
      "--ignore-certifcate-errors-spki-list",
    ],
  });

  browserContext = await browserInstance.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    viewport: { width: 1920, height: 1080 },
    locale: "en-US",
    timezoneId: "America/New_York",
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Encoding": "gzip, deflate, br",
      "Connection": "keep-alive",
      "Upgrade-Insecure-Requests": "1",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
      "Cache-Control": "max-age=0",
    },
    // Realistic screen properties
    screen: { width: 1920, height: 1080 },
    deviceScaleFactor: 2,
    isMobile: false,
    hasTouch: false,
    javaScriptEnabled: true,
  });

  // Add stealth scripts to evade detection
  await browserContext.addInitScript(() => {
    // Override webdriver property
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

    // Mock plugins
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5],
    });

    // Mock languages
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
    });

    // Mock chrome runtime
    (window as any).chrome = { runtime: {} };

    // Mock permissions
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters: any) =>
      parameters.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
        : originalQuery(parameters);
  });

  // Block unnecessary resources to speed up crawling
  await browserContext.route(
    /\.(png|jpg|jpeg|gif|webp|svg|ico|woff|woff2|ttf|eot)$/,
    (route) => route.abort()
  );

  console.log("✅ Browser ready");
}

/**
 * Closes the browser instance (call when done crawling)
 */
export async function closeBrowser(): Promise<void> {
  if (browserContext) {
    await browserContext.close();
    browserContext = null;
  }
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
  console.log("🌐 Browser closed");
}

/**
 * Gets the browser context, initializing if needed
 */
async function getContext(): Promise<BrowserContext> {
  if (!browserContext) {
    await initBrowser();
  }
  return browserContext!;
}

/**
 * Extracts main content from a page and converts to structured markdown
 * Removes navigation, headers, footers, and other non-content elements
 * Uses string-based evaluate to avoid esbuild __name transformation issues
 */
async function extractMainContentAsMarkdown(
  page: Page,
  pageTitle: string
): Promise<string> {
  // Pass code as string to avoid esbuild transformations adding __name calls
  const browserCode = `
    (function(title) {
      function getText(el) {
        if (!el) return "";
        return (el.textContent || "").trim().replace(/\\s+/g, " ");
      }

      var selectorsToRemove = [
        "nav", "header", "footer", "aside", ".nav", ".navigation",
        ".menu", ".sidebar", ".footer", ".header", "#nav", "#navigation",
        "#menu", "#sidebar", "#footer", "#header", "[role='navigation']",
        "[role='banner']", "[role='contentinfo']", "[role='complementary']",
        "script", "style", "noscript", "iframe", ".cookie-notice",
        ".popup", ".modal", ".advertisement", ".social-share", ".breadcrumb", ".skip-link"
      ];

      var bodyClone = document.body.cloneNode(true);
      for (var i = 0; i < selectorsToRemove.length; i++) {
        var els = bodyClone.querySelectorAll(selectorsToRemove[i]);
        for (var j = 0; j < els.length; j++) {
          els[j].remove();
        }
      }

      var mainSelectors = ["main", "[role='main']", "#main", "#content", ".main", ".content", "article", ".page-content", "#page-content"];
      var mainContent = null;
      for (var i = 0; i < mainSelectors.length; i++) {
        mainContent = bodyClone.querySelector(mainSelectors[i]);
        if (mainContent) break;
      }

      var contentRoot = mainContent || bodyClone;
      var lines = [];

      if (title) {
        lines.push("# " + title);
        lines.push("");
      }

      function processElement(el, depth) {
        if (depth === undefined) depth = 0;
        var tag = el.tagName.toLowerCase();

        if (el.style) {
          var style = window.getComputedStyle(el);
          if (style.display === "none" || style.visibility === "hidden") {
            return;
          }
        }

        var text, cells, children;
        switch (tag) {
          case "h1":
          case "h2":
            lines.push("");
            lines.push("## " + getText(el));
            lines.push("");
            break;
          case "h3":
            lines.push("");
            lines.push("### " + getText(el));
            lines.push("");
            break;
          case "h4":
            lines.push("");
            lines.push("#### " + getText(el));
            lines.push("");
            break;
          case "h5":
          case "h6":
            lines.push("");
            lines.push("##### " + getText(el));
            lines.push("");
            break;
          case "p":
            text = getText(el);
            if (text.length > 10) {
              lines.push("");
              lines.push(text);
              lines.push("");
            }
            break;
          case "li":
            text = getText(el);
            if (text.length > 5) {
              lines.push("- " + text);
            }
            break;
          case "ul":
          case "ol":
            lines.push("");
            var listItems = el.querySelectorAll(":scope > li");
            for (var i = 0; i < listItems.length; i++) {
              text = getText(listItems[i]);
              if (text.length > 5) {
                lines.push("- " + text);
              }
            }
            lines.push("");
            break;
          case "table":
            lines.push("");
            lines.push("**Table:**");
            var rows = el.querySelectorAll("tr");
            for (var i = 0; i < rows.length; i++) {
              cells = rows[i].querySelectorAll("th, td");
              var cellTexts = [];
              for (var j = 0; j < cells.length; j++) {
                var cellText = getText(cells[j]);
                if (cellText.length > 0) cellTexts.push(cellText);
              }
              if (cellTexts.length > 0) {
                lines.push("| " + cellTexts.join(" | ") + " |");
              }
            }
            lines.push("");
            break;
          case "blockquote":
            lines.push("");
            lines.push("> " + getText(el));
            lines.push("");
            break;
          case "pre":
          case "code":
            text = getText(el);
            if (text.length > 0) {
              lines.push("");
              lines.push("\`\`\`");
              lines.push(text);
              lines.push("\`\`\`");
              lines.push("");
            }
            break;
          case "div":
          case "section":
          case "article":
          case "main":
            children = el.children;
            for (var i = 0; i < children.length; i++) {
              processElement(children[i], depth + 1);
            }
            break;
          default:
            if (el.children.length === 0) {
              text = getText(el);
              if (text.length > 20 && text.indexOf("[") === -1 && depth < 5) {
                lines.push(text);
              }
            } else {
              children = el.children;
              for (var i = 0; i < children.length; i++) {
                processElement(children[i], depth + 1);
              }
            }
        }
      }

      var rootChildren = contentRoot.children;
      for (var i = 0; i < rootChildren.length; i++) {
        processElement(rootChildren[i]);
      }

      var markdown = lines.join("\\n");
      markdown = markdown.replace(/\\n{4,}/g, "\\n\\n\\n");
      markdown = markdown.replace(/^- \\s*$/gm, "");
      return markdown.trim();
    })(${JSON.stringify(pageTitle)})
  `;

  const content = await page.evaluate(browserCode);
  return content as string;
}

/**
 * Fetches a page using Playwright and extracts all links with context
 */
export async function extractLinksFromUrl(
  url: string
): Promise<PageContent | null> {
  const context = await getContext();
  const page = await context.newPage();

  try {
    // Navigate to the page with timeout
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    if (!response) {
      console.error(`No response from ${url}`);
      return null;
    }

    if (!response.ok()) {
      console.error(`Failed to fetch ${url}: ${response.status()}`);
      return null;
    }

    // Wait a bit for any dynamic content
    await page.waitForTimeout(1000);

    // Extract page title
    const title = await page.title();

    // Get the HTML content
    const html = await page.content();

    // Extract links using Playwright's built-in selectors (more reliable)
    const links = await extractLinksFromPage(page, url);

    // Extract main content as structured markdown using Playwright
    const markdown = await extractMainContentAsMarkdown(page, title);

    return {
      url,
      title,
      markdown,
      links,
    };
  } catch (error) {
    console.error(`Error fetching ${url}:`, error);
    return null;
  } finally {
    await page.close();
  }
}

/**
 * Extracts links directly from the Playwright page
 */
async function extractLinksFromPage(
  page: Page,
  baseUrl: string
): Promise<ExtractedLink[]> {
  const links = await page.evaluate((base: string) => {
    const anchors = Array.from(document.querySelectorAll("a[href]"));
    const results: Array<{
      url: string;
      anchorText: string;
      context: string;
      title?: string;
      rel?: string;
    }> = [];

    for (const anchor of anchors) {
      const href = anchor.getAttribute("href");
      if (!href) continue;

      // Skip non-http links
      if (
        href.startsWith("javascript:") ||
        href.startsWith("mailto:") ||
        href.startsWith("tel:") ||
        href === "#" ||
        href.startsWith("#")
      ) {
        continue;
      }

      // Resolve relative URLs
      let absoluteUrl: string;
      try {
        absoluteUrl = new URL(href, base).toString();
      } catch {
        continue;
      }

      // Get anchor text
      const anchorText = (anchor.textContent || href).trim();

      // Get surrounding context
      const parent = anchor.parentElement;
      const context = parent?.textContent?.trim().slice(0, 300) || anchorText;

      results.push({
        url: absoluteUrl,
        anchorText,
        context: context.replace(/\s+/g, " "),
        title: anchor.getAttribute("title") || undefined,
        rel: anchor.getAttribute("rel") || undefined,
      });
    }

    return results;
  }, baseUrl);

  // Deduplicate and format
  const uniqueLinks = deduplicateLinks(
    links.map((link) => ({
      url: link.url,
      anchorText: link.anchorText,
      context: link.context,
      attributes: {
        title: link.title,
        rel: link.rel,
      },
    }))
  );

  return uniqueLinks;
}

/**
 * Extracts links and content from raw HTML (fallback method)
 */
export function extractFromHtml(html: string, baseUrl: string): PageContent {
  const links: ExtractedLink[] = [];

  // Extract title
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeHtmlEntities(titleMatch[1].trim()) : "";

  // Remove script and style tags for cleaner text extraction
  const cleanHtml = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  // Extract all anchor tags with regex
  const linkRegex =
    /<a\s+(?:[^>]*?\s+)?href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = linkRegex.exec(cleanHtml)) !== null) {
    const [fullMatch, href, innerHtml] = match;

    if (
      !href ||
      href.startsWith("javascript:") ||
      href.startsWith("mailto:") ||
      href.startsWith("tel:") ||
      href === "#" ||
      href.startsWith("#")
    ) {
      continue;
    }

    let absoluteUrl: string;
    try {
      absoluteUrl = new URL(href, baseUrl).toString();
    } catch {
      continue;
    }

    const anchorText = stripHtml(innerHtml).trim();
    const matchIndex = match.index;
    const contextStart = Math.max(0, matchIndex - 100);
    const contextEnd = Math.min(
      cleanHtml.length,
      matchIndex + fullMatch.length + 100
    );
    const contextHtml = cleanHtml.slice(contextStart, contextEnd);
    const context = stripHtml(contextHtml).trim().replace(/\s+/g, " ");

    const titleAttr = fullMatch.match(/title=["']([^"']+)["']/i);
    const relAttr = fullMatch.match(/rel=["']([^"']+)["']/i);
    const typeAttr = fullMatch.match(/type=["']([^"']+)["']/i);

    links.push({
      url: absoluteUrl,
      anchorText: anchorText || href,
      context,
      attributes: {
        title: titleAttr ? titleAttr[1] : undefined,
        rel: relAttr ? relAttr[1] : undefined,
        type: typeAttr ? typeAttr[1] : undefined,
      },
    });
  }

  const uniqueLinks = deduplicateLinks(links);
  const markdown = htmlToMarkdown(cleanHtml);

  return {
    url: baseUrl,
    title,
    markdown,
    links: uniqueLinks,
  };
}

/**
 * Deduplicates links by URL, keeping the one with the most context
 */
function deduplicateLinks(links: ExtractedLink[]): ExtractedLink[] {
  const seen = new Map<string, ExtractedLink>();

  for (const link of links) {
    const existing = seen.get(link.url);
    if (!existing || link.context.length > existing.context.length) {
      seen.set(link.url, link);
    }
  }

  return Array.from(seen.values());
}

/**
 * Strips HTML tags from a string
 */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Decodes HTML entities
 */
function decodeHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&apos;": "'",
    "&nbsp;": " ",
  };

  return text.replace(
    /&(?:amp|lt|gt|quot|#39|apos|nbsp);/g,
    (match) => entities[match] || match
  );
}

/**
 * Converts HTML to simplified markdown
 */
function htmlToMarkdown(html: string): string {
  // Remove script and style tags first
  let md = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  // Convert headings
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n");
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n");
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n");
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "\n#### $1\n");
  md = md.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, "\n##### $1\n");
  md = md.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, "\n###### $1\n");

  // Convert paragraphs and line breaks
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "\n$1\n");
  md = md.replace(/<br\s*\/?>/gi, "\n");

  // Convert lists
  md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n");
  md = md.replace(/<\/?[ou]l[^>]*>/gi, "\n");

  // Convert bold and italic
  md = md.replace(/<(?:strong|b)[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, "**$1**");
  md = md.replace(/<(?:em|i)[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, "*$1*");

  // Convert links (keeping URL)
  md = md.replace(
    /<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    "[$2]($1)"
  );

  // Strip remaining HTML tags
  md = stripHtml(md);

  // Clean up whitespace
  md = md.replace(/\n{3,}/g, "\n\n");
  md = md.trim();

  return md;
}

/**
 * Filters links to keep only potentially valuable ones (pre-LLM filtering)
 */
export function preFilterLinks(
  links: ExtractedLink[],
  baseUrl: string
): ExtractedLink[] {
  const base = new URL(baseUrl);

  return links.filter((link) => {
    try {
      const linkUrl = new URL(link.url);

      // Skip common non-valuable links
      const skipPatterns = [
        /\.(jpg|jpeg|png|gif|svg|ico|css|js|woff|woff2|ttf|eot)$/i,
        /^https?:\/\/(www\.)?(facebook|twitter|instagram|linkedin|youtube|tiktok)\./i,
        /\/share\?/i,
        /\/login/i,
        /\/signin/i,
        /\/signup/i,
        /\/cart/i,
        /\/search\?/i,
        /\?utm_/i,
      ];

      for (const pattern of skipPatterns) {
        if (pattern.test(link.url)) {
          return false;
        }
      }

      // Prefer same-domain or subdomain links
      const sameDomain =
        linkUrl.hostname === base.hostname ||
        linkUrl.hostname.endsWith(`.${base.hostname}`) ||
        base.hostname.endsWith(`.${linkUrl.hostname}`);

      // Allow external links only if they look valuable
      if (!sameDomain) {
        const valuableExternalPatterns = [
          /\.gov\//i,
          /\.edu\//i,
          /budget/i,
          /finance/i,
          /procurement/i,
          /rfp/i,
          /bid/i,
        ];
        return valuableExternalPatterns.some((p) => p.test(link.url));
      }

      return true;
    } catch {
      return false;
    }
  });
}
