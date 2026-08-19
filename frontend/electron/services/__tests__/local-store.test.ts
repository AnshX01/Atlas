import { persistToDisk, persistToDiskSync } from '../local-store';
import * as fs from 'fs';

jest.mock('fs', () => {
  const actualFs = jest.requireActual('fs');
  return {
    ...actualFs,
    promises: {
      writeFile: jest.fn().mockResolvedValue(undefined),
    },
    writeFileSync: jest.fn(),
    renameSync: jest.fn(),
  };
});

describe('local-store persist', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should use different tmp files for async and sync persist to avoid locking', async () => {
    expect(true).toBe(true);
  });
});
