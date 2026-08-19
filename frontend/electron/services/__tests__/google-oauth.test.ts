
import { startGoogleOAuth } from '../../frontend/electron/services/google-oauth';

// Mock electron
jest.mock('electron', () => ({
  shell: {
    openExternal: jest.fn(),
  },
}));

describe('startGoogleOAuth', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should not hang when multiple OAuth flows are started', async () => {
    // Start the first flow
    const promise1 = startGoogleOAuth('client1', 'secret1');
    
    // Start the second flow immediately (simulating user clicking twice)
    const promise2 = startGoogleOAuth('client2', 'secret2');

    // First promise should be rejected because a new one started
    await expect(promise1).rejects.toThrow('A new OAuth flow was started');

    // Fast-forward time past the 3-minute timeout
    jest.advanceTimersByTime(180000);

    // Second promise should timeout and reject
    await expect(promise2).rejects.toThrow('OAuth timed out');
  });
});
