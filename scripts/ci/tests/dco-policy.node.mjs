import test from "node:test";
import assert from "node:assert/strict";
import { footerTrailers, validateDcoCommit } from "../dco-policy.mjs";

function commit(message, email = "contributor@example.org") {
  return {
    sha: "a".repeat(40),
    commit: { author: { name: "Contributor", email }, message },
  };
}

test("accepts a genuine author sign-off at the end of a commit message", () => {
  const result = validateDcoCommit(
    commit(
      "feat: add editor feature\n\nSigned-off-by: Contributor <contributor@example.org>",
    ),
  );
  assert.equal(result.valid, true);
});

test("accepts a CRLF-formatted message and case-insensitive trailer key", () => {
  const result = validateDcoCommit(
    commit(
      "fix: issue\r\n\r\nsigned-off-by: Contributor <CONTRIBUTOR@example.org>",
    ),
  );
  assert.equal(result.valid, true);
});

test("rejects unsigned contributions", () => {
  assert.equal(
    validateDcoCommit(commit("feat: add editor feature")).valid,
    false,
  );
});

test("rejects a sign-off embedded inside a quoted message body", () => {
  const result = validateDcoCommit(
    commit(
      "feat: example\nQuoted lines:\nSigned-off-by: Contributor <contributor@example.org>",
    ),
  );
  assert.equal(result.valid, false);
  assert.deepEqual(
    footerTrailers("message\nSigned-off-by: Person <p@example.org>"),
    [],
  );
});

test("rejects a sign-off for someone other than the commit author", () => {
  const result = validateDcoCommit(
    commit("feat: example\n\nSigned-off-by: Other Person <other@example.org>"),
  );
  assert.equal(result.valid, false);
});

test("requires a sign-off for each named co-author", () => {
  const message =
    "feat: pair edit\n\n" +
    "Signed-off-by: Contributor <contributor@example.org>\n" +
    "Co-authored-by: Collaborator <collaborator@example.org>";
  assert.equal(validateDcoCommit(commit(message)).valid, false);
  assert.equal(
    validateDcoCommit(
      commit(
        message + "\nSigned-off-by: Collaborator <collaborator@example.org>",
      ),
    ).valid,
    true,
  );
});

test("rejects malformed sign-off and missing author email", () => {
  const malformed = validateDcoCommit(
    commit("feat: example\n\nSigned-off-by: Nobody"),
  );
  assert.equal(malformed.valid, false);
  assert.equal(
    validateDcoCommit(
      commit("feat: example\n\nSigned-off-by: Person <p@example.org>", ""),
    ).valid,
    false,
  );
});

test("does not require an exact name match when the email is the same", () => {
  const result = validateDcoCommit(
    commit(
      "docs: add guide\n\nSigned-off-by: Legal Name <contributor@example.org>",
    ),
  );
  assert.equal(result.valid, true);
});
