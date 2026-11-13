use anchor_lang::prelude::*;
pub mod state;
pub mod instructions;
pub use instructions::*;
pub mod error;
pub mod token_extensions;

declare_id!("4yBSLwXvYQhHExDuvuuEsaHfUC392SdRSiM8r6m832Mj");

#[program]
pub mod token_vault_project {
    use super::*;

    pub fn lock_tokens(ctx: Context<LockTokens>, amount: u64, unlock_time: i64) -> Result<()> {
        instructions::lock_tokens::handler(ctx, amount, unlock_time)
    }

    pub fn top_up_vault(ctx: Context<TopUpVault>, amount: u64) -> Result<()> {
        instructions::top_up_vault::handler(ctx, amount)
    }

    pub fn withdraw_tokens(ctx: Context<WithdrawTokens>) -> Result<()> {
        instructions::withdraw_tokens::handler(ctx)
    }
}
