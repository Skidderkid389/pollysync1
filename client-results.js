// PollySync client results module
// Reads results through the secure, client-scoped database function.

(function () {
  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[char]);
  }

  function formatDate(value) {
    if (!value) return 'Not recorded';

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Not recorded';

    return date.toLocaleString('en-KE', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Africa/Nairobi'
    }) + ' EAT';
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString('en-KE');
  }

  function getCandidateVotes(report) {
    return (report.candidate_votes?.candidates || [])
      .reduce((sum, entry) => sum + Number(entry.votes || 0), 0);
  }

  function getReportVoteTotal(report, field) {
    const value = report.candidate_votes?.[field];

    if (
      value !== undefined &&
      value !== null &&
      value !== '' &&
      Number.isFinite(Number(value))
    ) {
      return Number(value);
    }

    if (field === 'valid_votes') {
      return getCandidateVotes(report);
    }

    return 0;
  }

  window.loadPollySyncClientResults = async function () {
    const container =
      document.getElementById('clientResultsContent');

    if (!container) {
      console.log('Client results area is not connected yet.');
      return;
    }

    container.textContent = 'Loading campaign results...';

    try {
      const db = typeof pollySyncDB !== 'undefined'
        ? pollySyncDB
        : window.pollySyncDB;

      if (!db) {
        throw new Error('PollySync database connection is unavailable.');
      }

      const { data, error } = await db.rpc(
        'client_get_my_campaign_results'
      );

      if (error) throw error;

      const candidates = Array.isArray(data?.candidates)
        ? data.candidates
        : [];

      const reports = Array.isArray(data?.reports)
        ? data.reports
        : [];
            // Check for disagreements at shared polling stations.
      const { data: comparisonData, error: comparisonError } =
        await db.rpc('client_get_my_station_comparison_status');

      if (comparisonError) throw comparisonError;

      const comparisonByStation = new Map(
        (Array.isArray(comparisonData) ? comparisonData : []).map(item => [
          item.station_id,
          item
        ])
      );

      // A station counts only if it has exactly one
      // non-cancelled report and that report is locked.
      const reportsPerStation = Object.create(null);

      reports.forEach(report => {
        if (report.status === 'cancelled') return;

        const stationId = report.station_id;

        reportsPerStation[stationId] =
          (reportsPerStation[stationId] || 0) + 1;
      });

      const eligibleReports = reports.filter(report =>
        report.status === 'locked' &&
        reportsPerStation[report.station_id] === 1
      );

      // Prepare totals for every candidate in this contest.
      const totals = candidates.map(candidate => ({
        candidate_id: candidate.candidate_id,
        candidate_name: candidate.candidate_name,
        is_pollysync_client: candidate.is_pollysync_client,
        votes: 0
      }));

      const totalsById = new Map(
        totals.map(candidate => [
          candidate.candidate_id,
          candidate
        ])
      );

      // Count votes only from eligible reports.
      eligibleReports.forEach(report => {
        const entries =
          report.candidate_votes?.candidates || [];

        entries.forEach(entry => {
          const candidate =
            totalsById.get(entry.candidate_id);

          if (candidate) {
            candidate.votes += Number(entry.votes || 0);
          }
        });
      });

      // Rank every registered candidate dynamically.
      totals.sort((a, b) =>
        b.votes - a.votes ||
        a.candidate_name.localeCompare(b.candidate_name)
      );

      const totalCandidateVotes = totals.reduce(
        (sum, candidate) => sum + candidate.votes,
        0
      );

      const totalValidVotes = eligibleReports.reduce(
        (sum, report) =>
          sum + getReportVoteTotal(report, 'valid_votes'),
        0
      );

      const totalRejectedVotes = eligibleReports.reduce(
        (sum, report) =>
          sum + getReportVoteTotal(report, 'rejected_votes'),
        0
      );

      const totalOtherVotes = eligibleReports.reduce(
        (sum, report) =>
          sum + getReportVoteTotal(report, 'other_votes'),
        0
      );

      // Identify the client's own candidate from trusted data.
      const yourCandidate = totals.find(
        candidate => candidate.is_pollysync_client === true
      );

      const yourPositionIndex = yourCandidate
        ? totals.findIndex(
            candidate =>
              candidate.candidate_id === yourCandidate.candidate_id
          )
        : -1;

      const yourPosition = yourPositionIndex >= 0
        ? `${yourPositionIndex + 1} of ${totals.length}`
        : 'Not available';

      const yourVotes = yourCandidate
        ? yourCandidate.votes
        : 0;

      // Four election-day summary boxes appear first.
      const summaryHTML = `
        <h4>Election Day Summary</h4>
        <div class="tiles">
          <div class="tile">
            <strong>Stations Reported</strong>
            <p>${formatNumber(eligibleReports.length)}</p>
          </div>

          <div class="tile">
            <strong>Total Valid Votes</strong>
            <p>${formatNumber(totalValidVotes)}</p>
          </div>

          <div class="tile">
            <strong>Your Total Votes</strong>
            <p>${formatNumber(yourVotes)}</p>
          </div>

          <div class="tile">
            <strong>Your Position</strong>
            <p>${escapeHTML(yourPosition)}</p>
          </div>
        </div>
      `;

      const rankingHTML = totals.length
        ? totals.map((candidate, index) => {
            const share = totalCandidateVotes
              ? (candidate.votes / totalCandidateVotes) * 100
              : 0;

            return `
              <div class="tile">
                <strong>
                  ${index + 1}. ${escapeHTML(candidate.candidate_name)}
                </strong>

                ${candidate.is_pollysync_client
                  ? '<p><strong>Your campaign candidate</strong></p>'
                  : ''}

                <p>Votes: ${formatNumber(candidate.votes)}</p>

                <p>
                  Share of counted candidate votes:
                  ${share.toFixed(2)}%
                </p>
              </div>
            `;
          }).join('')
        : '<p>No contestants are registered for this contest yet.</p>';

      // These totals use eligible reports only, just like rankings.
      const additionalVotesHTML = `
        <h4>Other Vote Categories</h4>
        <div class="tiles">
          <div class="tile">
            <strong>Rejected Votes</strong>
            <p>${formatNumber(totalRejectedVotes)}</p>
          </div>

          <div class="tile">
            <strong>Other Votes</strong>
            <p>${formatNumber(totalOtherVotes)}</p>
          </div>
        </div>
      `;

      // Keep all returned reports visible for review.
      // Conflicting reports remain excluded from the totals.
      const reportsHTML = reports.length
        ? reports.map(report => {
            const status = String(
              report.status || 'unknown'
            ).toUpperCase();

            const hasConflict =
              report.status !== 'cancelled' &&
              reportsPerStation[report.station_id] > 1;
                      const comparison = comparisonByStation.get(
              report.station_id
            );

            const hasCrossCampaignDiscrepancy =
              report.status !== 'cancelled' &&
              comparison?.has_open_discrepancy === true;

            const candidateLines = (
              report.candidate_votes?.candidates || []
            ).map(entry => {
              const candidate =
                totalsById.get(entry.candidate_id);

              const name = candidate?.candidate_name ||
                'Unmatched contestant';

              return `
                <p>
                  ${escapeHTML(name)}:
                  ${formatNumber(entry.votes)}
                </p>
              `;
            }).join('');

            const voteBreakdown = report.candidate_votes
              ? `
                <p>
                  Valid votes:
                  ${formatNumber(
                    getReportVoteTotal(report, 'valid_votes')
                  )}
                </p>

                <p>
                  Rejected votes:
                  ${formatNumber(
                    getReportVoteTotal(report, 'rejected_votes')
                  )}
                </p>

                <p>
                  Other votes:
                  ${formatNumber(
                    getReportVoteTotal(report, 'other_votes')
                  )}
                </p>
              `
              : '';

            return `
              <div class="tile">
                <strong>${escapeHTML(report.station_name)}</strong>

                <p>Status: ${escapeHTML(status)}</p>

                ${hasConflict
                  ? '<p class="notice">Multiple non-cancelled reports exist for this station. Excluded from rankings pending review.</p>'
                  : ''}
                                  ${hasCrossCampaignDiscrepancy
                  ? '<p class="notice">A disagreement has been detected between reports linked to this shared polling station. This report is flagged for review. Do not treat this comparison as an official result.</p>'
                  : ''}

                <p>
                  Registered voters:
                  ${formatNumber(report.registered_voters)}
                </p>

                <p>
                  Total votes recorded:
                  ${formatNumber(report.total_votes)}
                </p>

                ${voteBreakdown}

                <p>
                  Official form reference:
                  ${escapeHTML(
                    report.official_form_reference || 'Not provided'
                  )}
                </p>

                <p>
                  Server received:
                  ${escapeHTML(formatDate(report.server_received_at))}
                </p>

                ${report.locked_at
                  ? `<p>Report locked: ${escapeHTML(
                      formatDate(report.locked_at)
                    )}</p>`
                  : ''}

                ${candidateLines}
              </div>
            `;
          }).join('')
        : '<p>No reports are available for paid, active stations yet.</p>';

      
const summaryContainer =
  document.getElementById('clientResultsSummary');

if (summaryContainer) {
  summaryContainer.innerHTML = summaryHTML;
}

container.innerHTML = `
       

        <h4>Candidate Rankings</h4>

        <p class="muted">
          Rankings include locked reports from stations with
          no conflicting non-cancelled submissions.
          Every registered candidate is shown.
        </p>

        ${rankingHTML}

        ${additionalVotesHTML}

        <h4>Polling Station Reports</h4>

        ${reportsHTML}

        <p class="muted">
          These are PollySync reports, not official election
          certification. Conflicting reports are excluded from
          rankings and summary totals pending review.
        </p>
      `;
    } catch (error) {
      console.error('Client results loading failed:', error);

      container.textContent =
        error.message ||
        'Could not load results. Please refresh and try again.';
    }
  };
})();
