#!/bin/bash
# Video demo: "I missed the deadline, so I backdated my commits." The referee rejects it.
#
# 1. In the web app, stake a goal like:
#      "Push 2 commits adding a word counter to github.com/<you>/<repo>"
#    and note the nonce it shows (ref-xxxxxxxx) and the deadline.
# 2. Run:  referee/scripts/demo-backdate.sh <owner/repo> <ref-nonce> <deadline ISO, e.g. 2026-10-11T23:05:00Z>
#    It pushes the nonce file now (proving you control the repo), waits until the deadline has
#    passed, then commits real work with author AND committer dates set 10 minutes BEFORE the
#    deadline and pushes it. `git log` shows the work "on time".
# 3. ~1 minute after the deadline the verdict page shows FAIL: commits_in_window 0 of 2,
#    "first seen after the deadline ... Git dates are not used."
set -euo pipefail
REPO=$1; NONCE=$2; DEADLINE=$3
DL=$(date -j -u -f %Y-%m-%dT%H:%M:%SZ "$DEADLINE" +%s)
FAKE=$(date -u -r $((DL - 600)) +%Y-%m-%dT%H:%M:%SZ)
WORK=$(mktemp -d)
gh repo clone "$REPO" "$WORK" -- -q
cd "$WORK"
mkdir -p .referee && echo "$NONCE" > ".referee/$NONCE" && git add .referee && git commit -qm "referee: $NONCE" && git push -q
echo "pushed nonce file .referee/$NONCE"
while [ "$(date -u +%s)" -le "$DL" ]; do printf "\rwaiting for the deadline (%ss)  " $((DL - $(date -u +%s))); sleep 1; done
echo; echo "deadline passed. Backdating work to $FAKE and pushing it now."
export GIT_AUTHOR_DATE=$FAKE GIT_COMMITTER_DATE=$FAKE
F=wordcount_$(date +%s).js
printf "export const countWords = (s) => s.trim().split(/\\\\s+/).filter(Boolean).length;\n" > $F
git add $F && git commit -qm "add word counter"
printf "console.log(countWords(require('fs').readFileSync(process.argv[2] ?? 0, 'utf8')));\n" >> $F
git commit -qam "word counter CLI"
git push -q
echo; git log -3 --format='%h  %ad  %s' --date=iso-strict
echo; echo "git says both commits landed before the deadline ($DEADLINE). Watch the verdict page: the referee only counts what it saw."
