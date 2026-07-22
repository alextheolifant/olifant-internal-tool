import {
  Controller,
  Get,
  Logger,
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
  private readonly logger = new Logger(SpApiController.name);

  constructor(private readonly spApiService: SpApiService) {}

  @Get('connect/:clientId')
  @UseGuards(JwtAuthGuard)
  async connect(
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Query('region') region: string | undefined,
  ) {
    return this.spApiService.buildAuthorizationUrl(clientId, region);
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
      this.logger.error(
        `callback missing required params: code=${!!code} sellingPartnerId=${!!sellingPartnerId} state=${!!state}`,
      );
      res.redirect(
        `${webAppUrl}/sp-api/connected?status=error&reason=missing_params`,
      );
      return;
    }

    try {
      await this.spApiService.handleCallback(code, sellingPartnerId, state);
      res.redirect(`${webAppUrl}/sp-api/connected?status=success`);
    } catch (err) {
      this.logger.error(
        `callback failed: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      res.redirect(
        `${webAppUrl}/sp-api/connected?status=error&reason=connection_failed`,
      );
    }
  }
}
