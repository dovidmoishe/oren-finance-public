use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface, TransferChecked, transfer_checked};
use crate::{error::ErrorCode, state::LockBoxState, token_extensions};

#[derive(Accounts)]
pub struct LockTokens<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    pub token_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        token::mint = token_mint,
        token::authority = user,
    )]
    pub user_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init,
        payer = user,
        space = 8 + LockBoxState::INIT_SPACE,
        seeds = [b"lockbox", user.key().as_ref(), token_mint.key().as_ref()],
        bump
    )]
    pub lockbox: Account<'info, LockBoxState>,

    // init_if_needed: a withdraw leaves the vault open only when Token-2022
    // withheld transfer fees stop it from closing; the next lock reuses it.
    #[account(
        init_if_needed,
        payer = user,
        token::mint = token_mint,
        token::authority = lockbox,
        token::token_program = token_program,
        seeds = [b"token_vault", lockbox.key().as_ref()],
        bump
    )]
    pub token_vault: InterfaceAccount<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<LockTokens>, amount: u64, unlock_time: i64) -> Result<()> {
    require!(amount > 0, ErrorCode::ZeroAmount);
    require!(
        unlock_time > Clock::get()?.unix_timestamp,
        ErrorCode::UnlockTimeInPast
    );
    require!(
        !token_extensions::has_transfer_hook(&ctx.accounts.token_mint.to_account_info())?,
        ErrorCode::TransferHookNotSupported
    );

    let vault_before = ctx.accounts.token_vault.amount;
    let cpi_program = ctx.accounts.token_program.key();
    let cpi_accounts = TransferChecked {
        from: ctx.accounts.user_token_account.to_account_info(),
        mint: ctx.accounts.token_mint.to_account_info(),
        to: ctx.accounts.token_vault.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };
    
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
    transfer_checked(cpi_ctx, amount, ctx.accounts.token_mint.decimals)?;

    // Count what the vault received, not what was sent: Token-2022 transfer
    // fees would otherwise overstate the deposit.
    ctx.accounts.token_vault.reload()?;
    let received = ctx
        .accounts
        .token_vault
        .amount
        .checked_sub(vault_before)
        .ok_or(ErrorCode::DepositOverflow)?;
    require!(received > 0, ErrorCode::ZeroAmount);

    let lockbox = &mut ctx.accounts.lockbox;
    lockbox.owner = ctx.accounts.user.key();
    lockbox.token_mint = ctx.accounts.token_mint.key();
    lockbox.unlock_time = unlock_time;
    lockbox.bump = ctx.bumps.lockbox;
    lockbox.total_deposited = received;

    msg!("Successfully locked {} tokens until timestamp {}", received, unlock_time);
    Ok(())
}
