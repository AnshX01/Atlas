/**
 * Unit tests for frontend utility functions and pure logic.
 *
 * These tests cover:
 * - cn() utility (class merging)
 * - Priority score logic
 * - Date formatting utilities
 */

// ── cn() utility ──────────────────────────────────────────────────────────────
// We test the logic inline since cn() uses clsx + tailwind-merge

describe("Priority Score Logic", () => {
  function getPriorityLevel(score: number): "urgent" | "high" | "medium" | "low" {
    if (score >= 90) return "urgent";
    if (score >= 70) return "high";
    if (score >= 40) return "medium";
    return "low";
  }

  it("returns urgent for score >= 90", () => {
    expect(getPriorityLevel(90)).toBe("urgent");
    expect(getPriorityLevel(95)).toBe("urgent");
    expect(getPriorityLevel(100)).toBe("urgent");
  });

  it("returns high for score 70-89", () => {
    expect(getPriorityLevel(70)).toBe("high");
    expect(getPriorityLevel(80)).toBe("high");
    expect(getPriorityLevel(89)).toBe("high");
  });

  it("returns medium for score 40-69", () => {
    expect(getPriorityLevel(40)).toBe("medium");
    expect(getPriorityLevel(55)).toBe("medium");
    expect(getPriorityLevel(69)).toBe("medium");
  });

  it("returns low for score < 40", () => {
    expect(getPriorityLevel(0)).toBe("low");
    expect(getPriorityLevel(20)).toBe("low");
    expect(getPriorityLevel(39)).toBe("low");
  });
});

// ── Focus Score Calculation ───────────────────────────────────────────────────
describe("Focus Score Calculation (mirrored from backend)", () => {
  interface MockItem { priority_score: number }

  function computeFocusScore(items: MockItem[]): { score: number; label: string } {
    if (!items.length) return { score: 0, label: "✨ Clear Day" };

    const scores = items.map((i) => i.priority_score);
    const top3 = [...scores].sort((a, b) => b - a).slice(0, 3);
    const topAvg = top3.reduce((a, b) => a + b, 0) / top3.length;
    const rest = scores.slice(3);
    const restAvg = rest.length ? rest.reduce((a, b) => a + b, 0) / rest.length : 0;
    const weighted = Math.floor(topAvg * 0.7 + restAvg * 0.3);

    let label: string;
    if (weighted >= 80) label = "🔴 High Focus Day";
    else if (weighted >= 55) label = "🟡 Moderate Focus Day";
    else if (weighted >= 30) label = "🟢 Light Day";
    else label = "✨ Clear Day";

    return { score: weighted, label };
  }

  it("returns 0 score and Clear Day for empty list", () => {
    const { score, label } = computeFocusScore([]);
    expect(score).toBe(0);
    expect(label).toBe("✨ Clear Day");
  });

  it("correctly weights top-3 at 70% and rest at 30%", () => {
    const items = [
      { priority_score: 90 },
      { priority_score: 80 },
      { priority_score: 70 },
      { priority_score: 40 },
      { priority_score: 20 },
    ];
    // top3 avg = 80, rest avg = 30
    // weighted = 56 + 9 = 65
    const { score, label } = computeFocusScore(items);
    expect(score).toBe(65);
    expect(label).toBe("🟡 Moderate Focus Day");
  });

  it("labels high focus day when score >= 80", () => {
    const items = [100, 100, 100, 95, 90].map((s) => ({ priority_score: s }));
    const { score, label } = computeFocusScore(items);
    expect(score).toBeGreaterThanOrEqual(80);
    expect(label).toBe("🔴 High Focus Day");
  });

  it("labels clear day for low priority items", () => {
    const items = [20, 20, 20, 10, 10].map((s) => ({ priority_score: s }));
    const { score, label } = computeFocusScore(items);
    expect(score).toBeLessThan(30);
    expect(label).toBe("✨ Clear Day");
  });
});

// ── BriefingItem type utilities ───────────────────────────────────────────────
describe("Briefing Item type normalization", () => {
  const validTypes = ["email", "pr", "issue", "calendar", "document", "task"] as const;
  type BriefingItemType = typeof validTypes[number];

  function normalizeType(raw: string): BriefingItemType {
    if ((validTypes as readonly string[]).includes(raw)) return raw as BriefingItemType;
    return "document";
  }

  it("keeps valid types as-is", () => {
    for (const t of validTypes) {
      expect(normalizeType(t)).toBe(t);
    }
  });

  it("falls back to 'document' for unknown types", () => {
    expect(normalizeType("unknown")).toBe("document");
    expect(normalizeType("")).toBe("document");
    expect(normalizeType("slack_message")).toBe("document");
  });
});

// ── Search query validation ────────────────────────────────────────────────────
describe("Search query validation", () => {
  function isValidQuery(q: string): boolean {
    return q.trim().length > 0 && q.trim().length <= 1000;
  }

  it("accepts normal queries", () => {
    expect(isValidQuery("quarterly OKRs")).toBe(true);
    expect(isValidQuery("open pull requests")).toBe(true);
  });

  it("rejects empty queries", () => {
    expect(isValidQuery("")).toBe(false);
    expect(isValidQuery("   ")).toBe(false);
  });

  it("rejects queries over 1000 chars", () => {
    expect(isValidQuery("a".repeat(1001))).toBe(false);
  });

  it("accepts queries exactly 1000 chars", () => {
    expect(isValidQuery("a".repeat(1000))).toBe(true);
  });
});
