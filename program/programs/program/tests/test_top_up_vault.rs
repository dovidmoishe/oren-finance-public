mod common;

use common::{TestContext, INITIAL_MINT_AMOUNT, LOCK_AMOUNT};

#[test]
fn test_top_up_vault_adds_tokens_without_changing_unlock_time() {
    let mut ctx = TestContext::new();
    let unlock_time = ctx.future_unlock_time(3_600);

    ctx.send_lock_tokens(LOCK_AMOUNT, unlock_time)
        .expect("lock_tokens should succeed");

    let top_up_amount = LOCK_AMOUNT / 2;
    ctx.send_top_up_vault(top_up_amount)
        .expect("top_up_vault should succeed");

    let lockbox = ctx.lockbox_state();
    assert_eq!(lockbox.total_deposited, LOCK_AMOUNT + top_up_amount);
    assert_eq!(lockbox.unlock_time, unlock_time);

    assert_eq!(
        ctx.user_token_balance(),
        INITIAL_MINT_AMOUNT - LOCK_AMOUNT - top_up_amount
    );
    assert_eq!(ctx.vault_balance(), LOCK_AMOUNT + top_up_amount);
}

#[test]
fn test_top_up_vault_rejects_zero_amount() {
    let mut ctx = TestContext::new();
    let unlock_time = ctx.future_unlock_time(3_600);

    ctx.send_lock_tokens(LOCK_AMOUNT, unlock_time)
        .expect("lock_tokens should succeed");

    let err = ctx
        .send_top_up_vault(0)
        .expect_err("top_up_vault should reject zero amount");
    assert!(err.contains("ZeroAmount"), "expected ZeroAmount error, got: {err}");
}
