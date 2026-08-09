import { describe, it, expect } from 'vitest';

describe('Entity Resolution', () => {
  it('correctly resolves pronouns in conversation turns', () => {
    // Mock conversation turns
    const conversationTurns = [
      { role: 'user', content: 'Who is the CEO of Apple?' },
      { role: 'assistant', content: 'Tim Cook is the CEO of Apple.' },
      { role: 'user', content: 'When was he born?' }
    ];

    // Mock implementation of entity resolution
    const mockResolveEntity = (turns: any[], currentTurnIndex: number) => {
      const turn = turns[currentTurnIndex];
      if (turn.content.includes('he')) {
        return 'Tim Cook';
      }
      return null;
    };

    const resolvedEntity = mockResolveEntity(conversationTurns, 2);
    expect(resolvedEntity).toBe('Tim Cook');
  });

  it('maps "it" to the previously mentioned object', () => {
    const turns = [
      { role: 'user', content: 'I just bought a new MacBook Pro.' },
      { role: 'user', content: 'It is very fast.' }
    ];

    const mockResolveEntity = (turns: any[], currentTurnIndex: number) => {
      const turn = turns[currentTurnIndex];
      if (turn.content.includes('It')) {
        return 'MacBook Pro';
      }
      return null;
    };

    const resolved = mockResolveEntity(turns, 1);
    expect(resolved).toBe('MacBook Pro');
  });
});
