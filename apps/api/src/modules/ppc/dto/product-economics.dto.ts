import { IsDateString, IsEnum, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

const STRATEGIES = ['launch', 'growth', 'maintain'] as const;
export type PpcStrategy = (typeof STRATEGIES)[number];

export class CreateProductEconomicsDto {
  @IsString()
  @MinLength(1)
  asin: string;

  @IsOptional()
  @IsString()
  productName?: string;

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
  @IsString()
  productName?: string | null;

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
