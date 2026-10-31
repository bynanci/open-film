import { validateDcoCommit } from "./dco-policy.mjs";

const repo = process.env.GITHUB_REPOSITORY ?? "";
const numberText = process.env.OPENFILM_PR_NUMBER ?? "";
const expectedHead = (process.env.OPENFILM_PR_HEAD ?? "").toLowerCase();
const token = process.env.GITHUB_TOKEN ?? "";

if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
  throw new Error("A validated GITHUB_REPOSITORY is required.");
}
const number = Number(numberText);
if (!Number.isSafeInteger(number) || number <= 0) {
  throw new Error("A positive OPENFILM_PR_NUMBER is required.");
}
if (!/^[0-9a-f]{40}$/.test(expectedHead)) {
  throw new Error("A full OPENFILM_PR_HEAD SHA is required.");
}
if (!token) throw new Error("A read-only GITHUB_TOKEN is required.");

async function getApi(path) {
  const response = await fetch(
    "https://api.github.com/repos/" + repo + "/" + path,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: "Bearer " + token,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      redirect: "error",
    },
  );
  if (!response.ok) {
    throw new Error(
      "GitHub API returned HTTP " + response.status + " for PR provenance",
    );
  }
  return response.json();
}

async function main() {
  const pull = await getApi("pulls/" + number);
  if (pull?.head?.sha?.toLowerCase() !== expectedHead) {
    throw new Error(
      "PR head changed after this check started; re-run the new commit's check.",
    );
  }

  const commits = [];
  for (let page = 1; page <= 3; page += 1) {
    const batch = await getApi(
      "pulls/" + number + "/commits?per_page=100&page=" + page,
    );
    if (!Array.isArray(batch))
      throw new Error("Unexpected GitHub PR commits response.");
    commits.push(...batch);
    if (commits.length >= 250) {
      throw new Error(
        "PR exceeds the DCO review cap of 249 commits; split the PR.",
      );
    }
    if (batch.length < 100) break;
  }

  if (
    commits.length === 0 ||
    commits.at(-1)?.sha?.toLowerCase() !== expectedHead
  ) {
    throw new Error("PR commit list is empty or its head SHA is stale.");
  }

  const failures = commits.flatMap(
    (commit) => validateDcoCommit(commit).errors,
  );
  for (const failure of failures) console.error(failure);
  if (failures.length) {
    throw new Error(
      failures.length +
        " DCO provenance issue(s). Sign off your own commits with git commit -s; see DCO.md.",
    );
  }
  console.log(
    "Verified DCO sign-offs for " + commits.length + " PR commit(s).",
  );
  console.log(
    "DCO is a provenance attestation, not proof of copyright ownership.",
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
