import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { AiService } from './ai.service';
import { DrizzleService } from '../../db/drizzle.service';
import { MetricsService } from '../metrics/metrics.service';

// AiService's constructor eagerly builds a real Anthropic client. Stub it out
// entirely — the real SDK's async credential-file lookup outlives the test
// and trips a Jest "environment torn down" error. mockAnthropicStream is
// shared across tests that need to observe/control the Anthropic call
// (Jest's hoist-safe naming convention lets a jest.mock factory reference a
// variable prefixed "mock").
const mockAnthropicStream = jest.fn();
jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest
    .fn()
    .mockImplementation(() => ({ messages: { stream: mockAnthropicStream } })),
}));

// Default: an empty reply with no usage — enough for tests that only care
// about the steps before the Anthropic call.
function emptyAnthropicStream() {
  return {
    [Symbol.asyncIterator]: async function* () {},
    finalMessage: jest.fn().mockResolvedValue({ usage: undefined }),
  };
}

async function drain<T>(gen: AsyncGenerator<T, void, unknown>): Promise<T[]> {
  const events: T[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

const PENDING = "not connected (client hasn't authorized SP-API access yet)";

function buildMetricsFixture() {
  return {
    from: '2026-06-13',
    to: '2026-07-13',
    clients: [
      {
        id: 'client-real',
        name: 'Ekster Inc',
        tier: 1,
        status: 'Active',
        spend: 5494,
        ppcRev: 15990,
        orgRev: null,
        revenue: null,
        tacos: null,
        organicPct: null,
        acos: 34.3,
        roas: 2.91,
        cpc: 1.12,
        ctr: 0.45,
        cvr: 5.1,
      },
      {
        id: 'client-zero',
        name: 'Ambrosea Organics',
        tier: 3,
        status: 'Onboarding',
        spend: 0,
        ppcRev: 0,
        orgRev: null,
        revenue: null,
        tacos: null,
        organicPct: null,
        acos: 0,
        roas: 0,
        cpc: 0,
        ctr: 0,
        cvr: 0,
      },
    ],
    totals: {
      spend: 5494,
      ppcRev: 15990,
      revenue: null,
      tacos: null,
      organicPct: null,
      acos: 34.3,
      roas: 2.91,
      clientCount: 2,
    },
  };
}

// Minimal chainable Drizzle mock covering only what AiService calls.
function buildDrizzleMock() {
  const findFirst = jest.fn();
  const findMany = jest.fn().mockResolvedValue([]);
  const returning = jest
    .fn()
    .mockResolvedValue([{ id: 'new-conversation-id' }]);
  const values = jest.fn().mockReturnValue({ returning });
  const insert = jest.fn().mockReturnValue({ values });
  const where = jest.fn().mockResolvedValue(undefined);
  const set = jest.fn().mockReturnValue({ where });
  const update = jest.fn().mockReturnValue({ set });

  const deleteReturning = jest
    .fn()
    .mockResolvedValue([{ id: 'deleted-conversation-id' }]);
  const deleteWhere = jest.fn().mockReturnValue({ returning: deleteReturning });
  const del = jest.fn().mockReturnValue({ where: deleteWhere });

  return {
    db: {
      query: {
        copilotConversations: { findFirst },
        copilotMessages: { findMany },
      },
      insert,
      update,
      delete: del,
    },
    _mocks: {
      findFirst,
      findMany,
      returning,
      values,
      insert,
      where,
      set,
      update,
      del,
      deleteWhere,
      deleteReturning,
    },
  };
}

describe('AiService', () => {
  let service: AiService;
  let drizzle: ReturnType<typeof buildDrizzleMock>;
  let metricsService: { getClientMetrics: jest.Mock };

  beforeEach(() => {
    drizzle = buildDrizzleMock();
    metricsService = {
      getClientMetrics: jest.fn().mockResolvedValue(buildMetricsFixture()),
    };
    mockAnthropicStream.mockReset().mockReturnValue(emptyAnthropicStream());
    service = new AiService(
      drizzle as unknown as DrizzleService,
      metricsService as unknown as MetricsService,
    );
  });

  describe('formatContext', () => {
    const call = (accountId: string) =>
      (
        service as unknown as {
          formatContext(a: string, r: unknown, f: string, t: string): string;
        }
      ).formatContext(accountId, buildMetricsFixture(), '2026-06-13', '2026-07-13');

    it('renders the "all clients" snapshot with real metrics as numbers and pending metrics as explicit text', async () => {
      const context = await call('all');

      expect(context).toContain(
        'Olifant Digital agency snapshot for 2026-06-13 to 2026-07-13 (2 clients)',
      );
      // Pending fields must say so explicitly — never a bare null/undefined/0 standing in for missing data.
      expect(context).toContain(`Blended: revenue ${PENDING}`);
      expect(context).toContain(`TACoS ${PENDING}`);
      expect(context).toContain(`organic share ${PENDING}`);
      // Real fields render as actual numbers.
      expect(context).toContain('ad spend $5,494');
      expect(context).toContain('ACoS 34.3%');
      expect(context).toContain('ROAS 2.91');
      expect(context).toContain('- Ekster Inc [Tier 1, Active]:');
      expect(context).toContain(`revenue ${PENDING}`);
      expect(context).toContain('CVR 5.1%');

      expect(context).not.toMatch(/\bnull\b/i);
      expect(context).not.toMatch(/\bundefined\b/i);
    });

    it('renders a single-client snapshot scoped to just that client', async () => {
      const context = await call('client-real');

      expect(context).toContain('Client: Ekster Inc (Olifant Digital account)');
      expect(context).toContain('Tier 1, status Active');
      expect(context).toContain(`Revenue ${PENDING}`);
      expect(context).toContain('PPC $15,990');
      expect(context).toContain(`organic ${PENDING}`);
      expect(context).toContain('Ad spend $5,494');
      expect(context).toContain(`TACoS ${PENDING}`);
      expect(context).toContain('ACoS 34.3%');
      expect(context).toContain('CPC $1.12');
      // Must not leak the other client's data into a single-client context.
      expect(context).not.toContain('Ambrosea Organics');
      expect(context).not.toMatch(/\bnull\b/i);
    });

    it('returns a clear not-found message for an unknown client id instead of throwing or fabricating data', async () => {
      const context = await call('client-does-not-exist');
      expect(context).toBe(
        'No performance data found for the requested client in 2026-06-13 to 2026-07-13.',
      );
    });
  });

  describe('resolveConversation', () => {
    it('creates a new "all clients" conversation (null clientId) when no conversationId is given', async () => {
      const result = await service.resolveConversation('user-1', {
        accountId: 'all',
        message: 'Hi',
      });

      expect(drizzle._mocks.insert).toHaveBeenCalledWith(expect.anything());
      expect(drizzle._mocks.values).toHaveBeenCalledWith({
        clientId: null,
        userId: 'user-1',
      });
      expect(result.conversationId).toBe('new-conversation-id');
      expect(result.isNewConversation).toBe(true);
    });

    it('creates a new client-scoped conversation when accountId is a client id', async () => {
      await service.resolveConversation('user-1', {
        accountId: 'client-real',
        message: 'Hi',
      });
      expect(drizzle._mocks.values).toHaveBeenCalledWith({
        clientId: 'client-real',
        userId: 'user-1',
      });
    });

    it('throws NotFoundException when conversationId does not belong to the requesting user', async () => {
      drizzle._mocks.findFirst.mockResolvedValue(undefined);

      await expect(
        service.resolveConversation('user-1', {
          accountId: 'all',
          conversationId: 'not-mine',
          message: 'Hi',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('recognizes an existing conversation and does not create a new one', async () => {
      drizzle._mocks.findFirst.mockResolvedValue({ id: 'conv-1', userId: 'user-1' });

      const result = await service.resolveConversation('user-1', {
        accountId: 'all',
        conversationId: 'conv-1',
        message: 'Hi',
      });

      expect(result).toEqual({ conversationId: 'conv-1', isNewConversation: false });
      expect(drizzle._mocks.insert).not.toHaveBeenCalled();
    });
  });

  describe('streamReply', () => {
    it('emits history/metrics/context/reasoning steps in order, then delta and done', async () => {
      mockAnthropicStream.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } };
        },
        finalMessage: jest.fn().mockResolvedValue({ usage: undefined }),
      });

      const events = await drain(
        service.streamReply('conv-1', false, { accountId: 'all', message: 'Hi' }, undefined),
      );

      const stepIds = events.filter((e) => e.type === 'step').map((e: any) => `${e.id}:${e.status}`);
      expect(stepIds).toEqual([
        'history:running',
        'history:complete',
        'metrics:running',
        'metrics:complete',
        'context:running',
        'context:complete',
        'reasoning:running',
        'reasoning:complete',
      ]);
      expect(events).toContainEqual({ type: 'delta', text: 'Hi' });
    });

    it('skips the history step for a brand-new conversation', async () => {
      const events = await drain(
        service.streamReply('conv-1', true, { accountId: 'all', message: 'Hi' }, undefined),
      );
      const stepIds = events.filter((e) => e.type === 'step').map((e: any) => e.id);
      expect(stepIds).not.toContain('history');
    });

    it('folds prior turns into the prompt sent to Anthropic as "User: ...\\nCo-pilot: ..." before the new message', async () => {
      // Service queries DESC (newest first) + reverses — mock returns rows in that
      // same DESC order so the reverse produces the chronological order asserted below.
      drizzle._mocks.findMany.mockResolvedValue([
        { role: 'assistant', content: "It's 34.3%." },
        { role: 'user', content: 'What is our ACoS?' },
      ]);

      await drain(
        service.streamReply('conv-1', false, { accountId: 'all', message: 'And ROAS?' }, undefined),
      );

      const sentContent = mockAnthropicStream.mock.calls[0][0].messages[0].content;
      expect(sentContent).toContain('LIVE DATA:');
      expect(sentContent).toContain(
        "User: What is our ACoS?\nCo-pilot: It's 34.3%.",
      );
      expect(sentContent).toContain('User: And ROAS?');
    });

    it('throws ServiceUnavailableException without fabricating context when live-data lookup fails', async () => {
      metricsService.getClientMetrics.mockRejectedValue(
        new Error('ClickHouse is down'),
      );

      await expect(
        drain(service.streamReply('conv-1', true, { accountId: 'all', message: 'Hi' }, undefined)),
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });

  describe('deleteConversation', () => {
    it('deletes the conversation scoped to the owning user', async () => {
      await service.deleteConversation('user-1', 'conv-1');

      expect(drizzle._mocks.del).toHaveBeenCalled();
      expect(drizzle._mocks.deleteWhere).toHaveBeenCalledWith(
        expect.anything(),
      );
      expect(drizzle._mocks.deleteReturning).toHaveBeenCalled();
    });

    it("throws NotFoundException when the conversation doesn't exist or isn't the caller's", async () => {
      drizzle._mocks.deleteReturning.mockResolvedValue([]);

      await expect(
        service.deleteConversation('user-1', 'not-mine'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
