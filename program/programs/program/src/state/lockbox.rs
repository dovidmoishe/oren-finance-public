use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct LockBoxState {
    pub owner: Pubkey,
    pub total_deposited: u64,
    pub token_mint: Pubkey,
    pub unlock_time: i64,
    pub bump: u8
}

