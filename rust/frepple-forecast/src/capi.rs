//! C ABI for linking the Rust forecast methods into `libfrepple` (Engine track
//! E4, phase 7 integration). The numeric ports live in safe modules
//! (`#![forbid(unsafe_code)]`); THIS module is the only place with `unsafe` — the
//! FFI boundary (raw pointer in/out), exactly the small audited surface every
//! Python/C extension needs, vs. a C++ engine that is unsafe throughout.
//!
//! Contract: scalars are returned through out-pointers; variable-length outputs
//! (outlier indices, seasonal factors) are written into a caller-provided buffer
//! up to `*_cap`, with the true length returned via `*_len` (so the caller can
//! detect truncation). All functions return 0 on success.
//!
//! The matching header is `tools/rust-pilot/frepple_forecast.h`.

use crate::common::Forecast;

/// SAFETY: `history` must point to `count` readable f64s; the out-pointers must
/// be non-null and writable; `out_outliers` must be writable for `out_cap`
/// usizes.
unsafe fn write_scalar_result(
    r: &Forecast,
    out_smape: *mut f64,
    out_stddev: *mut f64,
    out_forecast: *mut f64,
    out_outliers: *mut usize,
    out_cap: usize,
    out_len: *mut usize,
) {
    *out_smape = r.smape;
    *out_stddev = r.standarddeviation;
    *out_forecast = r.forecast;
    *out_len = r.outliers.len();
    for (k, &o) in r.outliers.iter().take(out_cap).enumerate() {
        *out_outliers.add(k) = o;
    }
}

macro_rules! scalar_method {
    ($name:ident, $body:expr) => {
        /// # Safety
        /// See the module contract: valid `history`/`count` and writable out-params.
        #[no_mangle]
        pub unsafe extern "C" fn $name(
            history: *const f64,
            count: usize,
            out_smape: *mut f64,
            out_stddev: *mut f64,
            out_forecast: *mut f64,
            out_outliers: *mut usize,
            out_cap: usize,
            out_len: *mut usize,
            // method params follow via the closure capture below
            p: *const f64,
            np: usize,
        ) -> i32 {
            let h = std::slice::from_raw_parts(history, count);
            let params = std::slice::from_raw_parts(p, np);
            let r: Forecast = $body(h, params);
            write_scalar_result(&r, out_smape, out_stddev, out_forecast, out_outliers, out_cap, out_len);
            0
        }
    };
}

// Params are passed as a small f64 array (`p`) to keep one stable signature per
// method family; the order matches the header docs.
scalar_method!(frepple_moving_average, |h: &[f64], p: &[f64]| {
    crate::forecast::moving_average(h, p[0] as u32, p[1], p[2], p[3] as u64)
});
scalar_method!(frepple_single_exponential, |h: &[f64], p: &[f64]| {
    crate::single_exp::single_exponential(h, p[0], p[1], p[2], p[3], p[4], p[5] as u64, p[6] as u64)
});
scalar_method!(frepple_double_exponential, |h: &[f64], p: &[f64]| {
    crate::double_exp::double_exponential(
        h, p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8] as u64, p[9] as u64,
    )
});
scalar_method!(frepple_croston, |h: &[f64], p: &[f64]| {
    crate::croston::croston(h, p[0], p[1], p[2], p[3], p[4], p[5] as u64, p[6] as u64)
});

/// Seasonal has extra outputs (period, force, seasonal factors).
/// # Safety
/// Valid `history`/`count`; writable scalar out-params; `out_s_i` writable for
/// `s_i_cap` f64s.
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub unsafe extern "C" fn frepple_seasonal(
    history: *const f64,
    count: usize,
    p: *const f64,
    np: usize,
    out_smape: *mut f64,
    out_stddev: *mut f64,
    out_forecast: *mut f64,
    out_period: *mut u32,
    out_force: *mut i32,
    out_s_i: *mut f64,
    s_i_cap: usize,
    out_s_i_len: *mut usize,
) -> i32 {
    let h = std::slice::from_raw_parts(history, count);
    let pr = std::slice::from_raw_parts(p, np);
    let r = crate::seasonal::seasonal(
        h, pr[0], pr[1], pr[2], pr[3], pr[4], pr[5], pr[6], pr[7] as usize, pr[8] as usize,
        pr[9], pr[10], pr[11], pr[12] as u64, pr[13] as u64,
    );
    *out_smape = r.smape;
    *out_stddev = r.standarddeviation;
    *out_forecast = r.forecast;
    *out_period = r.period;
    *out_force = r.force as i32;
    *out_s_i_len = r.s_i.len();
    for (k, &s) in r.s_i.iter().take(s_i_cap).enumerate() {
        *out_s_i.add(k) = s;
    }
    0
}
