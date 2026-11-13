mod common;

use common::{TestContext, INITIAL_MINT_AMOUNT, LOCK_AMOUNT};

#[test]
fn test_withdraw_rejects_before_unlock_time() {
    let mut ctx = TestContext::new();
    let unlock_time = ctx.future_unlock_time(3_600);

    ctx.send_lock_tokens(LOCK_AMOUNT, unlock_time)
        .expect("lock_tokens should succeed");

    let result = ctx.send_withdraw_tokens();
    assert!(result.is_err(), "withdraw should fail while tokens are locked");
    assert_eq!(ctx.vault_balance(), LOCK_AMOUNT);
    assert_eq!(
        ctx.user_token_balance(),
        INITIAL_MINT_AMOUNT - LOCK_AMOUNT
    );
}

#[test]
fn test_withdraw_returns_tokens_after_unlock_time() {
    let mut ctx = TestContext::new();
    let unlock_time = ctx.future_unlock_time(3_600);

    ctx.send_lock_tokens(LOCK_AMOUNT, unlock_time)
        .expect("lock_tokens should succeed");

    ctx.warp_past_unlock(unlock_time);

    ctx.send_withdraw_tokens()
        .expect("withdraw should succeed after unlock time");

    assert_eq!(ctx.user_token_balance(), INITIAL_MINT_AMOUNT);
    assert!(!ctx.vault_exists(), "withdraw should close the token vault");
    assert!(!ctx.lockbox_exists(), "withdraw should close the lockbox");
}

#[test]
fn test_withdraw_refunds_rent_to_user() {
    let mut ctx = TestContext::new();
    let unlock_time = ctx.future_unlock_time(3_600);
    let lamports_before_lock = ctx.user_lamports();

    ctx.send_lock_tokens(LOCK_AMOUNT, unlock_time)
        .expect("lock_tokens should succeed");
    let lamports_while_locked = ctx.user_lamports();

    ctx.warp_past_unlock(unlock_time);
    ctx.send_withdraw_tokens()
        .expect("withdraw should succeed after unlock time");

    let lamports_after = ctx.user_lamports();
    assert!(lamports_after > lamports_while_locked);
    // Only the two transaction fees are spent; both rent deposits come back.
    assert!(lamports_before_lock - lamports_after < 20_000);
}

#[test]
fn test_lock_again_after_withdraw() {
    let mut ctx = TestContext::new();
    let unlock_time = ctx.future_unlock_time(3_600);

    ctx.send_lock_tokens(LOCK_AMOUNT, unlock_time)
        .expect("first lock should succeed");
    ctx.warp_past_unlock(unlock_time);
    ctx.send_withdraw_tokens()
        .expect("withdraw should succeed after unlock time");

    let second_unlock = ctx.future_unlock_time(7_200);
    ctx.next_blockhash();
    ctx.send_lock_tokens(2 * LOCK_AMOUNT, second_unlock)
        .expect("a fresh lock should succeed after withdrawing");

    let lockbox = ctx.lockbox_state();
    assert_eq!(lockbox.total_deposited, 2 * LOCK_AMOUNT);
    assert_eq!(lockbox.unlock_time, second_unlock);
    assert_eq!(ctx.vault_balance(), 2 * LOCK_AMOUNT);
    assert_eq!(ctx.user_token_balance(), INITIAL_MINT_AMOUNT - 2 * LOCK_AMOUNT);

    let result = ctx.send_withdraw_tokens();
    assert!(result.is_err(), "the new lock must enforce its own unlock time");
}

#[test]
fn test_top_up_after_withdraw_requires_new_lock() {
    let mut ctx = TestContext::new();
    let unlock_time = ctx.future_unlock_time(3_600);

    ctx.send_lock_tokens(LOCK_AMOUNT, unlock_time)
        .expect("lock_tokens should succeed");
    ctx.warp_past_unlock(unlock_time);
    ctx.send_withdraw_tokens()
        .expect("withdraw should succeed after unlock time");

    let result = ctx.send_top_up_vault(LOCK_AMOUNT);
    assert!(result.is_err(), "top-up must not reuse an expired, withdrawn lock");
    assert_eq!(ctx.user_token_balance(), INITIAL_MINT_AMOUNT);
    assert!(!ctx.vault_exists());
}
