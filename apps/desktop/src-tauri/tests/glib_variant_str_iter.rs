// SPDX-License-Identifier: Apache-2.0
// OpenFilm regression probes; copied verbatim into the two isolated controls.
#![cfg(target_os = "linux")]
use glib::{prelude::ToVariant, Variant};

fn sample() -> Variant {
    vec!["first", "繁體中文", "", "last"].to_variant()
}

#[test]
fn glib_next() {
    let value = sample();
    let mut iter = value.array_iter_str().unwrap();
    eprintln!("openfilm-probe:glib_next:nonempty");
    assert_eq!(iter.next(), Some("first"));
    assert_eq!(iter.next(), Some("繁體中文"));
    assert_eq!(iter.next(), Some(""));
    assert_eq!(iter.next(), Some("last"));
    assert_eq!(iter.next(), None);
    assert_eq!(iter.next(), None);
    let mut mixed = value.array_iter_str().unwrap();
    assert_eq!(mixed.next(), Some("first"));
    assert_eq!(mixed.next_back(), Some("last"));
    assert_eq!(mixed.next(), Some("繁體中文"));
    assert_eq!(mixed.next_back(), Some(""));
    assert_eq!(mixed.next(), None);
    assert_eq!(mixed.next_back(), None);
    let empty = Vec::<String>::new().to_variant();
    assert_eq!(empty.array_iter_str().unwrap().next(), None);
}

#[test]
fn glib_nth() {
    let value = sample();
    eprintln!("openfilm-probe:glib_nth:nonempty");
    for (index, expected) in [
        (0, Some("first")),
        (1, Some("繁體中文")),
        (2, Some("")),
        (3, Some("last")),
        (4, None),
        (usize::MAX, None),
    ] {
        assert_eq!(value.array_iter_str().unwrap().nth(index), expected);
    }
    let mut iter = value.array_iter_str().unwrap();
    assert_eq!(iter.nth(0), Some("first"));
    assert_eq!(iter.nth(usize::MAX), None);
    assert_eq!(iter.nth(0), None);
    let empty = Vec::<String>::new().to_variant();
    assert_eq!(empty.array_iter_str().unwrap().nth(0), None);
}

#[test]
fn glib_last() {
    let value = sample();
    eprintln!("openfilm-probe:glib_last:nonempty");
    assert_eq!(value.array_iter_str().unwrap().last(), Some("last"));
    let mut iter = value.array_iter_str().unwrap();
    assert_eq!(iter.next_back(), Some("last"));
    assert_eq!(iter.last(), Some(""));
    let mut exhausted = value.array_iter_str().unwrap();
    assert_eq!(exhausted.nth(4), None);
    assert_eq!(exhausted.last(), None);
    let empty = Vec::<String>::new().to_variant();
    assert_eq!(empty.array_iter_str().unwrap().last(), None);
}

#[test]
fn glib_next_back() {
    let value = sample();
    eprintln!("openfilm-probe:glib_next_back:nonempty");
    let mut iter = value.array_iter_str().unwrap();
    for expected in [
        Some("last"),
        Some(""),
        Some("繁體中文"),
        Some("first"),
        None,
        None,
    ] {
        assert_eq!(iter.next_back(), expected);
    }
    let empty = Vec::<String>::new().to_variant();
    assert_eq!(empty.array_iter_str().unwrap().next_back(), None);
}

#[test]
fn glib_nth_back() {
    let value = sample();
    eprintln!("openfilm-probe:glib_nth_back:nonempty");
    for (index, expected) in [
        (0, Some("last")),
        (1, Some("")),
        (2, Some("繁體中文")),
        (3, Some("first")),
        (4, None),
        (usize::MAX, None),
    ] {
        assert_eq!(value.array_iter_str().unwrap().nth_back(index), expected);
    }
    let mut iter = value.array_iter_str().unwrap();
    assert_eq!(iter.nth_back(0), Some("last"));
    assert_eq!(iter.nth_back(usize::MAX), None);
    assert_eq!(iter.nth_back(0), None);
    let empty = Vec::<String>::new().to_variant();
    assert_eq!(empty.array_iter_str().unwrap().nth_back(0), None);
}
