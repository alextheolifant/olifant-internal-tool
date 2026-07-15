import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SpApiService } from './sp-api.service';

@Controller('sp-api')
export class SpApiController {
  constructor(private readonly spApiService: SpApiService) {}

  @Get('connect/:clientId')
  @UseGuards(JwtAuthGuard)
  async connect(
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Query('marketplace') marketplace: string | undefined,
    @Query('region') region: string | undefined,
  ) {
    const authorizationUrl = await this.spApiService.buildAuthorizationUrl(
      clientId,
      marketplace,
      region,
    );
    return { authorizationUrl };
  }

  // Amazon redirects the seller's browser here directly after consent — no
  // JWT to check; the CSRF `state` param is what proves this is legitimate.
  @Get('callback')
  async callback(
    @Query('spapi_oauth_code') code: string | undefined,
    @Query('selling_partner_id') sellingPartnerId: string | undefined,
    @Query('state') state: string | undefined,
    @Res() res: Response,
  ) {
    const webAppUrl = process.env.WEB_APP_URL ?? 'http://localhost:3000';

    if (!code || !sellingPartnerId || !state) {
      res.redirect(
        `${webAppUrl}/dashboard?sp_connected=0&reason=missing_params`,
      );
      return;
    }

    try {
      const clientId = await this.spApiService.handleCallback(
        code,
        sellingPartnerId,
        state,
      );
      res.redirect(
        `${webAppUrl}/dashboard?sp_connected=1&clientId=${clientId}`,
      );
    } catch {
      res.redirect(
        `${webAppUrl}/dashboard?sp_connected=0&reason=connection_failed`,
      );
    }
  }
}
