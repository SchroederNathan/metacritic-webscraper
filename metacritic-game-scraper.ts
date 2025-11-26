// filename: metacritic-game-scraper.ts
// Description: Server-side scraper to find Metacritic game pages by name and return JSON with ratings and reviews.
// Usage:
//   bun install
//   bun metacritic-game-scraper.ts "Fortnite"
//   bun metacritic-game-scraper.ts "GTA V" --limit 2

// Notes:
// - This scrapes Metacritic's public site. Use only for educational purposes.
// - Do not run client-side. Metacritic uses bot protections and disallows scraping per their ToS.
// - Keep concurrency low; include delays; cache results to avoid repeated hits.

import { load as loadHTML } from "cheerio";
import { request } from "undici";
// @ts-ignore - ms doesn't have types
import ms from "ms";

type Platform =
  | "pc"
  | "playstation-5"
  | "xbox-series-x"
  | "switch"
  | "playstation-4"
  | "xbox-one"
  | "ios"
  | "android"
  | "stadia"
  | "wii-u"
  | "3ds"
  | "vita"
  | "mac"
  | "linux";

interface Review {
  type: "critic" | "user";
  source?: string; // Outlet name for critic, or username for user
  quote?: string; // Review excerpt/snippet
  score?: number; // Critic: 0–100, User: 0–10
  date?: string; // ISO if parsable, otherwise raw
  url?: string; // Link to full review (critic reviews often have external links)
}

interface GameRatings {
  name: string;
  platforms: string[]; // All platforms the game is available on
  slug: string;
  url: string;
  metascore?: number; // 0–100
  userscore?: number; // 0–10
  criticReviewsCount?: number;
  userRatingsCount?: number;
  releaseDate?: string;
  reviews?: Review[]; // Optional - not needed for simple metascore lookup
}

interface SearchResult {
  name: string;
  platforms: string[]; // All platforms the game is available on
  slug: string; // the part after /game/<platform>/
  url: string;
  metascore?: number; // Metascore from API
}

interface ScrapeOptions {
  concurrency?: number; // default 2
  timeoutMs?: number; // default 15000
  delayBetweenRequestsMs?: number; // default 1000
  maxCandidates?: number; // default 5
}

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
};

function sleep(msNum: number) {
  return new Promise((res) => setTimeout(res, msNum));
}

function parseNumber(text?: string): number | undefined {
  if (!text) return undefined;
  const cleaned = text.replace(/[^\d.]/g, "");
  if (!cleaned) return undefined;
  const n = Number(cleaned);
  return Number.isNaN(n) ? undefined : n;
}

function normalizePlatform(raw?: string): string | undefined {
  if (!raw) return undefined;
  const t = raw.toLowerCase();
  // Map common display names to path segments where possible
  if (t.includes("pc")) return "pc";
  if (t.includes("playstation 5")) return "playstation-5";
  if (t.includes("ps5")) return "playstation-5";
  if (t.includes("playstation 4")) return "playstation-4";
  if (t.includes("ps4")) return "playstation-4";
  if (t.includes("xbox series")) return "xbox-series-x";
  if (t.includes("xbox one")) return "xbox-one";
  if (t.includes("switch")) return "switch";
  if (t.includes("mac")) return "mac";
  if (t.includes("linux")) return "linux";
  if (t.includes("ios")) return "ios";
  if (t.includes("android")) return "android";
  return raw;
}

async function fetchHtml(url: string, timeoutMs: number): Promise<string> {
  const { body, statusCode } = await request(url, {
    headers: DEFAULT_HEADERS,
    bodyTimeout: timeoutMs,
    headersTimeout: timeoutMs,
  });
  if (statusCode >= 400) {
    throw new Error(`HTTP ${statusCode} for ${url}`);
  }
  const buf = await body.arrayBuffer();
  return Buffer.from(buf).toString("utf-8");
}

/**
 * Search Metacritic for games by name.
 * We use Metacritic's internal search results page.
 */
