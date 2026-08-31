import { describe, expect, it } from "vitest";
import { aggregateAudience, aggregatePages, aggregateTrafficSources } from "../src/analytics.js";

describe("deep analytics aggregation", () => {
  it("aggregates traffic math across days and caps every list at ten", () => {
    const extras = Array.from({ length: 11 }, (_, index) => ({ source: `source-${index}`, medium: "email", campaign: "launch", visitors: index + 1 }));
    const rows = [
      {
        trafficChannels: { direct: 30, social: 10 },
        topReferrers: Array.from({ length: 11 }, (_, index) => ({ source: `ref-${index}`, visits: index + 1 })),
        sourceBreakdown: [
          { source: "google", medium: "cpc", campaign: "spring", visitors: 4, conversions: 1, revenue: 20 },
          ...extras,
        ],
      },
      {
        trafficChannels: { direct: 10, social: 30 },
        topReferrers: [{ source: "ref-10", visitors: 5 }],
        sourceBreakdown: [{ source: "google", medium: "cpc", campaign: "spring", visitors: 6, conversions: 2, revenue: 30 }],
      },
    ];
    const result = aggregateTrafficSources(rows);
    expect(result.channels).toEqual([
      { channel: "direct", visitors: 40, sharePercent: 50 },
      { channel: "social", visitors: 40, sharePercent: 50 },
    ]);
    expect(result.referrers).toHaveLength(10);
    expect(result.referrers[0]).toEqual({ referrer: "ref-10", visitors: 16 });
    expect(result.sources).toHaveLength(10);
    expect(result.sources).toContainEqual({ source: "google", medium: "cpc", campaign: "spring", visitors: 10, conversions: 3, revenue: 50 });
  });

  it("returns top pages by aggregate views and omits rates with zero denominators", () => {
    const rows = [
      { pageDetails: [{ path: "/top", title: "Top", views: 10, uniqueVisitors: 4, entries: 2, exits: 1, bounceCount: 1, totalDuration: 50 }] },
      { pageDetails: [
        { path: "/top", views: 5, uniqueVisitors: 3, entries: 3, exits: 2, bounceCount: 1, totalDuration: 25 },
        { path: "/empty", views: 0, entries: 0, bounceCount: 0, totalDuration: 0 },
        ...Array.from({ length: 10 }, (_, index) => ({ path: `/page-${index}`, views: index + 1, entries: 1 })),
      ] },
    ];
    const pages = aggregatePages(rows);
    expect(pages).toHaveLength(10);
    expect(pages[0]).toMatchObject({ path: "/top", views: 15, uniqueVisitors: 7, entries: 5, exits: 3, bouncePercent: 40, avgTimeSeconds: 5 });
    expect(pages.some((page) => page.path === "/empty")).toBe(false);

    const [zero] = aggregatePages([{ pageDetails: [{ path: "/zero", views: 0, entries: 0, bounceCount: 4, totalDuration: 20 }] }]);
    expect(zero).not.toHaveProperty("bouncePercent");
    expect(zero).not.toHaveProperty("avgTimeSeconds");
  });

  it("aggregates audience shares, countries, segments, screens, and languages", () => {
    const result = aggregateAudience([
      {
        deviceBreakdown: { desktop: 3, mobile: 1 }, browserBreakdown: { chrome: 4 }, osBreakdown: { macos: 2, ios: 2 },
        visitorLocations: [{ country: "India", visits: 3 }], visitorSegments: { new: 3, returning: 1 },
        technologyDetails: { screenResolutions: { "1440x900": 3 }, languages: { en: 2 } },
      },
      {
        deviceBreakdown: { desktop: 1, mobile: 3 }, browserBreakdown: { safari: 4 }, osBreakdown: { macos: 2, ios: 2 },
        visitorLocations: [{ country: "India", visits: 2 }, { country: "UK", visits: 1 }], visitorSegments: { new: 1, returning: 3 },
        technologyDetails: { screenResolutions: { "1440x900": 1, "390x844": 3 }, languages: { en: 2, hi: 1 } },
      },
    ]);
    expect(result.devices).toEqual([
      { name: "desktop", visitors: 4, sharePercent: 50 },
      { name: "mobile", visitors: 4, sharePercent: 50 },
    ]);
    expect(result.countries[0]).toEqual({ country: "India", visitors: 5 });
    expect(result.visitorSegments).toEqual([
      { name: "new", visitors: 4, sharePercent: 50 },
      { name: "returning", visitors: 4, sharePercent: 50 },
    ]);
    expect(result.screenResolutions).toHaveLength(2);
    expect(result.languages).toHaveLength(2);
  });
});
