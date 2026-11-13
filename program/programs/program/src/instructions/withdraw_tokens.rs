use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    close_account, transfer_checked, CloseAccount, Mint, TokenAccount, TokenInterface,
    TransferChecked,
};
use crate::{error::ErrorCode, state::LockBoxState, token_extensions};

#[derive(Accounts)]
pub struct WithdrawTokens<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    pub token_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        token::mint = token_mint,
        token::authority = user,
    )]
    pub user_token_account: InterfaceAccount<'info, TokenAccount>,

    // Closed on withdraw so a fresh lock can start and no top-up can land in
    // an expired lock. Rent goes back to the user.
    #[account(
        mut,
        close = user,
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

pub fn handler(ctx: Context<WithdrawTokens>) -> Result<()> {
    let current_time = Clock::get()?.unix_timestamp;
    let lockbox = &ctx.accounts.lockbox;

    require!(current_time >= lockbox.unlock_time, ErrorCode::TokenStillLocked);

    let user_key = ctx.accounts.user.key();
    let mint_key = ctx.accounts.token_mint.key();
    let signer_seeds: &[&[u8]] = &[
        b"lockbox",
        user_key.as_ref(),
        mint_key.as_ref(),
        &[lockbox.bump],
    ];
    let signer_wrapper = &[signer_seeds];

    let cpi_program = ctx.accounts.token_program.key();
    let amount_to_withdraw = ctx.accounts.token_vault.amount;
    if amount_to_withdraw > 0 {
        let cpi_accounts = TransferChecked {
            from: ctx.accounts.token_vault.to_account_info(),
            mint: ctx.accounts.token_mint.to_account_info(),
            to: ctx.accounts.user_token_account.to_account_info(),
            authority: ctx.accounts.lockbox.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_wrapper);
        transfer_checked(cpi_ctx, amount_to_withdraw, ctx.accounts.token_mint.decimals)?;
    }

    // Close the empty vault and refund its rent. Token-2022 refuses to close
    // an account holding withheld transfer fees; failing here would strand the
    // withdraw, so that vault stays open and the next lock reuses it.
    let vault_info = ctx.accounts.token_vault.to_account_info();
    if token_extensions::withheld_transfer_fees(&vault_info)? == 0 {
        let cpi_accounts = CloseAccount {
            account: vault_info,
            destination: ctx.accounts.user.to_account_info(),
            authority: ctx.accounts.lockbox.to_account_info(),
        };
        close_account(CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_wrapper))?;
    } else {
        msg!("Vault holds withheld transfer fees; leaving it open for reuse");
    }

    msg!("Tokens unlocked and returned successfully!");
    Ok(())
}
