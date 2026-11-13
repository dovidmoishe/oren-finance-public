//! Minimal, read-only Token-2022 extension checks.
//!
//! Token-2022 pads mints and token accounts to the 165-byte base account
//! length, stores an `AccountType` byte at offset 165, and then a TLV list of
//! extensions (u16 type, u16 length, value). Legacy SPL Token mints (82 bytes)
//! and accounts (165 bytes) have no extensions.

use anchor_lang::prelude::*;

const BASE_ACCOUNT_LEN: usize = 165;
const TLV_START: usize = BASE_ACCOUNT_LEN + 1;

/// `ExtensionType::TransferFeeAmount` (on token accounts).
const TRANSFER_FEE_AMOUNT: u16 = 2;
/// `ExtensionType::TransferHook` (on mints).
const TRANSFER_HOOK: u16 = 14;

fn find_extension(data: &[u8], wanted: u16) -> Option<&[u8]> {
    let mut pos = TLV_START;
    while pos + 4 <= data.len() {
        let kind = u16::from_le_bytes([data[pos], data[pos + 1]]);
        let len = u16::from_le_bytes([data[pos + 2], data[pos + 3]]) as usize;
        if kind == 0 {
            return None; // Uninitialized: end of the TLV list.
        }
        let value = data.get(pos + 4..pos + 4 + len)?;
        if kind == wanted {
            return Some(value);
        }
        pos += 4 + len;
    }
    None
}

/// True when the mint has a transfer hook, or an authority that can add one
/// later. Hooked transfers need extra accounts this program never forwards,
/// so a hooked mint could strand locked funds.
pub fn has_transfer_hook(mint: &AccountInfo) -> Result<bool> {
    let data = mint.try_borrow_data()?;
    Ok(match find_extension(&data, TRANSFER_HOOK) {
        // authority: OptionalNonZeroPubkey, program_id: OptionalNonZeroPubkey
        Some(value) => value.iter().any(|byte| *byte != 0),
        None => false,
    })
}

/// Transfer fees withheld on a Token-2022 account. Such an account cannot be
/// closed until the fees are harvested to the mint.
pub fn withheld_transfer_fees(account: &AccountInfo) -> Result<u64> {
    let data = account.try_borrow_data()?;
    Ok(find_extension(&data, TRANSFER_FEE_AMOUNT)
        .and_then(|value| value.get(..8))
        .map(|bytes| u64::from_le_bytes(bytes.try_into().unwrap()))
        .unwrap_or(0))
}
