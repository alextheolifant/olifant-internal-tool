import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class SbObjectiveDto {
  @IsString()
  campaignName: string;

  @IsEnum(['performance', 'defense', 'ntb'])
  objective: 'performance' | 'defense' | 'ntb';
}

export class HarvestDestinationDto {
  @IsString()
  asin: string;

  @IsString()
  campaignName: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  maxTargets?: number | null;
}

export class UpdatePpcConfigDto {
  @IsOptional()
  @IsEnum(['active', 'frozen'])
  opsStatus?: 'active' | 'frozen';

  @IsOptional()
  @IsNumber()
  @Min(0)
  monthlyAdBudget?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  marginDefault?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  targetAcosDefault?: number | null;

  @IsOptional()
  @IsEnum(['acos', 'tacos'])
  accountTargetMetric?: 'acos' | 'tacos';

  @IsOptional()
  @IsNumber()
  @Min(0)
  accountTargetMetricValue?: number | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  brandTerms?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  ownAsins?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SbObjectiveDto)
  sbObjectives?: SbObjectiveDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HarvestDestinationDto)
  harvestDestinationCampaigns?: HarvestDestinationDto[];

  // Record<ruleName, overrideValue> — validated loosely (object of finite
  // numbers) in the service layer rather than a fixed DTO shape, since the
  // set of overridable rule names belongs to the rule engine (later phase).
  @IsOptional()
  @IsObject()
  thresholdOverrides?: Record<string, number>;

  @IsOptional()
  @IsString()
  standingDirectives?: string | null;

  @IsOptional()
  @IsBoolean()
  conservativeMode?: boolean;
}
