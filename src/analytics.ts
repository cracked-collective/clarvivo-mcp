import type { AnalyticsRow } from "./api.js";

type Item = Record<string, unknown>;

function value(input: unknown): number {
  const parsed = typeof input === "number" ? input : Number(input ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function items(input: unknown): Item[] {
  return Array.isArray(input)
    ? input.filter((item): item is Item => Boolean(item) && typeof item === "object")
    : [];
}

function mergeObject(rows: AnalyticsRow[], key: string): Map<string, number> {
  const result = new Map<string, number>();
  for (const row of rows) {
    const input = row[key];
    if (!input || typeof input !== "object" || Array.isArray(input)) continue;
    for (const [name, count] of Object.entries(input as Item)) {
      result.set(name, (result.get(name) ?? 0) + value(count));
    }
  }
  return result;
}

function rankedShares(totals: Map<string, number>, limit = 10) {
  const total = [...totals.values()].reduce((sum, count) => sum + count, 0);
  return [...totals.entries()]
    .filter(([, count]) => count > 0)
    .map(([name, visitors]) => ({
      name,
      visitors,
      ...(total > 0 ? { sharePercent: Math.round((visitors / total) * 100) } : {}),
    }))
    .sort((a, b) => b.visitors - a.visitors || a.name.localeCompare(b.name))
    .slice(0, limit);
}

export function aggregateTrafficSources(rows: AnalyticsRow[]) {
  const channels = rankedShares(mergeObject(rows, "trafficChannels"));
  const referrers = new Map<string, number>();
  const sources = new Map<string, {
    source: string;
    medium: string;
    campaign: string;
    visitors: number;
    conversions: number;
    revenue: number;
    hasConversions: boolean;
    hasRevenue: boolean;
  }>();

  for (const row of rows) {
    for (const item of items(row.topReferrers)) {
      const name = [item.source, item.referrer].find((candidate) => typeof candidate === "string") as string | undefined;
      if (!name) continue;
      referrers.set(name, (referrers.get(name) ?? 0) + value(item.visitors ?? item.visits ?? item.count));
    }
    for (const item of items(row.sourceBreakdown)) {
      const source = typeof item.source === "string" ? item.source : "(direct)";
      const medium = typeof item.medium === "string" ? item.medium : "(none)";
      const campaign = typeof item.campaign === "string" ? item.campaign : "(none)";
      const key = JSON.stringify([source, medium, campaign]);
      const aggregate = sources.get(key) ?? {
        source, medium, campaign, visitors: 0, conversions: 0, revenue: 0,
        hasConversions: false, hasRevenue: false,
      };
      aggregate.visitors += value(item.visitors);
      if (item.conversions !== undefined && item.conversions !== null) {
        aggregate.conversions += value(item.conversions);
        aggregate.hasConversions = true;
      }
      if (item.revenue !== undefined && item.revenue !== null) {
        aggregate.revenue += value(item.revenue);
        aggregate.hasRevenue = true;
      }
      sources.set(key, aggregate);
    }
  }

  return {
    channels: channels.map(({ name: channel, ...rest }) => ({ channel, ...rest })),
    referrers: [...referrers.entries()]
      .map(([referrer, visitors]) => ({ referrer, visitors }))
      .sort((a, b) => b.visitors - a.visitors || a.referrer.localeCompare(b.referrer))
      .slice(0, 10),
    sources: [...sources.values()]
      .sort((a, b) => b.visitors - a.visitors || a.source.localeCompare(b.source))
      .slice(0, 10)
      .map(({ hasConversions, hasRevenue, conversions, revenue, ...source }) => ({
        ...source,
        ...(hasConversions ? { conversions } : {}),
        ...(hasRevenue ? { revenue } : {}),
      })),
  };
}

export function aggregatePages(rows: AnalyticsRow[]) {
  const pages = new Map<string, {
    path: string;
    title: string;
    views: number;
    uniqueVisitors: number;
    entries: number;
    exits: number;
    bounceCount: number;
    totalDuration: number;
  }>();
  for (const row of rows) {
    for (const item of items(row.pageDetails)) {
      const pagePath = typeof item.path === "string" ? item.path : typeof item.page === "string" ? item.page : undefined;
      if (!pagePath) continue;
      const page = pages.get(pagePath) ?? {
        path: pagePath,
        title: typeof item.title === "string" ? item.title : pagePath,
        views: 0, uniqueVisitors: 0, entries: 0, exits: 0, bounceCount: 0, totalDuration: 0,
      };
      if (typeof item.title === "string" && item.title !== pagePath) page.title = item.title;
      page.views += value(item.views ?? item.pageviews);
      page.uniqueVisitors += value(item.uniqueVisitors);
      page.entries += value(item.entries);
      page.exits += value(item.exits);
      page.bounceCount += value(item.bounceCount);
      page.totalDuration += value(item.totalDuration);
      pages.set(pagePath, page);
    }
  }
  return [...pages.values()]
    .sort((a, b) => b.views - a.views || a.path.localeCompare(b.path))
    .slice(0, 10)
    .map(({ bounceCount, totalDuration, ...page }) => ({
      ...page,
      ...(page.entries > 0 ? { bouncePercent: Math.round((bounceCount / page.entries) * 100) } : {}),
      ...(page.views > 0 ? { avgTimeSeconds: Math.round((totalDuration / page.views) * 10) / 10 } : {}),
    }));
}

export function aggregateAudience(rows: AnalyticsRow[]) {
  const countries = new Map<string, number>();
  for (const row of rows) {
    for (const location of items(row.visitorLocations)) {
      const country = typeof location.country === "string" ? location.country : "Unknown";
      countries.set(country, (countries.get(country) ?? 0) + value(location.visits ?? location.visitors));
    }
  }
  const technology = (key: "screenResolutions" | "languages") => {
    const totals = new Map<string, number>();
    for (const row of rows) {
      const details = row.technologyDetails;
      if (!details || typeof details !== "object" || Array.isArray(details)) continue;
      const group = (details as Item)[key];
      if (!group || typeof group !== "object" || Array.isArray(group)) continue;
      for (const [name, count] of Object.entries(group as Item)) {
        totals.set(name, (totals.get(name) ?? 0) + value(count));
      }
    }
    return rankedShares(totals, 5);
  };
  return {
    devices: rankedShares(mergeObject(rows, "deviceBreakdown")),
    browsers: rankedShares(mergeObject(rows, "browserBreakdown")),
    operatingSystems: rankedShares(mergeObject(rows, "osBreakdown")),
    countries: [...countries.entries()]
      .map(([country, visitors]) => ({ country, visitors }))
      .sort((a, b) => b.visitors - a.visitors || a.country.localeCompare(b.country))
      .slice(0, 10),
    visitorSegments: rankedShares(mergeObject(rows, "visitorSegments")),
    screenResolutions: technology("screenResolutions"),
    languages: technology("languages"),
  };
}
