import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { DrizzleService } from '../../db/drizzle.service';
import { MetricsService } from '../metrics/metrics.service';
import { copilotConversations, copilotMessages } from '../../db/schema';
import { SendCopilotMessageDto } from './dto/send-copilot-message.dto';

const COPILOT_MODEL = 'claude-sonnet-4-6';

export const COPILOT_SYSTEM_PROMPT =
  "You are the Olifant Digital Co-pilot — a senior Amazon PPC and e-commerce performance strategist embedded in the agency's client dashboard. You have the client's live performance data below. Always answer using the actual numbers; be specific, concise, and immediately actionable. Olifant's methodology is TACoS-first: judge accounts on total ad efficiency against total revenue, and treat rising organic share at flat or falling TACoS as the goal — not just a low ACoS. Write in tight, skimmable sections with short bullets and concrete next steps. Never invent metrics you weren't given. Speak like a sharp operator, not a chatbot.";

const SP_API_PENDING =
  'not yet available (Amazon SP-API integration in progress)';

interface TokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
}

interface ClientMetricRow {
  id: string;
  name: string;
  tier: number;
  status: string;
  spend: number;
  ppcRev: number;
  orgRev: null;
  revenue: number | null;
  tacos: number | null;
  organicPct: number | null;
  acos: number;
  roas: number;
  cpc: number;
  ctr: number;
  cvr: number;
}

interface ClientMetricsResult {
  from: string;
  to: string;
  clients: ClientMetricRow[];
  totals: {
    spend: number;
    ppcRev: number;
    revenue: number | null;
    tacos: number | null;
    organicPct: number | null;
    acos: number;
    roas: number;
    clientCount: number;
  };
}

function money(value: number | null): string {
  return value === null
    ? SP_API_PENDING
    : `$${Math.round(value).toLocaleString('en-US')}`;
}

function pct(value: number | null): string {
  return value === null ? SP_API_PENDING : `${value.toFixed(1)}%`;
}

function ratio(value: number | null): string {
  return value === null ? SP_API_PENDING : value.toFixed(2);
}

function defaultDateRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 30);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly anthropic: Anthropic;

  constructor(
    private readonly drizzle: DrizzleService,
    private readonly metricsService: MetricsService,
  ) {
    // ANTHROPIC_API_KEY is read from env by the SDK — never hardcoded, never sent to the frontend.
    this.anthropic = new Anthropic();
  }

  private async buildCopilotContext(
    accountId: string,
    from: string,
    to: string,
  ): Promise<string> {
    // Reuses the exact aggregation the /metrics/clients endpoint uses — no separate query path.
    const result = (await this.metricsService.getClientMetrics(
      from,
      to,
    )) as ClientMetricsResult;
    const period = `${from} to ${to}`;

    if (accountId === 'all') {
      const t = result.totals;
      const lines = result.clients.map(
        (c) =>
          `- ${c.name} [Tier ${c.tier}, ${c.status}]: revenue ${money(c.revenue)}, spend ${money(c.spend)}, TACoS ${pct(c.tacos)}, ACoS ${pct(c.acos)}, ROAS ${ratio(c.roas)}, organic ${pct(c.organicPct)}, CVR ${c.cvr.toFixed(1)}%.`,
      );
      return [
        `Olifant Digital agency snapshot for ${period} (${t.clientCount} clients).`,
        `Blended: revenue ${money(t.revenue)}, ad spend ${money(t.spend)}, TACoS ${pct(t.tacos)}, ACoS ${pct(t.acos)}, ROAS ${ratio(t.roas)}, organic share ${pct(t.organicPct)}.`,
        '',
        'Per client:',
        ...lines,
      ].join('\n');
    }

    const client = result.clients.find((c) => c.id === accountId);
    if (!client) {
      return `No performance data found for the requested client in ${period}.`;
    }
    return [
      `Client: ${client.name} (Olifant Digital account). Figures for ${period}.`,
      `Tier ${client.tier}, status ${client.status}.`,
      `Revenue ${money(client.revenue)} — PPC ${money(client.ppcRev)} / organic ${money(client.orgRev)} (organic ${pct(client.organicPct)}). Ad spend ${money(client.spend)}. TACoS ${pct(client.tacos)}. ACoS ${pct(client.acos)}. ROAS ${ratio(client.roas)}. CVR ${client.cvr.toFixed(1)}%. CPC $${client.cpc.toFixed(2)}. CTR ${client.ctr.toFixed(1)}%.`,
    ].join('\n');
  }

  /**
   * Resolves the conversation and builds the full prompt. Runs before any bytes
   * are written to the response, so failures here still produce a normal Nest
   * JSON error response instead of a mid-stream one.
   */
  async prepareMessage(
    userId: string,
    dto: SendCopilotMessageDto,
  ): Promise<{ conversationId: string; message: string; userContent: string }> {
    const { accountId, message } = dto;
    let conversationId = dto.conversationId;
    let priorTurns: { role: string; content: string }[] = [];

    if (conversationId) {
      const conversation =
        await this.drizzle.db.query.copilotConversations.findFirst({
          where: and(
            eq(copilotConversations.id, conversationId),
            eq(copilotConversations.userId, userId),
          ),
        });
      if (!conversation) throw new NotFoundException('Conversation not found');

      const rows = await this.drizzle.db.query.copilotMessages.findMany({
        where: eq(copilotMessages.conversationId, conversationId),
        orderBy: (m, { asc: ascOrder }) => [ascOrder(m.createdAt)],
      });
      priorTurns = rows.map((r) => ({ role: r.role, content: r.content }));
    } else {
      const [conversation] = await this.drizzle.db
        .insert(copilotConversations)
        .values({
          clientId: accountId === 'all' ? null : accountId,
          userId,
        })
        .returning();
      conversationId = conversation.id;
    }

    const { from, to } = defaultDateRange();
    let context: string;
    try {
      context = await this.buildCopilotContext(accountId, from, to);
    } catch (err) {
      this.logger.error(
        'Failed to build copilot context',
        err instanceof Error ? err.stack : err,
      );
      throw new ServiceUnavailableException(
        'The co-pilot is temporarily unavailable. Please try again.',
      );
    }

    const priorTurnsText = priorTurns
      .map((t) => `${t.role === 'user' ? 'User' : 'Co-pilot'}: ${t.content}`)
      .join('\n');

    const userContent = [
      `LIVE DATA:\n${context}`,
      priorTurnsText,
      `User: ${message}`,
    ]
      .filter(Boolean)
      .join('\n\n');

    return { conversationId, message, userContent };
  }

  /**
   * Streams the reply as it's generated. Persists the user + assistant turn once
   * streaming finishes — including a partial assistant reply if the client stopped
   * generation mid-stream, but nothing at all on a genuine Anthropic failure.
   */
  async *streamReply(
    conversationId: string,
    message: string,
    userContent: string,
    signal: AbortSignal | undefined,
  ): AsyncGenerator<string, void, unknown> {
    let reply = '';
    let usage: TokenUsage = { inputTokens: null, outputTokens: null };
    try {
      const stream = this.anthropic.messages.stream(
        {
          model: COPILOT_MODEL,
          max_tokens: 4096,
          system: COPILOT_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userContent }],
        },
        { signal },
      );

      for await (const event of stream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          reply += event.delta.text;
          yield event.delta.text;
        }
      }

      const finalMessage = await stream.finalMessage();
      if (finalMessage.usage) {
        usage = {
          inputTokens: finalMessage.usage.input_tokens,
          outputTokens: finalMessage.usage.output_tokens,
        };
        this.logger.log(
          `copilot message usage — input: ${usage.inputTokens}, output: ${usage.outputTokens}`,
        );
      }
    } catch (err) {
      if (signal?.aborted) {
        // Client hit "Stop" — persist whatever the user actually saw, then stop.
        // The stream's partial usage (if any) is captured on abort via getUsage().
        this.logger.log(
          `Copilot message generation stopped by client (conversation ${conversationId})`,
        );
        if (reply)
          await this.persistTurn(conversationId, message, reply, usage);
        return;
      }
      this.logger.error(
        'Anthropic API call failed',
        err instanceof Error ? err.stack : err,
      );
      // Do not persist a broken assistant message — the frontend has its own fallback UI.
      throw new ServiceUnavailableException(
        'The co-pilot is temporarily unavailable. Please try again.',
      );
    }

    await this.persistTurn(conversationId, message, reply, usage);
  }

  private async persistTurn(
    conversationId: string,
    message: string,
    reply: string,
    usage: TokenUsage,
  ): Promise<void> {
    await this.drizzle.db.insert(copilotMessages).values([
      { conversationId, role: 'user', content: message },
      {
        conversationId,
        role: 'assistant',
        content: reply,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      },
    ]);
    await this.drizzle.db
      .update(copilotConversations)
      .set({ updatedAt: new Date() })
      .where(eq(copilotConversations.id, conversationId));
  }

  async listConversations(userId: string, accountId?: string) {
    const conditions = [eq(copilotConversations.userId, userId)];
    if (accountId === 'all') {
      conditions.push(isNull(copilotConversations.clientId));
    } else if (accountId) {
      conditions.push(eq(copilotConversations.clientId, accountId));
    }

    const conversations =
      await this.drizzle.db.query.copilotConversations.findMany({
        where: and(...conditions),
        orderBy: (c, { desc }) => [desc(c.updatedAt)],
      });

    return Promise.all(
      conversations.map(async (c) => {
        const firstMessage =
          await this.drizzle.db.query.copilotMessages.findFirst({
            where: and(
              eq(copilotMessages.conversationId, c.id),
              eq(copilotMessages.role, 'user'),
            ),
            orderBy: (m) => [asc(m.createdAt)],
          });
        return {
          id: c.id,
          accountId: c.clientId ?? 'all',
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
          preview: firstMessage?.content.slice(0, 140) ?? '',
        };
      }),
    );
  }

  async getConversationMessages(userId: string, conversationId: string) {
    const conversation =
      await this.drizzle.db.query.copilotConversations.findFirst({
        where: and(
          eq(copilotConversations.id, conversationId),
          eq(copilotConversations.userId, userId),
        ),
      });
    if (!conversation) throw new NotFoundException('Conversation not found');

    const rows = await this.drizzle.db.query.copilotMessages.findMany({
      where: eq(copilotMessages.conversationId, conversationId),
      orderBy: (m, { asc: ascOrder }) => [ascOrder(m.createdAt)],
    });

    return rows.map((r) => ({
      id: r.id,
      role: r.role,
      content: r.content,
      createdAt: r.createdAt,
    }));
  }
}
