import { syncManager } from '../cloud-sync';

describe('cloud-sync', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('pullSecret should clean up its timeout if Supabase responds quickly', async () => {
    // We mock supabase response
    syncManager.isOnline = true;
    syncManager.supabase = {
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: { encrypted_value: 'secret' }, error: null }),
    } as any;

    const promise = syncManager.pullSecret('user', 'key');
    
    // Resolve the query
    const result = await promise;
    expect(result).toBe('secret');

    // If the timeout was not cleared, advancing timers by 5s would trigger it.
    // In Jest, we can check if there are any pending timers.
    expect(jest.getTimerCount()).toBe(0);
  });
});
