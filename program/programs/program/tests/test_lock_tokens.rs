mod common;

use common::{TestContext, INITIAL_MINT_AMOUNT, LOCK_AMOUNT};
use solana_signer::Signer;

#[test]
fn test_lock_tokens_transfers_to_vault_and_initializes_lockbox() {
    let mut ctx = TestContext::new();
    assert_eq!(ctx.user_token_balance(), INITIAL_MINT_AMOUNT);

    let unlock_time = ctx.future_unlock_time(3_600);
    ctx.send_lock_tokens(LOCK_AMOUNT, unlock_time)
        .expect("lock_tokens should succeed");

    let lockbox = ctx.lockbox_state();
    assert_eq!(lockbox.owner, ctx.user.pubkey());
    assert_eq!(lockbox.token_mint, ctx.mint);
    assert_eq!(lockbox.total_deposited, LOCK_AMOUNT);
    assert_eq!(lockbox.unlock_time, unlock_time);

    assert_eq!(
        ctx.user_token_balance(),
        INITIAL_MINT_AMOUNT - LOCK_AMOUNT
    );
    assert_eq!(ctx.vault_balance(), LOCK_AMOUNT);
}

#[test]
fn test_lock_tokens_rejects_zero_amount() {
    let mut ctx = TestContext::new();
    let unlock_time = ctx.future_unlock_time(3_600);

    let result = ctx.send_lock_tokens(0, unlock_time);
    assert!(result.is_err(), "zero-amount lock should fail");
    assert!(result.unwrap_err().contains("ZeroAmount"));
    assert!(!ctx.lockbox_exists());
    assert_eq!(ctx.user_token_balance(), INITIAL_MINT_AMOUNT);
}

#[test]
fn test_lock_tokens_rejects_unlock_time_in_past() {
    let mut ctx = TestContext::new();

    for offset in [0, -1, -3_600] {
        let unlock_time = ctx.future_unlock_time(offset);
        let result = ctx.send_lock_tokens(LOCK_AMOUNT, unlock_time);
        assert!(result.is_err(), "unlock_time now{offset:+} should be rejected");
        assert!(result.unwrap_err().contains("UnlockTimeInPast"));
        ctx.next_blockhash();
    }
    assert!(!ctx.lockbox_exists());
    assert_eq!(ctx.user_token_balance(), INITIAL_MINT_AMOUNT);
}

#[test]
fn test_lock_tokens_rejects_transfer_hook_mint() {
    let mut ctx = TestContext::with_transfer_hook_mint();
    let unlock_time = ctx.future_unlock_time(3_600);

    let result = ctx.send_lock_tokens(LOCK_AMOUNT, unlock_time);
    let error = result.expect_err("hooked mint should be rejected");
    assert!(error.contains("TransferHookNotSupported"), "{error}");
    assert!(!ctx.lockbox_exists());
}
