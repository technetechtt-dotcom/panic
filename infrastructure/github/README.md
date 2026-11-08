# Administrator-only repository policy candidate

The connected GitHub integration returned HTTP 403 (`Resource not accessible by integration`) when reading branch protection. No live policy was changed.

An administrator must first read existing branch protection/rulesets and preserve any stronger controls and required contexts. Review the candidate JSON, add the exact new security workflow check names after a real run, then apply it to main through the repository administration interface or GitHub API. Also enable required signed commits through the dedicated required-signatures endpoint/ruleset. Do not overwrite an existing policy with this candidate without comparing it.

One independent approving reviewer and approval of the latest push are required; administrator bypass is disabled. Owner-signed release tags and signed reviewed merge/release commits require the owner's signing identity. Do not generate a replacement owner identity in an automation session. Public/private visibility, patent disclosure and repository licensing require an explicit owner/legal decision.