export async function searchGamesByName(
  query: string,
  opts: ScrapeOptions = {}
): Promise<SearchResult[]> {
  const timeoutMs = opts.timeoutMs ?? 15000;

  // Use Metacritic's backend API endpoint directly
  // mcoTypeId=13 is for games (2=movies, 1=TV, 3=people)
  // Only get 1 result (the best match)
  const apiUrl = `https://backend.metacritic.com/finder/metacritic/search/${encodeURIComponent(
    query
  )}/web?offset=0&limit=1&mcoTypeId=13&sortBy=&sortDirection=DESC&componentName=search&componentDisplayName=Search&componentType=SearchResults`;

  try {
    const { body, statusCode } = await request(apiUrl, {
      headers: {
        ...DEFAULT_HEADERS,
        Accept: "application/json",
      },
      bodyTimeout: timeoutMs,
      headersTimeout: timeoutMs,
    });

    if (statusCode === 200) {
      const buf = await body.arrayBuffer();
      const jsonText = Buffer.from(buf).toString("utf-8");
      if (jsonText) {
        try {
          const jsonData = JSON.parse(jsonText);
          // The API returns data.items array
          if (
            jsonData &&
            jsonData.data &&
            jsonData.data.items &&
            Array.isArray(jsonData.data.items)
          ) {
            const results: SearchResult[] = jsonData.data.items
              .filter((item: any) => item.type === "game-title" && item.slug)
              .map((item: any) => {
                // Extract slug from the item
                const slug = item.slug || "";

                // Get all platforms and normalize them, removing duplicates
                const platforms: string[] =
                  item.platforms && Array.isArray(item.platforms)
                    ? Array.from(
                        new Set(
                          item.platforms
                            .map((p: any) => normalizePlatform(p.name))
                            .filter((p: string | undefined): p is string => !!p)
                        )
                      )
                    : [];

                // Use first platform for URL construction, or slug-only if no platforms
                const firstPlatform = platforms.length > 0 ? platforms[0] : "";
                const gameUrl = firstPlatform
                  ? `https://www.metacritic.com/game/${firstPlatform}/${slug}/`
                  : `https://www.metacritic.com/game/${slug}/`;

                // Extract metascore from criticScoreSummary
                const metascore = item.criticScoreSummary?.score ?? undefined;

                return {
                  name: item.title || item.name || "",
                  platforms: platforms,
                  slug: slug,
                  url: gameUrl,
                  metascore: metascore,
                };
              });
            if (results.length > 0 && results[0]) {
              // Return only the first (best) result
              return [results[0]];
            }
          }
        } catch (e) {
          // Not valid JSON, fall through to HTML scraping
        }
      }
    }
  } catch (e) {
    // API endpoint failed, fall through to HTML scraping
  }

  // Fallback: Try the standard Metacritic search URL format and parse HTML
  // Note: category=2 is wrong, it should be games but Metacritic uses mcoTypeId=13 in API
  const url = `https://www.metacritic.com/search/${encodeURIComponent(
    query
  )}/?category=2`;
  const html = await fetchHtml(url, timeoutMs);
  const $ = loadHTML(html);

  const results: SearchResult[] = [];

  // Check for embedded JSON data in script tags (some sites embed search results as JSON)
  // Also check for inline script tags that might contain search data
  const scriptTags = $(
    'script[type="application/json"], script[type="application/ld+json"], script:not([src])'
  );
  let jsonData: any = null;
  scriptTags.each((_, el) => {
    try {
      const content = $(el).html();
      if (content && (content.includes("search") || content.includes("game"))) {
        // Try to find JSON-like structures in script tags
        const jsonMatch = content.match(
          /\{[\s\S]*"url"[\s\S]*"\/game\/[\s\S]*\}/
        );
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed && (parsed.url || Array.isArray(parsed))) {
              jsonData = parsed;
            }
          } catch (e) {
            // Try parsing the whole content
            try {
              const parsed = JSON.parse(content);
              if (
                parsed &&
                (parsed["@graph"] ||
                  parsed.itemListElement ||
                  parsed.mainEntity ||
                  (Array.isArray(parsed) && parsed.length > 0))
              ) {
                jsonData = parsed;
              }
            } catch (e2) {
              // Not valid JSON, skip
            }
          }
        }
      }
    } catch (e) {
      // Not valid JSON, skip
    }
  });

  // First, try to find search results in specific containers
  // Metacritic search results might be in specific sections after the redesign
  let gameLinks = $(
    'section[data-testid="search-results"] a[href*="/game/"], .search_results a[href*="/game/"], .search_result a[href*="/game/"], [class*="search"] a[href*="/game/"], main a[href*="/game/"], [role="main"] a[href*="/game/"]'
  );

  // If no results in search containers, try to filter out navigation/footer links
  if (gameLinks.length === 0) {
    // Get all game links but exclude those in nav, header, footer
    const allGameLinks = $('a[href*="/game/"]');
    gameLinks = allGameLinks.filter((_, el) => {
      const $el = $(el);
      // Exclude navigation, header, footer, and sidebar elements
      const $parent = $el.closest(
        'nav, header, footer, aside, .nav, .header, .footer, [class*="nav"], [class*="header"], [class*="footer"], [class*="sidebar"], [role="navigation"], [role="banner"], [role="complementary"]'
      );
      if ($parent.length > 0) return false;

      // Also exclude links that are clearly navigation (short text, common words)
      const linkText = $el.text().toLowerCase().trim();
      if (linkText.length < 3) return false;
      if (
        [
          "games",
          "all",
          "new",
          "reviews",
          "more",
          "see all",
          "explore",
        ].includes(linkText)
      )
        return false;

      return true;
    });
  }

  // Metacritic has a new layout, but also serves a classic list.
  // Try multiple selectors.
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 2); // Words longer than 2 chars

  gameLinks.each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    // Skip browse links and non-game links
    if (href.includes("/browse/")) return;

    // Try to verify this is actually a search result, not a homepage link
    // Check if the link text or nearby text relates to the search query
    const linkText = $(el).text().toLowerCase().trim();
    const linkHref = href.toLowerCase();

    // Skip very generic/short links that are likely navigation
    if (linkText.length < 3) return;
    if (
      ["games", "all", "new", "reviews", "more", "see all", "explore"].includes(
        linkText
      )
    )
      return;

    // Check if this link is in a navigation/header/footer element
    const $parent = $(el).closest(
      'nav, header, footer, [role="navigation"], [role="banner"]'
    );
    if ($parent.length > 0) return;

    // Try to find if this is in a search results container
    // Look for parent elements that might indicate search results
    const $searchContainer = $(el).closest(
      '[class*="search"], [id*="search"], section, article, [data-testid*="search"]'
    );

    // If we have query words, check if at least one appears in the link text or href
    // This helps filter out unrelated games from homepage
    if (queryWords.length > 0) {
      const textMatch = queryWords.some(
        (word) => linkText.includes(word) || linkHref.includes(word)
      );
      // If no match and not in a search container, it's probably not a search result
      if (!textMatch && $searchContainer.length === 0) {
        // But be lenient - sometimes game names don't match exactly
        // Only skip if it's clearly unrelated (no common words at all)
        const hasCommonWords = queryWords.some((word) => {
          // Check for partial matches or common game-related terms
          return (
            linkText.includes(word.substring(0, 3)) ||
            linkHref.includes(word.substring(0, 3))
          );
        });
        if (!hasCommonWords) return;
      }
    }

    // Handle patterns:
    // - /game/<platform>/<slug>/ (classic format)
    // - /game/<slug>/ (new format without platform in path)
    // Skip links with extra path segments like /critic-reviews/, /user-reviews/, etc.
    let platform: string | undefined;
    let slug: string | undefined;

    // Known non-game path segments to skip
    const skipSegments = ["critic-reviews", "user-reviews", "reviews"];

    const m1 = href.match(/^\/game\/([^/]+)\/([^/]+)\/?/); // /game/platform/slug or /game/slug/extra
    const m2 = href.match(/^\/game\/([^/]+)\/?$/); // /game/slug

    if (m1) {
      const firstSegment = m1[1];
      const secondSegment = m1[2];

      if (!firstSegment || !secondSegment) return;

      // Check if first segment is a known platform
      if (
        firstSegment.match(
          /^(pc|playstation-5|playstation-4|ps5|ps4|xbox-series-x|xbox-one|switch|ios|android|mac|linux|stadia|wii-u|3ds|vita|nintendo-switch)/
        )
      ) {
        // Format: /game/platform/slug - only if second segment is not a skip segment
        if (!skipSegments.includes(secondSegment)) {
          platform = firstSegment;
          slug = secondSegment;
        }
      } else {
        // Format: /game/slug/extra - only use if second segment is not a skip segment
        // If it is a skip segment, this is not the main game page, skip it
        if (!skipSegments.includes(secondSegment)) {
          slug = firstSegment;
        }
      }
    } else if (m2) {
      slug = m2[1];
    }

    if (!slug) return;
    const name =
      $(el).find('[data-testid="searchResult-title"]').first().text().trim() ||
      $(el).text().trim();

    const platformText =
      $(el)
        .find('[data-testid="searchResult-platform"]')
        .first()
        .text()
        .trim() || platform;

    // Construct URL - use original href but ensure it ends with /
    const cleanHref = href.split("?")[0] || href; // Remove query params
    const url = `https://www.metacritic.com${
      cleanHref.endsWith("/") ? cleanHref : cleanHref + "/"
    }`;

    const normalizedPlatform = normalizePlatform(platformText) || platform;
    results.push({
      name: name || slug,
      platforms: normalizedPlatform ? [normalizedPlatform] : [],
      slug,
      url,
    });
  });

  // Deduplicate by url
  const seen = new Set<string>();
  const deduped = results.filter((r) => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });

  // Return only the first result (best match)
  const firstResult = deduped[0];
  return firstResult ? [firstResult] : [];
}

