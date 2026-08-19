import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

const STRATEGIES = ['launch', 'growth', 'maintain'] as const;
export type PpcStrategy = (typeof STRATEGIES)[number];

// productName is deliberately absent from both DTOs — it's system-owned,
// populated only by the SP-API listings sync (services/sync-sp-api) writing
// directly to Postgres, never editable through this API. See
// ProductEconomicsResponse / catalog_items in schema.ts.

export class CreateProductEconomicsDto {
  @IsString()
  @MinLength(1)
  asin: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  margin?: number | null;

  @IsOptional()
  @IsEnum(STRATEGIES)
  strategy?: PpcStrategy | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  targetAcos?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  targetTacos?: number | null;

  @IsOptional()
  @IsDateString()
  launchUntil?: string | null;
}

export class UpdateProductEconomicsDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  margin?: number | null;

  @IsOptional()
  @IsEnum(STRATEGIES)
  strategy?: PpcStrategy | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  targetAcos?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  targetTacos?: number | null;

  @IsOptional()
  @IsDateString()
  launchUntil?: string | null;
}
