import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AiService } from './ai.service';
import { SendCopilotMessageDto } from './dto/send-copilot-message.dto';

@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('copilot/message')
  @HttpCode(HttpStatus.OK)
  // A handful of requests/minute is plenty for internal team use — guards against a
  // runaway frontend bug or accidental spam racking up Anthropic API costs.
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  sendMessage(@Body() dto: SendCopilotMessageDto, @Req() req: { user: { id: string } }) {
    return this.aiService.sendMessage(req.user.id, dto);
  }

  @Get('copilot/conversations')
  listConversations(@Query('accountId') accountId: string | undefined, @Req() req: { user: { id: string } }) {
    return this.aiService.listConversations(req.user.id, accountId);
  }
}
