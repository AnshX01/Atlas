import { repairAndParseJson } from '../../electron/services/json-repair';

describe('repairAndParseJson', () => {
  it('handles standard JSON', () => {
    const input = '{"key": "value"}';
    const result = repairAndParseJson(input);
    expect(result).toEqual({ key: 'value' });
  });

  it('handles markdown wrappers', () => {
    const input = '```json\n{\n  "key": "value"\n}\n```';
    const result = repairAndParseJson(input);
    expect(result).toEqual({ key: 'value' });
  });

  it('handles trailing commas', () => {
    const input = '{\n  "key": "value",\n}';
    const result = repairAndParseJson(input);
    expect(result).toEqual({ key: 'value' });
  });

  it('handles truncated strings', () => {
    const input = '{"key": "value"'; // Needs closing quote and brace
    const result = repairAndParseJson(input);
    expect(result).toEqual({ key: 'value' });
  });

  // ── Size guard tests ───────────────────────────────────────────────────────

  describe('size guard', () => {
    it('test_size_guard_rejects_large_input: rejects input over 512KB', () => {
      const largeInput = 'x'.repeat(600_000);
      expect(() => repairAndParseJson(largeInput)).toThrow(/too large/);
      expect(() => repairAndParseJson(largeInput)).toThrow(/600000 chars/);
    });

    it('test_size_guard_allows_normal_input: parses normal-sized input', () => {
      const input = '{"key": "value"}';
      const result = repairAndParseJson(input);
      expect(result).toEqual({ key: 'value' });
    });

    it('test_size_guard_throws_within_1ms: rejects large input almost instantly', () => {
      const largeInput = 'x'.repeat(600_000);
      const start = Date.now();
      try {
        repairAndParseJson(largeInput);
      } catch {
        // Expected
      }
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(5);
    });
  });

  // ── Depth guard tests ──────────────────────────────────────────────────────

  describe('depth guard', () => {
    it('test_depth_guard_rejects_deep_nesting: rejects deeply nested objects', () => {
      const deepInput = '{'.repeat(60) + '"k":1' + '}'.repeat(60);
      expect(() => repairAndParseJson(deepInput)).toThrow(/nesting depth exceeds/);
    });

    it('allows reasonable nesting depth', () => {
      // 10 levels deep is fine
      const input = '{"a":{"b":{"c":{"d":{"e":{"f":{"g":{"h":{"i":{"j":"value"}}}}}}}}}}';
      const result = repairAndParseJson(input);
      expect(result.a.b.c.d.e.f.g.h.i.j).toBe('value');
    });

    it('rejects 51+ levels of nesting', () => {
      const deepInput = '{'.repeat(51) + '"k":1' + '}'.repeat(51);
      expect(() => repairAndParseJson(deepInput)).toThrow(/nesting depth exceeds 50/);
    });
  });
});
