import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

export class UpdateClientDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsEnum(['active', 'onboarding', 'paused', 'churned'])
  status?: 'active' | 'onboarding' | 'paused' | 'churned';

  @IsOptional()
  @IsEnum(['t1', 't2', 't3'])
  tier?: 't1' | 't2' | 't3';

  @IsOptional()
  @IsNumber()
  @Min(0)
  targetTacos?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  goalRevenue?: number | null;
}
