import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AiService } from './ai.service';
import { SendCopilotMessageDto } from './dto/send-copilot-message.dto';

const STREAM_ERROR_MESSAGE =
  'The co-pilot is temporarily unavailable. Please try again.';

@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('copilot/message')
  // A handful of requests/minute is plenty for internal team use — guards against a
  // runaway frontend bug or accidental spam racking up Anthropic API costs.
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  async sendMessage(
    @Body() dto: SendCopilotMessageDto,
    @Req() req: Request & { user: { id: string } },
    @Res() res: Response,
  ) {
    // Injecting @Res() (without passthrough) puts Nest in library mode for this
    // handler — we own the response end-to-end from here.
    const { conversationId, message, userContent } =
      await this.aiService.prepareMessage(req.user.id, dto);

    // If the client disconnects (e.g. hits "Stop"), cancel the in-flight Anthropic
    // call too instead of letting it run to completion for nobody. `res.on('close')`
    // reliably reflects a client disconnect; `req.on('close')` does not — the request
    // stream has already fully read a small JSON body by the time our handler runs,
    // so it doesn't fire on abort.
    const controller = new AbortController();
    res.on('close', () => controller.abort());

    res.status(200);
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('X-Conversation-Id', conversationId);
    res.setHeader('Cache-Control', 'no-cache');
    res.flushHeaders?.();

    try {
      for await (const delta of this.aiService.streamReply(
        conversationId,
        message,
        userContent,
        controller.signal,
      )) {
        res.write(JSON.stringify({ type: 'delta', text: delta }) + '\n');
      }
      res.write(JSON.stringify({ type: 'done' }) + '\n');
    } catch {
      res.write(
        JSON.stringify({ type: 'error', message: STREAM_ERROR_MESSAGE }) + '\n',
      );
    } finally {
      res.end();
    }
  }

  @Get('copilot/conversations')
  listConversations(
    @Query('accountId') accountId: string | undefined,
    @Req() req: { user: { id: string } },
  ) {
    return this.aiService.listConversations(req.user.id, accountId);
  }

  @Get('copilot/conversations/:id/messages')
  getConversationMessages(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: { user: { id: string } },
  ) {
    return this.aiService.getConversationMessages(req.user.id, id);
  }

  @Delete('copilot/conversations/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteConversation(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: { user: { id: string } },
  ) {
    await this.aiService.deleteConversation(req.user.id, id);
  }
}
