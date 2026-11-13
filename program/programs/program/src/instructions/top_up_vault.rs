use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};
use crate::{error::ErrorCode, state::LockBoxState};

#[derive(Accounts)]
pub struct TopUpVault<'info> {
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
        mut,
        seeds = [b"lockbox", user.key().as_ref(), token_mint.key().as_ref()],
        bump = lockbox.bump,
        constraint = lockbox.owner == user.key(),
        has_one = token_mint,
    )]
    pub lockbox: Account<'info, LockBoxState>,

    #[account(
        mut,
        token::mint = token_mint,
        token::authority = lockbox,
        seeds = [b"token_vault", lockbox.key().as_ref()],
        bump,
    )]
    pub token_vault: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<TopUpVault>, amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::ZeroAmount);

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

    // Count what the vault received (Token-2022 transfer fees).
    ctx.accounts.token_vault.reload()?;
    let received = ctx
        .accounts
        .token_vault
        .amount
        .checked_sub(vault_before)
        .ok_or(ErrorCode::DepositOverflow)?;
    require!(received > 0, ErrorCode::ZeroAmount);

    let lockbox = &mut ctx.accounts.lockbox;
    lockbox.total_deposited = lockbox
        .total_deposited
        .checked_add(received)
        .ok_or(ErrorCode::DepositOverflow)?;

    msg!(
        "Topped up vault with {} tokens; total deposited: {}",
        received,
        lockbox.total_deposited
    );
    Ok(())
}
