import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PpcConfigService } from './ppc-config.service';
import { UpdatePpcConfigDto } from './dto/update-ppc-config.dto';

@Controller('ppc/config')
@UseGuards(JwtAuthGuard)
export class PpcConfigController {
  constructor(private readonly ppcConfigService: PpcConfigService) {}

  @Get(':clientId')
  get(@Param('clientId', ParseUUIDPipe) clientId: string) {
    return this.ppcConfigService.getConfig(clientId);
  }

  @Patch(':clientId')
  update(
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Body() dto: UpdatePpcConfigDto,
  ) {
    return this.ppcConfigService.updateConfig(clientId, dto);
  }
}
