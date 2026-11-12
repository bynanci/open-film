# Recorded-media Silence browser QA

Issue: [#144](https://github.com/bynanci/open-film/issues/144). Base:
`86afec88978a385c690b547397259c8b077cd85a`.

This is an opt-in, local QA extension of the existing Silence services and
Desktop. It introduces no editing, playback, analysis, job or provider engine.
Real CC0 recordings and raw packets remain outside the checkout and CI uploads.
The API owns an ephemeral loopback port. The Desktop must exclusively bind its
existing trusted origin `http://127.0.0.1:1420` with strict-port admission; an
occupied port is a preserved failure, never permission to change origin policy
or stop another process.

- [ ] Admit the independently reviewed manual browser driver as a tracked,
      trusted test utility. Keep canonical external paths, fixed source hashes,
      fresh output creation and closed-storage project copies.
- [ ] Retain the existing source, Composition, durable Review, selected-ID,
      timeline-mapping and renderer-parity contracts. Compare actual UI mappings
      and actual browser Review responses, including reused/speed-adjusted media.
- [ ] Exercise Reconnect/reload, actual in-flight HTTP cancellation with the
      existing owner barrier, one declared delayed retry, prepared-project
      switching and actual native-buffer playback at a trusted Switch click.
      Preserve missed windows and other failures instead of manufacturing them.
- [ ] Preserve source/project/Review immutability and clean up only owned
      browser, Vite, server and ports, including failed actions and outstanding
      response waiters. No held route, fabricated audio or global process kill.
- [ ] Commit the utility before candidate-bound execution. Generate an explicitly
      new packet with the existing recorded-media runner; do not rewrite or
      relabel a historical immutable Review. Run the browser utility against the
      same clean implementation commit and preserve raw evidence externally.
- [ ] Record actual results, hashes, tool versions, timings and limits in paired
      validation documents and a sanitized evidence receipt. Update TASKS and
      ROADMAP only for the observed objective Linux sub-gates; leave #144 open.
- [ ] Complete independent review and exact-head configured CI before eligible
      development merge. Preserve the earlier interrupted full-local run and its
      unresolved failure separately; do not infer a local full-suite pass.

Human reference/listening, the known 1,152-sample / 24-ms export tail, recorded
A/V synchronization, captured channels beyond stereo, physical output devices
and Windows/macOS workstation observations remain independent manual gates.
An observed Web Audio buffer or HTTP abort does not prove physical sound,
FFmpeg-phase cancellation, instantaneous owner release, installer trust or
release approval. PR #129 and administrator policy activation stay separate.
