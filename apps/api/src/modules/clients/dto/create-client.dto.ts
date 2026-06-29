import { IsEnum, IsString, MinLength } from 'class-validator';

export class CreateClientDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsEnum(['t1', 't2', 't3'])
  tier: 't1' | 't2' | 't3';
}
