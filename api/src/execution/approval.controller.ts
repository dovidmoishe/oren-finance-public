import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  Equals,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApprovalService, type ApprovalKind } from './approval.service';
class PrepareApprovalDto {
  @IsIn(['swap', 'limit', 'cancel']) kind!: ApprovalKind;
  @IsString() @MinLength(1) @MaxLength(120) referenceId!: string;
  @IsString() @MinLength(32) @MaxLength(44) wallet!: string;
}
class ConfirmApprovalDto {
  @Equals(true) approved!: true;
  @IsOptional()
  @IsString()
  @MinLength(40)
  @MaxLength(256)
  @Matches(/^[A-Za-z0-9+/]+={0,2}$/)
  authorizationSignature?: string;
}
@Controller('execution/approvals')
export class ApprovalController {
  constructor(private readonly approvals: ApprovalService) {}
  @Post()
  prepare(
    @Headers('authorization') auth: string | undefined,
    @Body() body: PrepareApprovalDto,
  ) {
    return this.approvals.prepare(auth, body);
  }
  @Post(':id/approve')
  approve(
    @Headers('authorization') auth: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ConfirmApprovalDto,
  ) {
    if (body.approved !== true)
      throw new BadRequestException('Explicit approval is required');
    return this.approvals.approve(auth, id, body.authorizationSignature);
  }
  @Get(':id/authorization')
  authorizationRequest(
    @Headers('authorization') auth: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.approvals.authorizationRequest(auth, id);
  }
  @Get('pending/:wallet')
  pending(
    @Headers('authorization') auth: string | undefined,
    @Param('wallet') wallet: string,
  ) {
    return this.approvals.pending(auth, wallet);
  }
  @Get(':id')
  status(
    @Headers('authorization') auth: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.approvals.status(auth, id);
  }
}
