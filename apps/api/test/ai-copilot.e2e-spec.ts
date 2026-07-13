import { randomUUID } from 'crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { DrizzleService } from '../src/db/drizzle.service';
import { users, copilotConversations, copilotMessages } from '../src/db/schema';

/**
 * Full end-to-end suite for the AI Copilot backend, against a real running
 * Postgres/Redis/ClickHouse (via `pnpm infra:up`) and the real Anthropic API
 * (needs ANTHROPIC_API_KEY in .env). Keeps real Anthropic calls to the
 * minimum needed to prove the integration actually works (send, resume,
 * cancel) — everything else (auth, rate limiting, history, ownership) is
 * exercised without touching the model.
 */
describe('AI Copilot (e2e)', () => {
  jest.setTimeout(60_000);

  let app: INestApplication<App>;
  let drizzle: DrizzleService;
  let jwt: JwtService;
  let baseUrl: string;

  let userId: string;
  let otherUserId: string;
  let token: string;
  let otherToken: string;

  const createdUserIds: string[] = [];

  function mintToken(id: string, email: string): string {
    return jwt.sign({ sub: id, email, role: 'admin' }, { secret: process.env.JWT_SECRET, expiresIn: '15m' });
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
    await app.listen(0);
    const address = app.getHttpServer().address();
    const port = typeof address === 'object' && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;

    drizzle = app.get(DrizzleService);
    jwt = app.get(JwtService);

    const suffix = randomUUID();
    const [user] = await drizzle.db
      .insert(users)
      .values({ email: `e2e-copilot-${suffix}@olifantdigital.com`, passwordHash: 'unused', role: 'admin' })
      .returning();
    const [other] = await drizzle.db
      .insert(users)
      .values({ email: `e2e-copilot-other-${suffix}@olifantdigital.com`, passwordHash: 'unused', role: 'admin' })
      .returning();

    userId = user.id;
    otherUserId = other.id;
    createdUserIds.push(userId, otherUserId);
    token = mintToken(userId, user.email);
    otherToken = mintToken(otherUserId, other.email);
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      // Cascades to copilot_conversations -> copilot_messages.
      await drizzle.db.delete(users).where(eq(users.id, id));
    }
    await app.close();
  });

  it('rejects requests with no auth token', async () => {
    await request(app.getHttpServer())
      .post('/ai/copilot/message')
      .send({ accountId: 'all', message: 'Hello' })
      .expect(401);
  });

  it('rate-limits the message endpoint per user (8/min), independent of other users', async () => {
    // Empty body trips DTO validation (400) before the handler runs — proves
    // the throttle counter increments without spending any Anthropic tokens.
    for (let i = 0; i < 8; i++) {
      await request(app.getHttpServer())
        .post('/ai/copilot/message')
        .set('Authorization', `Bearer ${otherToken}`)
        .send({})
        .expect(400);
    }
    await request(app.getHttpServer())
      .post('/ai/copilot/message')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({})
      .expect(429);

    // A different user, same process, is unaffected — proves per-user (not
    // per-IP) keying, since both requests originate from the same test runner.
    await request(app.getHttpServer())
      .post('/ai/copilot/message')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(400);
  });

  let conversationId: string;

  it('streams a real reply, persists both turns, and records token usage', async () => {
    const res = await request(app.getHttpServer())
      .post('/ai/copilot/message')
      .set('Authorization', `Bearer ${token}`)
      .send({ accountId: 'all', message: 'Reply with exactly the word OK and nothing else.' })
      .expect(200);

    expect(res.headers['content-type']).toContain('application/x-ndjson');
    conversationId = res.headers['x-conversation-id'];
    expect(conversationId).toBeTruthy();

    const lines = (res.text as string).split('\n').filter(Boolean).map((l) => JSON.parse(l) as { type: string });
    expect(lines.some((l) => l.type === 'delta')).toBe(true);
    expect(lines[lines.length - 1].type).toBe('done');

    const [conversation] = await drizzle.db
      .select()
      .from(copilotConversations)
      .where(eq(copilotConversations.id, conversationId));
    expect(conversation.userId).toBe(userId);
    expect(conversation.clientId).toBeNull(); // "all" accountId

    const messages = await drizzle.db
      .select()
      .from(copilotMessages)
      .where(eq(copilotMessages.conversationId, conversationId));
    expect(messages).toHaveLength(2);

    const assistantMsg = messages.find((m) => m.role === 'assistant')!;
    expect(assistantMsg.content.length).toBeGreaterThan(0);
    expect(assistantMsg.inputTokens).toBeGreaterThan(0);
    expect(assistantMsg.outputTokens).toBeGreaterThan(0);

    const userMsg = messages.find((m) => m.role === 'user')!;
    expect(userMsg.inputTokens).toBeNull();
    expect(userMsg.outputTokens).toBeNull();
  });

  it('resumes the same conversation on a follow-up message', async () => {
    const res = await request(app.getHttpServer())
      .post('/ai/copilot/message')
      .set('Authorization', `Bearer ${token}`)
      .send({ accountId: 'all', conversationId, message: 'Reply with exactly the word OK again.' })
      .expect(200);

    expect(res.headers['x-conversation-id']).toBe(conversationId);

    const messages = await drizzle.db
      .select()
      .from(copilotMessages)
      .where(eq(copilotMessages.conversationId, conversationId));
    expect(messages).toHaveLength(4);
  });

  it('lists the conversation with a non-empty preview', async () => {
    const res = await request(app.getHttpServer())
      .get('/ai/copilot/conversations?accountId=all')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const entry = (res.body as Array<{ id: string; accountId: string; preview: string }>).find(
      (c) => c.id === conversationId,
    );
    expect(entry).toBeDefined();
    expect(entry!.accountId).toBe('all');
    expect(entry!.preview.length).toBeGreaterThan(0);
  });

  it('returns the full ordered message history for a conversation', async () => {
    const res = await request(app.getHttpServer())
      .get(`/ai/copilot/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const rows = res.body as Array<{ role: string; createdAt: string }>;
    expect(rows.map((r) => r.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    const timestamps = rows.map((r) => new Date(r.createdAt).getTime());
    expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
  });

  it("404s when a different user requests someone else's conversation", async () => {
    await request(app.getHttpServer())
      .get(`/ai/copilot/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);
  });

  it('deleting a conversation requires ownership and cascades to its messages', async () => {
    // Seeded directly (no Anthropic call needed) — delete only cares about ownership + cascade.
    const [conv] = await drizzle.db
      .insert(copilotConversations)
      .values({ clientId: null, userId })
      .returning();
    await drizzle.db.insert(copilotMessages).values([
      { conversationId: conv.id, role: 'user', content: 'test' },
      { conversationId: conv.id, role: 'assistant', content: 'test reply' },
    ]);

    // A different user can't delete it.
    await request(app.getHttpServer())
      .delete(`/ai/copilot/conversations/${conv.id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);

    const stillThere = await drizzle.db
      .select()
      .from(copilotConversations)
      .where(eq(copilotConversations.id, conv.id));
    expect(stillThere).toHaveLength(1);

    // The owner can.
    await request(app.getHttpServer())
      .delete(`/ai/copilot/conversations/${conv.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    const conversationRows = await drizzle.db
      .select()
      .from(copilotConversations)
      .where(eq(copilotConversations.id, conv.id));
    expect(conversationRows).toHaveLength(0);

    const messageRows = await drizzle.db
      .select()
      .from(copilotMessages)
      .where(eq(copilotMessages.conversationId, conv.id));
    expect(messageRows).toHaveLength(0);

    // Deleting again (already gone) is a 404, not a silent success.
    await request(app.getHttpServer())
      .delete(`/ai/copilot/conversations/${conv.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('stopping generation mid-stream persists the partial reply instead of discarding it', async () => {
    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/ai/copilot/message`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountId: 'all',
        message: 'Write two full paragraphs about Amazon PPC strategy.',
      }),
      signal: controller.signal,
    });

    const cancelledConversationId = res.headers.get('X-Conversation-Id');
    expect(cancelledConversationId).toBeTruthy();

    const reader = res.body!.getReader();
    await reader.read(); // wait for the first real chunk, then cut it off
    controller.abort();
    await reader.cancel().catch(() => {});

    // Persistence happens asynchronously right after the abort is observed
    // server-side — poll briefly rather than asserting on a fixed delay.
    let assistantMsg: { content: string } | undefined;
    for (let attempt = 0; attempt < 15; attempt++) {
      const rows = await drizzle.db
        .select()
        .from(copilotMessages)
        .where(eq(copilotMessages.conversationId, cancelledConversationId!));
      assistantMsg = rows.find((m) => m.role === 'assistant');
      if (assistantMsg) break;
      await new Promise((r) => setTimeout(r, 300));
    }

    expect(assistantMsg).toBeDefined();
    expect(assistantMsg!.content.length).toBeGreaterThan(0);
  });
});
