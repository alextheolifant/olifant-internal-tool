import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class SendCopilotMessageDto {
  @IsString()
  @MinLength(1)
  accountId!: string; // client id (uuid) or the literal string "all"

  @IsOptional()
  @IsUUID()
  conversationId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  message!: string;
}
