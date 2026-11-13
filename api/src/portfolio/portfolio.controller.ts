import { Controller, Get, Headers, Param, Query } from '@nestjs/common';
import type {
  GetPortfolioActivityResponse,
  GetPortfolioCalendarDayResponse,
  GetPortfolioCalendarQuery,
  GetPortfolioCalendarResponse,
  GetPortfolioHistoryResponse,
  GetPortfolioResponse,
} from '../../types/api';
import { PrivyWalletAuth } from '../auth/privy-wallet-auth';
import { WalletAddressPipe } from '../common/pipes/wallet-address.pipe';
import { PortfolioCalendarService } from './portfolio-calendar.service';
import { PortfolioService } from './portfolio.service';

@Controller('portfolio')
export class PortfolioController {
  constructor(
    private readonly portfolio: PortfolioService,
    private readonly calendar: PortfolioCalendarService,
    private readonly auth: PrivyWalletAuth,
  ) {}

  /** Balances mirror public on-chain state; the routes below hold Oren-only data. */
  @Get(':wallet')
  getPortfolio(
    @Param('wallet', WalletAddressPipe) wallet: string,
  ): Promise<GetPortfolioResponse> {
    return this.portfolio.getPortfolio(wallet);
  }

  @Get(':wallet/history')
  async getHistory(
    @Headers('authorization') authorization: string | undefined,
    @Param('wallet', WalletAddressPipe) wallet: string,
  ): Promise<GetPortfolioHistoryResponse> {
    await this.auth.requireWallet(authorization, wallet);
    return this.portfolio.getHistory(wallet);
  }

  @Get(':wallet/activity')
  async getActivity(
    @Headers('authorization') authorization: string | undefined,
    @Param('wallet', WalletAddressPipe) wallet: string,
  ): Promise<GetPortfolioActivityResponse> {
    await this.auth.requireWallet(authorization, wallet);
    return this.portfolio.getActivity(wallet);
  }

  @Get(':wallet/calendar')
  async getCalendar(
    @Headers('authorization') authorization: string | undefined,
    @Param('wallet', WalletAddressPipe) wallet: string,
    @Query() query: GetPortfolioCalendarQuery,
  ): Promise<GetPortfolioCalendarResponse> {
    await this.auth.requireWallet(authorization, wallet);
    return this.calendar.getCalendar(wallet, query);
  }

  @Get(':wallet/calendar/:date')
  async getCalendarDay(
    @Headers('authorization') authorization: string | undefined,
    @Param('wallet', WalletAddressPipe) wallet: string,
    @Param('date') date: string,
    @Query() query: Pick<GetPortfolioCalendarQuery, 'timeZone'>,
  ): Promise<GetPortfolioCalendarDayResponse> {
    await this.auth.requireWallet(authorization, wallet);
    return this.calendar.getDay(wallet, date, query);
  }
}
