import {
  Body,
  Controller,
  Delete,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ProductEconomicsService } from './product-economics.service';
import {
  CreateProductEconomicsDto,
  UpdateProductEconomicsDto,
} from './dto/product-economics.dto';

@Controller('ppc/config')
@UseGuards(JwtAuthGuard)
export class ProductEconomicsController {
  constructor(
    private readonly productEconomicsService: ProductEconomicsService,
  ) {}

  @Post(':clientId/products')
  create(
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Body() dto: CreateProductEconomicsDto,
  ) {
    return this.productEconomicsService.create(clientId, dto);
  }

  @Patch('products/:id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductEconomicsDto,
  ) {
    return this.productEconomicsService.update(id, dto);
  }

  @Delete('products/:id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.productEconomicsService.remove(id);
  }
}