/**
 * Parse ratings + reviews from a specific game page.
 */
export async function scrapeGamePage(
  url: string,
  opts: ScrapeOptions = {}
): Promise<GameRatings> {
  const timeoutMs = opts.timeoutMs ?? 15000;

  const html = await fetchHtml(url, timeoutMs);
  const $ = loadHTML(html);

  const name =
    $('h1[data-testid="product-title"]').first().text().trim() ||
    $("h1.product_title").first().text().trim() ||
    $('meta[property="og:title"]').attr("content")?.trim() ||
    "";

  const platform =
    $('span[data-testid="product-platform"]').first().text().trim() ||
    $("span.platform").first().text().trim() ||
    "";

  const metascoreText =
    $('[data-testid="metascore-wrapped"]').first().text().trim() ||
    $("div.metascore_w > span").first().text().trim() ||
    $("div.metascore_w").first().text().trim();

  const userscoreText =
    $('[data-testid="userscore-wrapped"]').first().text().trim() ||
    $("div.userscore_w > span").first().text().trim() ||
    $("div.userscore_w").first().text().trim();

  const criticCountText =
    $('[data-testid="critic-reviews-count"]').first().text().trim() ||
    $("a.metascore_anchor span.count").first().text().trim();

  const userCountText =
    $('[data-testid="user-reviews-count"]').first().text().trim() ||
    $("a.userscore_anchor span.count").first().text().trim();

  const releaseDate =
    $('[data-testid="product-release-date"]').first().text().trim() ||
    $("li.release_data .data").first().text().trim();

  const reviews: Review[] = [];

  // Critic reviews section: find list items with outlet, score, date, quote, link
  $('[data-testid="critic-reviews"] article, .critic_reviews .review').each(
    (_, el) => {
      const $el = $(el);
      const source =
        $el.find('[data-testid="critic-publication"]').first().text().trim() ||
        $el.find(".source").first().text().trim();

      const scoreText =
        $el.find('[data-testid="critic-score"]').first().text().trim() ||
        $el.find(".metascore_w").first().text().trim();

      const dateText =
        $el.find('[data-testid="critic-date"]').first().text().trim() ||
        $el.find(".date").first().text().trim();

      const quote =
        $el.find('[data-testid="review-quote"]').first().text().trim() ||
        $el.find(".summary").first().text().trim();

      const urlEl =
        $el.find('a[href^="http"]').first().attr("href") ||
        $el.find("a.read_full_review").first().attr("href");

      reviews.push({
        type: "critic",
        source: source || undefined,
        quote: quote || undefined,
        score: parseNumber(scoreText),
        date: dateText || undefined,
        url: urlEl || undefined,
      });
    }
  );

  // User reviews section: username, score, date, quote
  $('[data-testid="user-reviews"] article, .user_reviews .review').each(
    (_, el) => {
      const $el = $(el);
      const source =
        $el.find('[data-testid="user-username"]').first().text().trim() ||
        $el.find(".author").first().text().trim();

      const scoreText =
        $el.find('[data-testid="user-score"]').first().text().trim() ||
        $el.find(".metascore_w").first().text().trim();

      const dateText =
        $el.find('[data-testid="user-date"]').first().text().trim() ||
        $el.find(".date").first().text().trim();

      const quote =
        $el.find('[data-testid="review-quote"]').first().text().trim() ||
        $el.find(".summary").first().text().trim();

      reviews.push({
        type: "user",
        source: source || undefined,
        quote: quote || undefined,
        score: parseNumber(scoreText),
        date: dateText || undefined,
      });
    }
  );

  // Derive platform slug and game slug from URL
  const m = url.match(
    /^https:\/\/www\.metacritic\.com\/game\/([^/]+)\/([^/]+)\/?/
  );
  const platformSlug = m?.[1] ?? platform.toLowerCase();
  const gameSlug = m?.[2] ?? name.toLowerCase().replace(/\s+/g, "-");

  const normalizedPlatform = normalizePlatform(platform) || platformSlug;
  const result: GameRatings = {
    name,
    platforms: normalizedPlatform ? [normalizedPlatform] : [],
    slug: gameSlug,
    url,
    metascore: parseNumber(metascoreText),
    userscore: parseNumber(userscoreText),
    criticReviewsCount: parseNumber(criticCountText),
    userRatingsCount: parseNumber(userCountText),
    releaseDate: releaseDate || undefined,
    reviews,
  };

  return result;
}

