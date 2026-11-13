use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("The lock period has not expired yet.")]
    TokenStillLocked,
    #[msg("Deposit amount must be greater than zero.")]
    ZeroAmount,
    #[msg("Total deposited would overflow.")]
    DepositOverflow,
    #[msg("Unlock time must be in the future.")]
    UnlockTimeInPast,
    #[msg("Mints with a transfer hook are not supported.")]
    TransferHookNotSupported,
}
