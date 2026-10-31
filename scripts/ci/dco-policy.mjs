/**
 * DCO 1.1 provenance policy. This verifies self-attestation in commit trailers,
 * not the contributor's legal identity, copyright title, or actual authorization.
 */
export function footerTrailers(message) {
  const lines = String(message ?? "").replace(/\r\n/g, "\n").trimEnd().split("\n");
  const trailerPattern = /^([A-Za-z][A-Za-z0-9-]*):[ \t]*(.+)$/;
  let start = lines.length;
  while (start > 0 && trailerPattern.test(lines[start - 1])) {
    start -= 1;
  }

  // A trailer must be a separate final block, not a quote in the message body.
  if (start === lines.length || (start > 0 && lines[start - 1].trim() !== "")) {
    return [];
  }

  return lines.slice(start).map((line) => {
    const match = trailerPattern.exec(line);
    return { key: match[1].toLowerCase(), value: match[2].trim() };
  });
}

function identity(value) {
  const match = /^(.+?)\s+<([^<>\s@]+@[^<>\s@]+)>$/.exec(value);
  if (!match || !match[1].trim()) return null;
  return { name: match[1].trim(), email: match[2].toLowerCase() };
}

export function validateDcoCommit(commit) {
  const sha = typeof commit?.sha === "string" ? commit.sha.slice(0, 12) : "unknown";
  const errors = [];
  const author = commit?.commit?.author;
  const authorEmail = typeof author?.email === "string" ? author.email.trim().toLowerCase() : "";
  if (!authorEmail) errors.push(sha + ": missing commit author email");

  const trailers = footerTrailers(commit?.commit?.message);
  const signoffs = [];
  const coauthors = [];
  for (const trailer of trailers) {
    if (trailer.key !== "signed-off-by" && trailer.key !== "co-authored-by") continue;
    const parsed = identity(trailer.value);
    if (!parsed) {
      errors.push(sha + ": malformed " + trailer.key + " trailer");
      continue;
    }
    if (trailer.key === "signed-off-by") signoffs.push(parsed.email);
    if (trailer.key === "co-authored-by") coauthors.push(parsed.email);
  }

  if (signoffs.length === 0) {
    errors.push(sha + ": missing final-block Signed-off-by trailer");
  } else {
    const signed = new Set(signoffs);
    if (authorEmail && !signed.has(authorEmail)) {
      errors.push(sha + ": commit author email has no matching DCO sign-off");
    }
    for (const email of new Set(coauthors)) {
      if (!signed.has(email)) {
        errors.push(sha + ": co-author " + email + " has no matching DCO sign-off");
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