/**
 * Main: find game by name and return with metascore from API.
 * Returns only the best match (first result).
 */
export async function getGameRatingsAndReviewsByName(
  query: string,
  opts: ScrapeOptions = {}
): Promise<GameRatings[]> {
  const candidates = await searchGamesByName(query, opts);
  if (candidates.length === 0 || !candidates[0]) {
    return [];
  }

  // Get the first (and only) result
  const result = candidates[0];

  // Convert SearchResult to GameRatings format
  const gameRating: GameRatings = {
    name: result.name,
    platforms: result.platforms || [],
    slug: result.slug,
    url: result.url,
    metascore: result.metascore,
  };

  return [gameRating];
}

// Simple CLI
// Check if this is the main module (ESM-compatible for Bun)
if (import.meta.main || Bun.main === import.meta.url) {
  const args = process.argv.slice(2);
  const q = args[0] || "Fortnite";

  // parse optional flags
  const limitArg = args.find((a) => a.startsWith("--limit="));
  const concArg = args.find((a) => a.startsWith("--concurrency="));
  const timeoutArg = args.find((a) => a.startsWith("--timeout="));
  const delayArg = args.find((a) => a.startsWith("--delay="));

  const maxCandidates = limitArg ? Number(limitArg.split("=")[1]) : 5;
  const concurrency = concArg ? Number(concArg.split("=")[1]) : 2;
  const timeoutMs = timeoutArg ? ms(timeoutArg.split("=")[1]) ?? 15000 : 15000;
  const delayBetweenRequestsMs = delayArg
    ? ms(delayArg.split("=")[1]) ?? 1000
    : 1000;

  (async () => {
    try {
      const results = await getGameRatingsAndReviewsByName(q, {
        maxCandidates,
        concurrency,
        timeoutMs,
        delayBetweenRequestsMs,
      });
      console.log(JSON.stringify(results, null, 2));
    } catch (err) {
      console.error("Error:", err);
      process.exit(1);
    }
  })();
}
