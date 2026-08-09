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
});
