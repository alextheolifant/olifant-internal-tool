import { Controller, Get, Logger, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdsApiService } from './ads-api.service';

@Controller('ads-api')
export class AdsApiController {
  private readonly logger = new Logger(AdsApiController.name);

  constructor(private readonly adsApiService: AdsApiService) {}

  @Get('connect')
  @UseGuards(JwtAuthGuard)
  async connect(@Req() req: Request & { user: { id: string } }) {
    return this.adsApiService.buildAuthorizationUrl(req.user.id);
  }

  @Get('status')
  @UseGuards(JwtAuthGuard)
  async status(@Req() req: Request & { user: { id: string } }) {
    return this.adsApiService.listManagerAccounts(req.user.id);
  }

  // Amazon redirects the dashboard user's browser here directly after
  // consent — no JWT to check; the CSRF `state` param is what proves this
  // is legitimate. The person completing this is always an already
  // authenticated internal user (unlike SP-API's external-seller flow), so
  // this redirects back into the dashboard, not a public confirmation page.
  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ) {
    const webAppUrl = process.env.WEB_APP_URL ?? 'http://localhost:3000';

    if (error) {
      this.logger.error(`callback received an error from Amazon: ${error}`);
      res.redirect(`${webAppUrl}/dashboard/settings?ads_connected=0&reason=user_declined`);
      return;
    }

    if (!code || !state) {
      this.logger.error(
        `callback missing required params: code=${!!code} state=${!!state}`,
      );
      res.redirect(`${webAppUrl}/dashboard/settings?ads_connected=0&reason=missing_params`);
      return;
    }

    try {
      await this.adsApiService.handleCallback(code, state);
      res.redirect(`${webAppUrl}/dashboard/settings?ads_connected=1`);
    } catch (err) {
      this.logger.error(
        `callback failed: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      res.redirect(`${webAppUrl}/dashboard/settings?ads_connected=0&reason=connection_failed`);
    }
  }
}
