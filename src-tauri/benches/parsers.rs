//! Performance baseline for the hot string-parsing helpers.
//!
//! Run with `cargo bench` from `src-tauri/`. Criterion prints throughput per
//! function and, on repeat runs, the delta versus the previous run — so a
//! regression shows up immediately. A human-readable snapshot of the headline
//! numbers is checked in at `perf/baseline.rust.txt`.
//!
//! Covered:
//!   * `parse_name_status`   — `git diff --name-status` parsing
//!   * `parse_numstat`       — `git diff --numstat` parsing
//!   * `validate_session_id` — session-ID input validation (pure char scan)

use std::hint::black_box;

use criterion::{criterion_group, criterion_main, Criterion};
use smashq_lib::session::diff::{parse_name_status, parse_numstat};
use smashq_lib::validation::validate_session_id;

/// Builds `n` lines of `git diff --name-status` output, cycling through the
/// four status kinds (modified / added / deleted / renamed).
fn name_status_input(n: usize) -> String {
    let mut out = String::new();
    for i in 0..n {
        match i % 4 {
            0 => out.push_str(&format!("M\tsrc/module_{i}/file_{i}.rs\n")),
            1 => out.push_str(&format!("A\tsrc/module_{i}/new_{i}.rs\n")),
            2 => out.push_str(&format!("D\tsrc/module_{i}/old_{i}.rs\n")),
            _ => out.push_str(&format!("R100\tsrc/old_{i}.rs\tsrc/renamed_{i}.rs\n")),
        }
    }
    out
}

/// Builds `n` lines of `git diff --numstat` output, with every 10th line a
/// binary file (`-\t-\tpath`) so the `parse()` failure path is exercised.
fn numstat_input(n: usize) -> String {
    let mut out = String::new();
    for i in 0..n {
        if i % 10 == 0 {
            out.push_str(&format!("-\t-\tassets/binary_{i}.png\n"));
        } else {
            out.push_str(&format!(
                "{}\t{}\tsrc/module_{i}/file_{i}.rs\n",
                i % 200,
                i % 50
            ));
        }
    }
    out
}

fn bench_parse_name_status(c: &mut Criterion) {
    let small = name_status_input(50);
    let large = name_status_input(500);

    c.bench_function("parse_name_status/50 files", |b| {
        b.iter(|| parse_name_status(black_box(&small)))
    });
    c.bench_function("parse_name_status/500 files", |b| {
        b.iter(|| parse_name_status(black_box(&large)))
    });
}

fn bench_parse_numstat(c: &mut Criterion) {
    let small = numstat_input(50);
    let large = numstat_input(500);

    c.bench_function("parse_numstat/50 files", |b| {
        b.iter(|| parse_numstat(black_box(&small)))
    });
    c.bench_function("parse_numstat/500 files", |b| {
        b.iter(|| parse_numstat(black_box(&large)))
    });
}

fn bench_validate_session_id(c: &mut Criterion) {
    // Accepted path: a 36-char UUID-shaped id — full char scan, returns Ok.
    let valid = "9f8c1e2a-7b4d-4e1f-a3c6-2d5e8f0b1c47";
    // Rejected path: a shell-injection attempt — fails the char scan early
    // and pays the `format!` allocation of the error message.
    let rejected = "$(rm -rf /)";

    c.bench_function("validate_session_id/valid", |b| {
        b.iter(|| {
            let _ = validate_session_id(black_box(valid));
        })
    });
    c.bench_function("validate_session_id/rejected", |b| {
        b.iter(|| {
            let _ = validate_session_id(black_box(rejected));
        })
    });
}

criterion_group!(
    benches,
    bench_parse_name_status,
    bench_parse_numstat,
    bench_validate_session_id
);
criterion_main!(benches);
